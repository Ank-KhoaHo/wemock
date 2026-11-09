import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogDraft, SocketMock } from '../core/types';
import type { PatchDeps } from './fetchPatch';
import type { Gate, GateConfig } from './gate';
import { installSocketPatch } from './socketPatch';

const RS = '\u001e';

class NativeStub {
  static made: string[] = [];
  constructor(public url: string) {
    NativeStub.made.push(url);
  }
}

const hub: SocketMock = {
  id: 'hub',
  name: 'Hub',
  enabled: true,
  kind: 'signalr',
  urlPattern: '/hub',
  createdAt: 0,
  onConnect: [],
  replies: [],
};

function setup(cfg: GateConfig | null) {
  NativeStub.made = [];
  const win = { WebSocket: NativeStub, EventTarget, MessageEvent, location: { href: 'http://a.test/page' } } as unknown as Window;
  const reported: LogDraft[] = [];
  const gate: Gate = { open: vi.fn(), wait: vi.fn(), current: () => cfg };
  const deps: PatchDeps = { gate, report: (d) => reported.push(d), now: () => 0, console: { info: vi.fn(), warn: vi.fn() } };
  installSocketPatch(win, deps);
  const WS = (win as unknown as { WebSocket: new (u: string) => WebSocket }).WebSocket;
  return { WS, reported, deps };
}

const on: GateConfig = { mocks: [], settings: { enabled: true, recording: true }, sockets: [hub] };

function collect(ws: WebSocket): string[] {
  const got: string[] = [];
  ws.addEventListener('message', (e) => got.push(String((e as MessageEvent).data)));
  return got;
}

describe('socketPatch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('opens the native socket before the config arrives, or with no match', () => {
    const before = setup(null);
    new before.WS('ws://a.test/hub');
    expect(NativeStub.made).toEqual(['ws://a.test/hub']);
    const { WS } = setup(on);
    new WS('ws://a.test/other');
    expect(NativeStub.made).toEqual(['ws://a.test/other']);
  });

  it('pings every 15 s only after the handshake, and stops when closed', () => {
    const { WS } = setup(on);
    const ws = new WS('ws://a.test/hub');
    const got = collect(ws);
    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(20000);
    expect(got).toEqual([]);
    ws.send(`{"protocol":"json","version":1}${RS}`);
    vi.advanceTimersByTime(1);
    expect(got).toEqual([`{}${RS}`]);
    vi.advanceTimersByTime(15000);
    expect(got).toEqual([`{}${RS}`, `{"type":6}${RS}`]);
    vi.advanceTimersByTime(15000);
    expect(got.length).toBe(3);
    ws.close();
    vi.advanceTimersByTime(60000);
    expect(got.length).toBe(3);
    expect(ws.readyState).toBe(3);
  });

  it('answers a MessagePack handshake with an error and closes', () => {
    const { WS } = setup(on);
    const ws = new WS('ws://a.test/hub');
    const got = collect(ws);
    let closed = false;
    ws.onclose = () => (closed = true);
    vi.advanceTimersByTime(1);
    ws.send(`{"protocol":"messagepack","version":1}${RS}`);
    vi.advanceTimersByTime(10);
    expect(got).toEqual([`{"error":"wemock mocks only the JSON hub protocol, not 'messagepack'"}${RS}`]);
    expect(closed).toBe(true);
  });

  it('a stream invocation gets an error completion', async () => {
    const { WS } = setup(on);
    const ws = new WS('ws://a.test/hub');
    const got = collect(ws);
    vi.advanceTimersByTime(1);
    ws.send(`{"protocol":"json","version":1}${RS}`);
    ws.send(`{"type":4,"invocationId":"7","target":"Counter","arguments":[]}${RS}`);
    await vi.advanceTimersByTimeAsync(5);
    expect(got[1]).toBe(`{"type":3,"invocationId":"7","error":"wemock does not mock streams"}${RS}`);
  });

  it('rejects a reserved close code like the native socket', () => {
    const { WS } = setup(on);
    const ws = new WS('ws://a.test/hub');
    expect(() => ws.close(1001)).toThrow(/close code/);
    expect(() => ws.close(3000)).not.toThrow();
  });

  it("a page handler that throws does not stop the next message", async () => {
    const plain: SocketMock = { ...hub, kind: 'plain', onConnect: [{ id: 'a', afterMs: 0, target: '', data: 'one' }, { id: 'b', afterMs: 5, target: '', data: 'two' }] };
    const { WS } = setup({ ...on, sockets: [plain] });
    const ws = new WS('ws://a.test/hub');
    const got: string[] = [];
    ws.onmessage = (e) => {
      got.push(String(e.data));
      throw new Error('page bug');
    };
    try {
      vi.advanceTimersByTime(1);
      vi.advanceTimersByTime(10);
    } catch {
      // the rethrown page error surfaces on its own timer, as a real socket's would
    }
    vi.advanceTimersByTime(10);
    expect(got).toEqual(['one', 'two']);
  });

  it('logs the open as status 101 and writes the Console line', () => {
    const { WS, reported, deps } = setup(on);
    new WS('ws://a.test/hub');
    vi.advanceTimersByTime(1);
    expect(reported[0]).toMatchObject({ method: 'WS', status: 101, badge: 'MOCK', mockId: 'hub', url: 'ws://a.test/hub' });
    expect(deps.console!.info).toHaveBeenCalledWith('[wemock] WS ws://a.test/hub → 101 mock "Hub" (0 ms)');
  });
});

describe('socketPatch: real sockets are logged (A6)', () => {
  class RealStub extends EventTarget {
    static sent: unknown[] = [];
    static fail = false;
    url: string;
    constructor(url: string) {
      super();
      this.url = url;
    }
    send(data: unknown): void {
      if (RealStub.fail) throw new DOMException('not open', 'InvalidStateError');
      RealStub.sent.push(data);
    }
  }

  function setupReal() {
    RealStub.sent = [];
    const win = { WebSocket: RealStub, EventTarget, MessageEvent, location: { href: 'http://a.test/page' } } as unknown as Window;
    const reported: LogDraft[] = [];
    const gate: Gate = { open: vi.fn(), wait: vi.fn(), current: () => on };
    installSocketPatch(win, { gate, report: (d) => reported.push(d), now: () => 7 });
    const WS = (win as unknown as { WebSocket: new (u: string) => RealStub }).WebSocket;
    return { WS, reported };
  }

  it('logs open, messages both ways (pings dropped), and one connection id', () => {
    const { WS, reported } = setupReal();
    const ws = new WS('ws://a.test/real');
    ws.dispatchEvent(new Event('open'));
    ws.dispatchEvent(new MessageEvent('message', { data: 'hi' }));
    ws.dispatchEvent(new MessageEvent('message', { data: `{"type":6}${RS}` }));
    ws.dispatchEvent(new MessageEvent('message', { data: new Uint8Array(3).buffer }));
    ws.send('up');
    expect(RealStub.sent).toEqual(['up']);
    expect(reported.map((r) => [r.method, r.status, r.requestBody ?? r.responseBody, r.badge])).toEqual([
      ['WS', 101, null, 'real'],
      ['WS ↓', 0, 'hi', 'real'],
      ['WS ↓', 0, '[binary 3 bytes]', 'real'],
      ['WS ↑', 0, 'up', 'real'],
    ]);
    expect(new Set(reported.map((r) => r.connectionId)).size).toBe(1);
    expect(reported[0]!.connectionId).toMatch(/^c\d+-/);
  });

  it('logs at most 200 messages per connection, then one note', () => {
    const { WS, reported } = setupReal();
    const ws = new WS('ws://a.test/real');
    for (let i = 0; i < 250; i++) ws.dispatchEvent(new MessageEvent('message', { data: `m${i}` }));
    expect(reported.filter((r) => r.method === 'WS ↓')).toHaveLength(200);
    const notes = reported.filter((r) => r.method === 'WS');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.responseBody).toMatch(/not logged \(200 at most\)/);
  });

  it('a send that throws is not logged', () => {
    const { WS, reported } = setupReal();
    const ws = new WS('ws://a.test/real');
    RealStub.fail = true;
    try {
      expect(() => ws.send('x')).toThrow('not open');
      expect(reported).toEqual([]);
    } finally {
      RealStub.fail = false;
    }
  });
});
