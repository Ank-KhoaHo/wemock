import { expect, test, type Locator, type Page } from '@playwright/test';
import { ensureProject } from '../src/core/record';
import { emptyState } from '../src/core/types';
import { newId } from '../src/shared/ids';
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

test.beforeEach(async () => {
  const { state } = ensureProject({ ...emptyState(), enabledOrigins: [fixture.origin] }, fixture.origin, newId);
  await session.setState(state);
});

async function openPanel(height: number): Promise<{ page: Page; panel: Page }> {
  const page = await session.context.newPage();
  await page.goto(`${fixture.url}/index.html`);
  const tabId = await session.tabIdOf(page);
  const panel = await session.context.newPage();
  await panel.setViewportSize({ width: 1000, height });
  await panel.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);
  return { page, panel };
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox();
  if (!found) throw new Error('The element is not visible');
  return found;
}

/** Room left between the bottom of `inner` and the bottom of `outer`. */
async function roomBelow(outer: Locator, inner: Locator): Promise<number> {
  const o = await box(outer);
  const i = await box(inner);
  return o.y + o.height - (i.y + i.height);
}

test('the Log response body fills the detail pane, and keeps a usable height when short', async () => {
  const { page, panel } = await openPanel(900);
  try {
    await page.click('#btn-fetch');
    await panel.getByTestId('log-row').click();
    const pane = panel.locator('.panel-split-right', { has: panel.locator('.log-detail') });
    const body = panel.getByTestId('response-body');
    expect(await roomBelow(pane, body)).toBeLessThan(24);

    await panel.setViewportSize({ width: 1000, height: 360 });
    expect((await box(body)).height).toBeGreaterThanOrEqual(200);
  } finally {
    await panel.close();
    await page.close();
  }
});

test('the mock editor body fills the editor down to the templates option, and keeps a usable height when short', async () => {
  const { page, panel } = await openPanel(900);
  try {
    await panel.getByTestId('tab-mocks').click();
    await panel.getByTestId('add-menu-open').click();
    await panel.getByTestId('mock-new').click();
    await expect(panel.getByTestId('field-pattern')).toHaveValue('/');
    const editor = panel.locator('.mock-editor-container');
    const templates = panel.locator('.templates-group');
    const code = panel.locator('.text-editor-view .cm-editor');
    await expect(code).toBeVisible();

    expect(await roomBelow(editor, templates)).toBeLessThan(24);
    expect((await box(code)).height).toBeGreaterThan(240);

    await panel.setViewportSize({ width: 1000, height: 400 });
    expect((await box(panel.locator('.text-editor-view'))).height).toBeGreaterThanOrEqual(200);
    await expect(panel.getByTestId('field-templates')).toBeAttached();
  } finally {
    await panel.close();
    await page.close();
  }
});
