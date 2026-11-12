import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { LogDraft } from '../core/types';
import { LogRouter } from './logRouter';

function createDraft(url: string): LogDraft {
  return {
    method: 'GET',
    url,
    status: 200,
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: '{}',
    responseEncoding: 'text',
    truncated: false,
    durationMs: 12,
    badge: 'real',
    startedAt: 1000,
  };
}

interface FakePort {
  name: string;
  sender?: {
    id?: string;
    url?: string;
  };
  postMessage: ReturnType<typeof vi.fn>;
  onMessage: {
    addListener(fn: (msg: unknown) => void): void;
    trigger(msg: unknown): void;
  };
  onDisconnect: {
    addListener(fn: () => void): void;
    trigger(): void;
  };
}

function createFakePort(name = 'wemock-panel'): FakePort {
  const messageListeners: ((msg: unknown) => void)[] = [];
  const disconnectListeners: (() => void)[] = [];
  const extId = fakeBrowser.runtime.id ?? 'extid';

  return {
    name,
    sender: { id: extId, url: `chrome-extension://${extId}/panel.html` },
    postMessage: vi.fn(),
    onMessage: {
      addListener(fn) {
        messageListeners.push(fn);
      },
      trigger(msg) {
        for (const l of messageListeners) l(msg);
      },
    },
    onDisconnect: {
      addListener(fn) {
        disconnectListeners.push(fn);
      },
      trigger() {
        for (const l of disconnectListeners) l();
      },
    },
  };
}

describe('logRouter', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    fakeBrowser.runtime.id = 'extid';
  });

  it('two tabs keep separate buffers', () => {
    const router = new LogRouter();

    router.handleMessage({ type: 'log', entry: createDraft('http://a.com/1') }, { tab: { id: 1 } } as any);
    router.handleMessage({ type: 'log', entry: createDraft('http://b.com/2') }, { tab: { id: 2 } } as any);

    const buf1 = router.getBuffer(1);
    const buf2 = router.getBuffer(2);

    expect(buf1?.entries()).toHaveLength(1);
    expect(buf1?.entries()[0]?.url).toBe('http://a.com/1');
    expect(buf1?.entries()[0]?.id).toBeDefined();

    expect(buf2?.entries()).toHaveLength(1);
    expect(buf2?.entries()[0]?.url).toBe('http://b.com/2');
    expect(buf2?.entries()[0]?.id).toBeDefined();
    expect(buf2?.entries()[0]?.id).not.toBe(buf1?.entries()[0]?.id);
  });

  // A43: subscribe waits for the tab's stored rows (storage.session), so the snapshot is async.
  it('a subscriber gets a snapshot then live entries', async () => {
    const router = new LogRouter();

    router.handleMessage({ type: 'log', entry: createDraft('http://a.com/initial') }, { tab: { id: 10 } } as any);

    const port = createFakePort('wemock-panel');
    router.handleConnect(port as any);

    port.onMessage.trigger({ type: 'subscribe', tabId: 10 });

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'snapshot',
      entries: expect.arrayContaining([
        expect.objectContaining({ url: 'http://a.com/initial' }),
      ]),
    });

    // New log for tab 10
    router.handleMessage({ type: 'log', entry: createDraft('http://a.com/live') }, { tab: { id: 10 } } as any);

    expect(port.postMessage).toHaveBeenCalledTimes(2);
    expect(port.postMessage).toHaveBeenLastCalledWith({
      type: 'log',
      entry: expect.objectContaining({ url: 'http://a.com/live' }),
    });

    // Log for another tab is NOT sent to this port
    router.handleMessage({ type: 'log', entry: createDraft('http://other.com') }, { tab: { id: 20 } } as any);
    expect(port.postMessage).toHaveBeenCalledTimes(2);
  });

  it('tabs.onRemoved drops the buffer', () => {
    const router = new LogRouter();

    router.handleMessage({ type: 'log', entry: createDraft('http://a.com/1') }, { tab: { id: 42 } } as any);
    expect(router.getBuffer(42)?.entries()).toHaveLength(1);

    router.handleTabRemoved(42);
    expect(router.getBuffer(42)).toBeUndefined();
  });

  it('clear message empties the buffer and notifies subscribers with an empty snapshot', async () => {
    const router = new LogRouter();

    router.handleMessage({ type: 'log', entry: createDraft('http://a.com/1') }, { tab: { id: 5 } } as any);

    const port = createFakePort('wemock-panel');
    router.handleConnect(port as any);
    port.onMessage.trigger({ type: 'subscribe', tabId: 5 });

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'snapshot',
      entries: [expect.objectContaining({ url: 'http://a.com/1' })],
    });

    port.onMessage.trigger({ type: 'clear', tabId: 5 });
    expect(router.getBuffer(5)?.entries()).toHaveLength(0);
    expect(port.postMessage).toHaveBeenLastCalledWith({
      type: 'snapshot',
      entries: [],
    });
  });
});
