// A call made by an iframe on the site is logged and mocked like one from the page itself.
import { expect, test } from '@playwright/test';
import { emptyState, type Mock, type Project } from '../src/core/types';
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

function project(mocks: Mock[]): Project {
  return {
    id: 'p1', name: 'site', origins: [fixture.origin], activeScenarioId: 'default',
    scenarios: [{ id: 'default', name: 'Default', mocks }],
  };
}

const goals: Mock = {
  id: 'g1', name: 'Goals', enabled: true, method: 'GET', urlPattern: '/api/goals',
  response: { status: 200, headers: { 'content-type': 'application/json' }, body: '{"source":"mock"}', bodyEncoding: 'text', delayMs: 0 },
  source: 'manual', createdAt: 0,
};

async function frameCall(withMocks: Mock[]) {
  await session.setState({ ...emptyState(), enabledOrigins: [fixture.origin], projects: [project(withMocks)] });
  const page = await session.context.newPage();
  await page.goto(`${fixture.url}/frame-host.html`);
  const tabId = await session.tabIdOf(page);
  const panel = await session.context.newPage();
  await panel.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);
  await page.evaluate(() => (window as unknown as { callFromFrame: () => void }).callFromFrame());
  return { page, panel };
}

test('a real call from an iframe shows in the Log', async () => {
  const { page, panel } = await frameCall([]);
  try {
    await expect(page.locator('#out')).toHaveText('{"source":"server"}');
    await expect(panel.getByTestId('log-row').filter({ hasText: '/api/goals' })).toHaveCount(1);
  } finally {
    await panel.close();
    await page.close();
  }
});

test('a mock answers a call from an iframe, and the Log marks it MOCK', async () => {
  const { page, panel } = await frameCall([goals]);
  try {
    await expect(page.locator('#out')).toHaveText('{"source":"mock"}');
    await expect(panel.getByTestId('log-row').filter({ hasText: '/api/goals' })).toContainText('MOCK');
  } finally {
    await panel.close();
    await page.close();
  }
});
