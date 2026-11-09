import { expect, test, type Page } from '@playwright/test';
import { emptyState, type SocketMock, type WemockState } from '../src/core/types';
import { type FixtureServer, startFixtureServer } from './fixture/server';
import { type WemockSession, launchWemock } from './helpers';

// A6: real sockets are logged, and "Mock this socket" rebuilds them as socket mocks.
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

async function readState(): Promise<WemockState> {
  return session.worker.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await (globalThis as any).chrome.storage.local.get('wemock.state'))['wemock.state'];
  });
}

async function openBoth(): Promise<{ page: Page; panel: Page }> {
  await session.setState({ ...emptyState(), enabledOrigins: [fixture.origin] });
  const page = await session.context.newPage();
  await page.goto(`${fixture.url}/index.html`);
  await page.addScriptTag({ url: '/signalr.js' });
  const tabId = await session.tabIdOf(page);
  const panel = await session.context.newPage();
  await panel.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);
  return { page, panel };
}

function plainSession(page: Page) {
  return page.evaluate(async () => {
    const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/ws/real`);
    const got: string[] = [];
    ws.onmessage = (e) => got.push(String(e.data));
    let early = '';
    try {
      ws.send('too early');
    } catch (e) {
      early = (e as DOMException).name;
    }
    await new Promise((r) => (ws.onopen = r));
    for (let i = 0; i < 50 && got.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
    ws.send('a');
    for (let i = 0; i < 50 && got.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
    ws.close();
    return { got, early };
  });
}

test('a real plain socket is logged; Mock this socket replays its server messages', async () => {
  const { page, panel } = await openBoth();
  try {
    expect(await plainSession(page)).toEqual({ got: ['tick 1', 'echo:a'], early: 'InvalidStateError' });

    const rows = panel.getByTestId('log-row');
    await expect(rows.filter({ hasText: 'WS ↓' })).toHaveCount(2);
    await expect(rows.filter({ hasText: 'WS ↑' })).toHaveCount(1);
    // A message row shows no status, and not as an error.
    const msgStatus = rows.filter({ hasText: 'WS ↑' }).first().locator('.log-col-status');
    await expect(msgStatus).toHaveText('—');
    await expect(msgStatus).not.toHaveClass(/status-error/);
    const open = rows.filter({ hasText: '101' }).first();
    await expect(open).toContainText('real');
    await open.click();
    await panel.getByTestId('mock-socket').click();

    await expect.poll(async () => (await readState()).projects[0]?.scenarios[0]?.sockets?.length ?? 0).toBe(1);
    const s = (await readState()).projects[0]!.scenarios[0]!.sockets![0] as SocketMock;
    expect(s).toMatchObject({ kind: 'plain', urlPattern: '/ws/real', enabled: true, replies: [] });
    expect(s.onConnect.map((p) => p.data)).toEqual(['tick 1', 'echo:a']);

    // Now the same URL is answered by wemock, with the recorded messages.
    await page.reload();
    const replay = await page.evaluate(async () => {
      const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/ws/real`);
      const got: string[] = [];
      ws.onmessage = (e) => got.push(String(e.data));
      for (let i = 0; i < 100 && got.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
      return { got, native: Object.getPrototypeOf(ws) === WebSocket.prototype };
    });
    expect(replay).toEqual({ got: ['tick 1', 'echo:a'], native: false });
  } finally {
    await panel.close();
    await page.close();
  }
});

function hubSession(page: Page) {
  return page.evaluate(async () => {
    const signalR = (window as unknown as { signalR: any }).signalR; // eslint-disable-line @typescript-eslint/no-explicit-any
    const url = `${location.origin.replace('http', 'ws')}/hubs/real`;
    const c = new signalR.HubConnectionBuilder()
      .withUrl(url, { skipNegotiation: true, transport: signalR.HttpTransportType.WebSockets })
      .configureLogging(signalR.LogLevel.None)
      .build();
    const got: unknown[] = [];
    c.on('Receive', (a: string, b: string) => got.push([a, b]));
    await c.start();
    for (let i = 0; i < 50 && got.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
    const doubled = await c.invoke('Double', 21);
    await c.stop();
    return { got, doubled };
  });
}

test('a real SignalR hub is logged; Mock this socket rebuilds its push and its reply', async () => {
  const { page, panel } = await openBoth();
  try {
    expect(await hubSession(page)).toEqual({ got: [['srv', 'hello']], doubled: { n: 42 } });

    const open = panel.getByTestId('log-row').filter({ hasText: '101' }).first();
    await open.click();
    await panel.getByTestId('mock-socket').click();
    await expect.poll(async () => (await readState()).projects[0]?.scenarios[0]?.sockets?.length ?? 0).toBe(1);
    const s = (await readState()).projects[0]!.scenarios[0]!.sockets![0] as SocketMock;
    expect(s).toMatchObject({
      kind: 'signalr',
      urlPattern: '/hubs/real',
      onConnect: [{ target: 'Receive', data: '["srv","hello"]' }],
      replies: [{ when: 'Double', respond: 'fixed', result: '{"n":42}', pushes: [] }],
    });

    await page.reload();
    await page.addScriptTag({ url: '/signalr.js' });
    expect(await hubSession(page)).toEqual({ got: [['srv', 'hello']], doubled: { n: 42 } });
    await expect(panel.getByTestId('log-row').filter({ hasText: 'MOCK' }).first()).toBeVisible();
  } finally {
    await panel.close();
    await page.close();
  }
});

test('Mock this socket is offered only on a real socket open row', async () => {
  const { page, panel } = await openBoth();
  try {
    await plainSession(page);
    await panel.getByTestId('log-row').filter({ hasText: 'WS ↓' }).first().click();
    await expect(panel.getByTestId('mock-socket')).toHaveCount(0);
    await page.evaluate(async () => (await fetch('/api/goals')).text());
    await panel.getByTestId('log-row').filter({ hasText: '/api/goals' }).first().click();
    await expect(panel.getByTestId('mock-socket')).toHaveCount(0);
  } finally {
    await panel.close();
    await page.close();
  }
});
