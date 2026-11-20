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

async function dragBy(panel: Page, handle: Locator, dy: number): Promise<void> {
  await handle.scrollIntoViewIfNeeded();
  const b = await box(handle);
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await panel.mouse.move(x, y);
  await panel.mouse.down();
  await panel.mouse.move(x, y + dy, { steps: 5 });
  await panel.mouse.up();
}

async function heightOf(locator: Locator): Promise<number> {
  return Math.round((await box(locator)).height);
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
    const handle = panel.getByTestId('body-resize-handle').filter({ visible: true });
    expect(await roomBelow(pane, handle)).toBeLessThan(24);

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

test('the Log response body drags taller but never below the fill, and resets for another call', async () => {
  const { page, panel } = await openPanel(900);
  try {
    await page.click('#btn-fetch');
    await page.click('#btn-fetch');
    const rows = panel.getByTestId('log-row');
    await expect(rows).toHaveCount(2);
    await rows.nth(0).click();
    const body = panel.locator('.log-detail .resizable-body');
    const handle = panel.getByTestId('body-resize-handle').filter({ visible: true });
    const filled = await heightOf(body);

    await dragBy(panel, handle, 150);
    expect(await heightOf(body)).toBeGreaterThan(filled + 140);
    await dragBy(panel, handle, -400);
    expect(await heightOf(body)).toBe(filled);

    await dragBy(panel, handle, 150);
    await handle.dblclick();
    expect(await heightOf(body)).toBe(filled);

    await dragBy(panel, handle, 150);
    await rows.nth(1).click();
    expect(await heightOf(body)).toBe(filled);
  } finally {
    await panel.close();
    await page.close();
  }
});

test('the mock editor body drags taller with the templates option below it, and resets for another mock', async () => {
  const { state } = ensureProject({ ...emptyState(), enabledOrigins: [fixture.origin] }, fixture.origin, newId);
  state.projects[0]!.scenarios[0]!.mocks = ['/api/a', '/api/b'].map((urlPattern, i) => ({
    id: `m${i}`,
    enabled: true,
    method: 'GET' as const,
    urlPattern,
    response: { status: 200, headers: {}, body: '{"a":1}', bodyEncoding: 'text' as const, delayMs: 0 },
    source: 'manual' as const,
    createdAt: 0,
  }));
  await session.setState(state);
  const { page, panel } = await openPanel(900);
  try {
    await panel.getByTestId('tab-mocks').click();
    const rows = panel.getByTestId('mock-row');
    await rows.nth(0).click();
    await expect(panel.locator('.text-editor-view .cm-editor')).toBeVisible();
    const body = panel.locator('.body-editor-container .resizable-body');
    const handle = panel.getByTestId('body-resize-handle').filter({ visible: true });
    const filled = await heightOf(body);

    await dragBy(panel, handle, 150);
    expect(await heightOf(body)).toBeGreaterThan(filled + 140);
    expect((await box(panel.locator('.templates-group'))).y).toBeGreaterThan((await box(handle)).y);

    await rows.nth(1).click();
    await expect(panel.getByTestId('field-pattern')).toHaveValue('/api/b');
    expect(await heightOf(body)).toBe(filled);
  } finally {
    await panel.close();
    await page.close();
  }
});

test('holding the body grip at the bottom of the pane keeps the body growing', async () => {
  const { page, panel } = await openPanel(600);
  try {
    await page.click('#btn-fetch');
    await panel.getByTestId('log-row').click();
    const body = panel.locator('.log-detail .resizable-body');
    const handle = panel.getByTestId('body-resize-handle').filter({ visible: true });
    const filled = await heightOf(body);
    await handle.scrollIntoViewIfNeeded();
    const b = await box(handle);
    await panel.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await panel.mouse.down();
    await panel.mouse.move(b.x + b.width / 2, 598, { steps: 3 });
    await panel.waitForTimeout(600);
    await panel.mouse.up();
    expect(await heightOf(body)).toBeGreaterThan(filled + 150);
  } finally {
    await panel.close();
    await page.close();
  }
});

test('the maximize button gives the Log body the whole panel until Escape', async () => {
  const { page, panel } = await openPanel(900);
  try {
    await page.click('#btn-fetch');
    await panel.getByTestId('log-row').click();
    await panel.getByTestId('body-maximize').filter({ visible: true }).click();
    const maximized = panel.locator('.resizable-body.maximized');
    const b = await box(maximized);
    expect(b.width).toBeGreaterThan(950);
    expect(b.height).toBeGreaterThan(850);
    await expect(maximized.getByTestId('response-body')).toBeVisible();

    await panel.keyboard.press('Escape');
    await expect(maximized).toHaveCount(0);
    await expect(panel.locator('.log-detail .resizable-body')).toBeVisible();
  } finally {
    await panel.close();
    await page.close();
  }
});

test('the maximized mock body keeps what is typed in it after it is restored', async () => {
  const { page, panel } = await openPanel(900);
  try {
    await panel.getByTestId('tab-mocks').click();
    await panel.getByTestId('add-menu-open').click();
    await panel.getByTestId('mock-new').click();
    await expect(panel.getByTestId('field-pattern')).toHaveValue('/');
    await panel.getByTestId('body-maximize').filter({ visible: true }).click();
    const code = panel.locator('.resizable-body.maximized .cm-editor');
    expect((await box(code)).height).toBeGreaterThan(800);
    await panel.locator('.resizable-body.maximized .cm-content').fill('{"big":true}');

    await panel.getByRole('button', { name: 'Restore the body' }).click();
    await expect(panel.locator('.resizable-body.maximized')).toHaveCount(0);
    await expect(panel.locator('.body-editor-container .cm-content')).toHaveText('{"big":true}');
  } finally {
    await panel.close();
    await page.close();
  }
});
