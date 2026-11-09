// Claude's review test: Save in an open editor must not undo the row checkbox.
import { expect, test } from '@playwright/test';
import { emptyState, newProject, type WemockState } from '../src/core/types';
import { type FixtureServer, startFixtureServer } from './fixture/server';
import { type WemockSession, launchWemock } from './helpers';

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

test('unchecking a row, then Save in its open editor, keeps it off (mock and socket)', async () => {
  const project = newProject('p1', fixture.origin);
  project.scenarios[0]!.mocks.push({
    id: 'm', name: 'M', enabled: true, method: 'GET', urlPattern: '/m',
    response: { status: 200, headers: {}, body: '', bodyEncoding: 'text', delayMs: 0 }, source: 'manual', createdAt: 0,
  });
  project.scenarios[0]!.sockets = [{ id: 's', name: 'S', enabled: true, kind: 'plain', urlPattern: '/s', createdAt: 0, onConnect: [], replies: [] }];
  await session.setState({ ...emptyState(), projects: [project], enabledOrigins: [fixture.origin] });
  const page = await session.context.newPage();
  await page.goto(`${fixture.url}/index.html`);
  const tabId = await session.tabIdOf(page);
  const panel = await session.context.newPage();
  try {
    await panel.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);
    await panel.getByTestId('tab-mocks').click();

    await panel.getByTestId('mock-row').first().click();
    await panel.getByTestId('mock-enabled').first().uncheck();
    await expect.poll(async () => (await readState()).projects[0]!.scenarios[0]!.mocks[0]!.enabled).toBe(false);
    await panel.getByTestId('field-name').fill('M2');
    await panel.getByTestId('mock-save').click();
    await expect.poll(async () => (await readState()).projects[0]!.scenarios[0]!.mocks[0]!.name).toBe('M2');
    expect((await readState()).projects[0]!.scenarios[0]!.mocks[0]!.enabled).toBe(false);

    await panel.getByTestId('socket-row').first().click();
    await panel.getByTestId('socket-enabled').first().uncheck();
    await expect.poll(async () => (await readState()).projects[0]!.scenarios[0]!.sockets![0]!.enabled).toBe(false);
    await panel.getByTestId('socket-name').fill('S2');
    await panel.getByTestId('socket-save').click();
    await expect.poll(async () => (await readState()).projects[0]!.scenarios[0]!.sockets![0]!.name).toBe('S2');
    expect((await readState()).projects[0]!.scenarios[0]!.sockets![0]!.enabled).toBe(false);
  } finally {
    await panel.close();
    await page.close();
  }
});
