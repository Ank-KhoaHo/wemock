import { expect, test } from '@playwright/test';
import { emptyState, type WemockState } from '../src/core/types';
import { type FixtureServer, startFixtureServer } from './fixture/server';
import { type WemockSession, launchWemock } from './helpers';

// A7: "Mock this" on a call to another origin keeps that origin in the pattern.
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

test('Mock this on a cross-origin call keeps its host; a same-origin call keeps the path', async () => {
  await session.setState({ ...emptyState(), enabledOrigins: [fixture.origin] });
  const page = await session.context.newPage();
  const panel = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panel.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);
    const other = `http://localhost:${fixture.port}`;
    await page.evaluate(async (o) => {
      await (await fetch(`${o}/api/goals`)).text();
      await (await fetch('/api/goals')).text();
    }, other);

    const rows = panel.getByTestId('log-row');
    await expect(rows).toHaveCount(2);
    await rows.nth(0).click();
    await panel.getByTestId('mock-this').click();
    await rows.nth(1).click();
    await panel.getByTestId('mock-this').click();

    await expect
      .poll(async () => (await readState()).projects[0]?.scenarios[0]?.mocks.map((m) => m.urlPattern))
      .toEqual([`${other}/api/goals`, '/api/goals']);
  } finally {
    await panel.close();
    await page.close();
  }
});
