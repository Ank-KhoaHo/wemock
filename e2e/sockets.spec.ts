import { expect, test, type Page } from '@playwright/test';
import { emptyState, newProject, type Settings, type SocketMock } from '../src/core/types';
import { type FixtureServer, startFixtureServer } from './fixture/server';
import { type WemockSession, launchWemock } from './helpers';

// Spec A5: socket mocks, tested against the real @microsoft/signalr browser client.
// The fixture server has no hub and no WebSocket server: every answer here is wemock's.
let fixture: FixtureServer;
let session: WemockSession;

test.beforeAll(async () => {
  fixture = await startFixtureServer();
  session = await launchWemock(fixture.url);
});

test.afterAll(async () => {
  await session?.context?.close();
  await fixture?.close();
});

const chat: SocketMock = {
  id: 'chat',
  name: 'Chat',
  enabled: true,
  kind: 'signalr',
  urlPattern: '/hubs/chat',
  createdAt: 0,
  onConnect: [{ id: 'p1', afterMs: 30, target: 'Receive', data: '["bot","hi"]' }],
  replies: [
    { id: 'r-send', when: 'Send', respond: 'fixed', result: '{"ok":true}', pushes: [{ id: 'p2', afterMs: 10, target: 'Echo', data: '["echoed"]' }] },
    { id: 'r-add', when: 'Add', respond: 'code', result: '', code: 'return body[0] + body[1];', pushes: [] },
    { id: 'r-bad', when: 'Bad', respond: 'code', result: '', code: "throw new Error('no way')", pushes: [] },
  ],
};

const echo: SocketMock = {
  id: 'echo',
  name: 'Echo',
  enabled: true,
  kind: 'plain',
  urlPattern: '/ws/echo',
  createdAt: 0,
  onConnect: [{ id: 'w', afterMs: 0, target: '', data: 'welcome' }],
  replies: [
    { id: 'r-ping', when: 'ping', respond: 'fixed', result: 'pong', pushes: [] },
    { id: 'r-up', when: 'up:', respond: 'code', result: '', code: 'return String(body).slice(3).toUpperCase();', pushes: [] },
  ],
};

async function useSockets(sockets: SocketMock[], settings?: Partial<Settings>): Promise<void> {
  const project = newProject('p1', fixture.origin);
  project.scenarios[0]!.sockets = sockets;
  const base = emptyState();
  await session.setState({ ...base, settings: { ...base.settings, ...settings }, projects: [project], enabledOrigins: [fixture.origin] });
}

async function openPage(): Promise<Page> {
  const page = await session.context.newPage();
  await page.goto(`${fixture.url}/index.html`);
  await page.addScriptTag({ url: '/signalr.js' });
  return page;
}

test('SignalR: negotiate, handshake, a push on connect, an invoke with a result and a follow-up push', async () => {
  await useSockets([chat]);
  const page = await openPage();
  try {
    const out = await page.evaluate(async () => {
      const signalR = (window as unknown as { signalR: any }).signalR; // eslint-disable-line @typescript-eslint/no-explicit-any
      const got: unknown[] = [];
      const c = new signalR.HubConnectionBuilder().withUrl('/hubs/chat').configureLogging(signalR.LogLevel.None).build();
      c.on('Receive', (a: string, b: string) => got.push(['Receive', a, b]));
      c.on('Echo', (a: string) => got.push(['Echo', a]));
      await c.start();
      const started = c.state;
      for (let i = 0; i < 50 && got.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
      const sent = await c.invoke('Send', 'hello');
      for (let i = 0; i < 50 && got.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
      const noRule = await c.invoke('Unknown', 1);
      await c.stop();
      return { got, sent, noRule: noRule === undefined ? 'undefined' : noRule, started, stopped: c.state };
    });
    expect(out).toEqual({
      got: [['Receive', 'bot', 'hi'], ['Echo', 'echoed']],
      sent: { ok: true },
      noRule: 'undefined',
      started: 'Connected',
      stopped: 'Disconnected',
    });
  } finally {
    await page.close();
  }
});

test('SignalR: a code reply computes the result; a failing one rejects the invoke with its message', async () => {
  await useSockets([chat]);
  const page = await openPage();
  try {
    const out = await page.evaluate(async () => {
      const signalR = (window as unknown as { signalR: any }).signalR; // eslint-disable-line @typescript-eslint/no-explicit-any
      const c = new signalR.HubConnectionBuilder().withUrl('/hubs/chat').configureLogging(signalR.LogLevel.None).build();
      await c.start();
      const sum = await c.invoke('Add', 2, 3);
      let error = '';
      try {
        await c.invoke('Bad');
      } catch (e) {
        error = String((e as Error).message);
      }
      await c.stop();
      return { sum, error };
    });
    expect(out.sum).toBe(5);
    expect(out.error).toContain('no way');
  } finally {
    await page.close();
  }
});

test('SignalR with skipNegotiation connects straight over the fake socket', async () => {
  await useSockets([chat]);
  const page = await openPage();
  try {
    const state = await page.evaluate(async () => {
      const signalR = (window as unknown as { signalR: any }).signalR; // eslint-disable-line @typescript-eslint/no-explicit-any
      const url = `${location.origin.replace('http', 'ws')}/hubs/chat`;
      const c = new signalR.HubConnectionBuilder()
        .withUrl(url, { skipNegotiation: true, transport: signalR.HttpTransportType.WebSockets })
        .configureLogging(signalR.LogLevel.None)
        .build();
      await c.start();
      const s = c.state;
      await c.stop();
      return s;
    });
    expect(state).toBe('Connected');
  } finally {
    await page.close();
  }
});

test('plain WebSocket: welcome on open, fixed and code replies, instanceof, close code', async () => {
  await useSockets([echo]);
  const page = await openPage();
  try {
    const out = await page.evaluate(async () => {
      const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/ws/echo`);
      const got: string[] = [];
      ws.addEventListener('message', (e) => got.push(String(e.data)));
      const firstState = ws.readyState;
      let sendTooEarly = '';
      try {
        ws.send('x');
      } catch (e) {
        sendTooEarly = (e as DOMException).name;
      }
      await new Promise((r) => (ws.onopen = r));
      ws.send('ping');
      ws.send('up:loud');
      ws.send('ignored');
      for (let i = 0; i < 50 && got.length < 3; i++) await new Promise((r) => setTimeout(r, 20));
      const closed = new Promise<{ code: number; wasClean: boolean }>((r) => (ws.onclose = (e) => r({ code: e.code, wasClean: e.wasClean })));
      ws.close(1000);
      return {
        firstState,
        sendTooEarly,
        got,
        isWs: ws instanceof WebSocket,
        constants: [WebSocket.CONNECTING, WebSocket.OPEN, WebSocket.CLOSING, WebSocket.CLOSED],
        close: await closed,
        finalState: ws.readyState,
      };
    });
    expect(out).toEqual({
      firstState: 0,
      sendTooEarly: 'InvalidStateError',
      got: ['welcome', 'pong', 'LOUD'],
      isWs: true,
      constants: [0, 1, 2, 3],
      close: { code: 1000, wasClean: true },
      finalState: 3,
    });
  } finally {
    await page.close();
  }
});

test('a URL with no socket mock, or wemock switched off, gets the native WebSocket', async () => {
  for (const settings of [{}, { enabled: false }]) {
    await useSockets([echo], settings);
    const page = await openPage();
    try {
      const out = await page.evaluate(async (path) => {
        const ws = new WebSocket(`${location.origin.replace('http', 'ws')}${path}`);
        const native = Object.getPrototypeOf(ws) === WebSocket.prototype;
        const code = await new Promise<number>((r) => (ws.onclose = (e) => r(e.code)));
        return { native, isWs: ws instanceof WebSocket, code };
      }, settings.enabled === false ? '/ws/echo' : '/ws/other');
      // The fixture server has no WebSocket endpoint, so a native socket fails with 1006.
      expect(out).toEqual({ native: true, isWs: true, code: 1006 });
    } finally {
      await page.close();
    }
  }
});

test('the log shows the socket and its messages, and Mock this is off for them', async () => {
  await useSockets([echo]);
  const page = await openPage();
  const panel = await session.context.newPage();
  try {
    const tabId = await session.tabIdOf(page);
    await panel.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);
    await page.evaluate(async () => {
      const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/ws/echo`);
      await new Promise((r) => (ws.onopen = r));
      ws.send('ping');
      await new Promise((r) => setTimeout(r, 100));
    });
    const rows = panel.getByTestId('log-row');
    await expect(rows.filter({ hasText: 'WS ↑' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'WS ↓' })).toHaveCount(2);
    await rows.filter({ hasText: '101' }).first().click();
    await expect(panel.getByTestId('mock-this')).toBeDisabled();
  } finally {
    await panel.close();
    await page.close();
  }
});
