// A27: wemock against a REAL ASP.NET Core SignalR hub (scripts/real-hub/hub, run in Docker by run.sh).
// 1. The official client talks to the real hub through wemock: nothing breaks, and the traffic is logged.
// 2. "Mock this socket" turns that traffic into a socket mock.
// 3. The hub is stopped; the same client code now gets its answers from the mock.
import { execSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { emptyState, newProject, type SocketMock, type WemockState } from '../../src/core/types';
import { startFixtureServer } from '../../e2e/fixture/server';
import { launchWemock } from '../../e2e/helpers';

const HUB_URL = process.env.HUB_URL ?? 'http://127.0.0.1:5099/hubs/shop';
const HUB_NAME = process.env.HUB_NAME ?? 'wemock-real-hub';

type Session = {
  notify: unknown[]; doubled: unknown; echoed: unknown; group: unknown[]; stream: unknown; failed: string;
};

function useHub(page: Page, url: string): Promise<Session> {
  return page.evaluate(async (hubUrl) => {
    const signalR = (window as unknown as { signalR: any }).signalR; // eslint-disable-line @typescript-eslint/no-explicit-any
    const c = new signalR.HubConnectionBuilder().withUrl(hubUrl).configureLogging(signalR.LogLevel.None).build();
    const out: { notify: unknown[]; doubled: unknown; echoed: unknown; group: unknown[]; stream: unknown; failed: string } =
      { notify: [], doubled: null, echoed: null, group: [], stream: null, failed: '' };
    c.on('Notify', (text: string, n: number) => out.notify.push([text, n]));
    c.on('GroupMsg', (g: string, what: string) => out.group.push([g, what]));
    await c.start();
    for (let i = 0; i < 50 && out.notify.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
    out.doubled = await c.invoke('Double', 21);
    out.echoed = await c.invoke('Echo', 'hi');
    await c.invoke('Join', 'g1');
    for (let i = 0; i < 50 && out.group.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
    try {
      const got: number[] = [];
      await new Promise<void>((resolve, reject) => {
        c.stream('Counter', 3).subscribe({ next: (v: number) => got.push(v), complete: () => resolve(), error: reject });
      });
      out.stream = got;
    } catch (e) {
      out.stream = `error: ${String(e)}`;
    }
    try {
      await c.invoke('Fail');
    } catch (e) {
      out.failed = String(e);
    }
    await c.stop();
    return out;
  }, url);
}

async function readState(s: Awaited<ReturnType<typeof launchWemock>>): Promise<WemockState> {
  return s.worker.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await (globalThis as any).chrome.storage.local.get('wemock.state'))['wemock.state'];
  });
}

test('real hub through wemock, then the same client against the recorded mock', async () => {
  const fixture = await startFixtureServer();
  const s = await launchWemock(fixture.url);
  try {
    await s.setState({ ...emptyState(), enabledOrigins: [fixture.origin], projects: [newProject('p1', fixture.origin)] });
    const page = await s.context.newPage();
    await page.goto(`${fixture.url}/index.html`);
    await page.addScriptTag({ url: '/signalr.js' });
    const tabId = await s.tabIdOf(page);
    const panel = await s.context.newPage();
    await panel.goto(`chrome-extension://${s.extensionId}/panel.html?tabId=${tabId}`);

    // 1. Real hub, through wemock.
    const real = await useHub(page, HUB_URL);
    console.log('REAL', JSON.stringify(real));
    expect(real.notify).toEqual([['Welcome back', 3]]);
    expect(real.doubled).toEqual({ n: 42 });
    expect(real.echoed).toBe('echo:hi');
    expect(real.group).toEqual([['g1', 'joined']]);
    expect(real.stream).toEqual([1, 2, 3]);
    expect(real.failed).toContain('nope');

    const rows = panel.getByTestId('log-row');
    await expect(rows.filter({ hasText: 'negotiate' }).first()).toBeVisible();
    const open = rows.filter({ hasText: '101' }).first();
    await expect(open).toBeVisible();
    console.log('ROWS', JSON.stringify(await rows.locator('.log-col-method').allTextContents()));

    // 2. Mock this socket.
    await open.click();
    await panel.getByTestId('mock-socket').click();
    await expect.poll(async () => (await readState(s)).projects[0]?.scenarios[0]?.sockets?.length ?? 0).toBe(1);
    const sock = (await readState(s)).projects[0]!.scenarios[0]!.sockets![0] as SocketMock;
    console.log('MOCK', JSON.stringify(sock));
    expect(sock.kind).toBe('signalr');
    expect(sock.urlPattern).toBe(new URL(HUB_URL).origin + '/hubs/shop');
    expect(sock.onConnect.map((p) => [p.target, p.data])).toContainEqual(['Notify', '["Welcome back",3]']);
    expect(sock.replies.map((r) => [r.when, r.result])).toEqual(expect.arrayContaining([['Double', '{"n":42}'], ['Echo', '"echo:hi"']]));
    // A30: GroupMsg came right after Join's answer, so it is Join's push, not an on-connect message.
    expect(sock.onConnect.map((p) => p.target)).not.toContain('GroupMsg');
    expect(sock.replies.find((r) => r.when === 'Join')?.pushes.map((p) => p.target)).toEqual(['GroupMsg']);
    // A31, A32: the error and the stream are kept.
    expect(sock.replies.find((r) => r.when === 'Fail')?.respond).toBe('error');
    expect(sock.replies.find((r) => r.when === 'Counter')).toMatchObject({ respond: 'stream', result: '[1,2,3]' });

    // 3. The hub is gone; the mock answers the same client code.
    execSync(`docker stop ${HUB_NAME}`, { stdio: 'ignore' });
    await page.reload();
    await page.addScriptTag({ url: '/signalr.js' });
    const mocked = await useHub(page, HUB_URL);
    console.log('MOCKED', JSON.stringify(mocked));
    expect(mocked.notify).toEqual([['Welcome back', 3]]);
    expect(mocked.doubled).toEqual({ n: 42 });
    expect(mocked.echoed).toBe('echo:hi');
    expect(mocked.group).toEqual([['g1', 'joined']]);
    expect(mocked.stream).toEqual([1, 2, 3]);
    expect(mocked.failed).toContain('nope');
    await expect(rows.filter({ hasText: 'MOCK' }).filter({ hasText: '101' }).first()).toBeVisible();
  } finally {
    await s.context.close();
    await fixture.close();
  }
});
