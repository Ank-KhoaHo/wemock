import { expect, test, type Page } from '@playwright/test';
import { emptyState, type Project, type WemockState } from '../src/core/types';
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

const TEMPLATE_BODY = '{"id":{{params.id}},"name":"Product {{params.id}}"}';

function project(): Project {
  return {
    id: 'p1',
    name: 'site',
    origins: [fixture.origin],
    activeScenarioId: 'default',
    scenarios: [{
      id: 'default',
      name: 'Default',
      mocks: [{
        id: 'product',
        name: 'Product by id',
        enabled: true,
        method: 'GET',
        urlPattern: '/api/products/:id',
        templates: true,
        response: { status: 200, headers: { 'content-type': 'application/json' }, body: TEMPLATE_BODY, bodyEncoding: 'text', delayMs: 0 },
        source: 'manual',
        createdAt: 0,
      }],
    }],
  };
}

async function readState(): Promise<WemockState> {
  return session.worker.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await (globalThis as any).chrome.storage.local.get('wemock.state'))['wemock.state'];
  });
}

async function openMock(): Promise<{ page: Page; panel: Page }> {
  await session.setState({ ...emptyState(), enabledOrigins: [fixture.origin], projects: [project()] });
  const page = await session.context.newPage();
  await page.goto(`${fixture.url}/index.html`);
  const tabId = await session.tabIdOf(page);
  const panel = await session.context.newPage();
  await panel.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);
  await panel.getByTestId('tab-mocks').click();
  await panel.getByTestId('mock-row').filter({ hasText: 'Product by id' }).click();
  await expect(panel.locator('.cm-content')).toContainText('{{params.id}}');
  return { page, panel };
}

test('a Fill {{templates}} body counts as JSON: shown over lines, no warning, Format works, saved compact', async () => {
  const { page, panel } = await openMock();
  try {
    await expect(panel.locator('.cm-line')).toHaveCount(4);
    await expect(panel.getByTestId('json-warning')).toHaveCount(0);
    await panel.getByTestId('body-format').click();
    await expect(panel.getByTestId('body-format-error')).toHaveCount(0);

    await panel.getByTestId('field-name').fill('Product');
    await panel.getByTestId('mock-save').click();
    await expect
      .poll(async () => (await readState()).projects[0]!.scenarios[0]!.mocks[0]!.response.body)
      .toBe(TEMPLATE_BODY);
  } finally {
    await panel.close();
    await page.close();
  }
});

test('with Fill {{templates}} off, the same body is not valid JSON, as the page would get it as typed', async () => {
  const { page, panel } = await openMock();
  try {
    await panel.getByTestId('field-templates').uncheck();
    await expect(panel.getByTestId('json-warning')).toBeVisible();
    await panel.getByTestId('body-format').click();
    await expect(panel.getByTestId('body-format-error')).toHaveText('Not valid JSON');
  } finally {
    await panel.close();
    await page.close();
  }
});
