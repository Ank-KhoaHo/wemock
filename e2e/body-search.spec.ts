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

async function openPanel(): Promise<{ page: Page; panel: Page }> {
  const page = await session.context.newPage();
  await page.goto(`${fixture.url}/index.html`);
  const tabId = await session.tabIdOf(page);
  const panel = await session.context.newPage();
  await panel.setViewportSize({ width: 1000, height: 600 });
  await panel.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);
  return { page, panel };
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox();
  if (!found) throw new Error('The element is not visible');
  return found;
}

/** Drags the body far taller than the pane, then scrolls the pane to the bottom. */
async function growAndScroll(panel: Page): Promise<void> {
  const handle = panel.getByTestId('body-resize-handle').filter({ visible: true });
  await handle.focus();
  for (let i = 0; i < 12; i++) await handle.press('Shift+ArrowDown');
  await handle.evaluate((el) => el.scrollIntoView({ block: 'end' }));
}

async function expectFindBelowHeader(panel: Page, header: Locator): Promise<void> {
  const find = panel.locator('.cm-search');
  await expect(find).toBeVisible();
  const f = await box(find);
  const h = await box(header);
  expect(f.y).toBeGreaterThanOrEqual(h.y + h.height);
  expect(f.y).toBeLessThan(h.y + h.height + 24);
}

test('Ctrl+F in the read-only Log body opens a find box that floats over it and stays below the header', async () => {
  const { page, panel } = await openPanel();
  try {
    await page.click('#btn-fetch');
    await panel.getByTestId('log-row').click();
    const body = panel.getByTestId('response-body');
    const content = body.locator('.cm-content');
    await expect(content).toContainText('"source": "server"');
    const before = await content.textContent();
    await content.click();
    await panel.keyboard.type('x');
    await expect(content).toHaveText(before ?? '');

    await panel.keyboard.press('Control+f');
    await expect(panel.locator('.cm-search input[name=search]')).toBeFocused();
    await expect(panel.locator('.cm-search input[name=replace]')).toHaveCount(0);
    expect((await box(body.locator('.cm-scroller'))).y).toBe((await box(body.locator('.cm-editor'))).y);
    await panel.keyboard.type('server');
    await expect(panel.locator('.cm-search-count')).toHaveText('? of 1');
    await expect(body.locator('.cm-match-mark')).toHaveCount(1);

    await growAndScroll(panel);
    await expectFindBelowHeader(panel, panel.locator('.detail-header'));
  } finally {
    await panel.close();
    await page.close();
  }
});

test('the find box of the mock body stays below the editor header when the body is taller than the pane', async () => {
  const { page, panel } = await openPanel();
  try {
    await panel.getByTestId('tab-mocks').click();
    await panel.getByTestId('add-menu-open').click();
    await panel.getByTestId('mock-new').click();
    await expect(panel.getByTestId('field-pattern')).toHaveValue('/');
    await panel.locator('.body-editor-container .cm-content').click();
    await panel.keyboard.press('Control+f');
    await expect(panel.locator('.cm-search input[name=search]')).toBeFocused();

    await growAndScroll(panel);
    await expectFindBelowHeader(panel, panel.locator('.mock-editor-header'));
  } finally {
    await panel.close();
    await page.close();
  }
});

test('Ctrl+F and Escape used by the editor do not reach the document, where DevTools picks up shortcuts', async () => {
  const { page, panel } = await openPanel();
  try {
    await page.click('#btn-fetch');
    await panel.getByTestId('log-row').click();
    const content = panel.getByTestId('response-body').locator('.cm-content');
    await expect(content).toContainText('"source": "server"');
    await panel.evaluate(() => {
      const keys: string[] = [];
      Object.assign(window, { forwardedKeys: keys });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'f' || e.key === 'Escape') keys.push(e.key);
      });
    });
    const forwarded = () => panel.evaluate(() => (window as unknown as { forwardedKeys: string[] }).forwardedKeys);

    await content.click();
    await panel.keyboard.press('Control+f');
    await expect(panel.locator('.cm-search')).toBeVisible();
    await panel.keyboard.press('Escape');
    await expect(panel.locator('.cm-search')).toHaveCount(0);
    expect(await forwarded()).toEqual([]);

    await panel.locator('.detail-header').click();
    await panel.keyboard.press('Control+f');
    expect(await forwarded()).toEqual(['f']);
  } finally {
    await panel.close();
    await page.close();
  }
});

test('the find box counts the matches and marks them at the right edge of the body', async () => {
  const { page, panel } = await openPanel();
  try {
    await panel.getByTestId('tab-mocks').click();
    await panel.getByTestId('add-menu-open').click();
    await panel.getByTestId('mock-new').click();
    const content = panel.locator('.body-editor-container .cm-content');
    await content.fill('["ab", "ab", "ab"]');
    await content.click();
    await panel.keyboard.press('Control+f');
    const input = panel.locator('.cm-search input[name=search]');
    const count = panel.locator('.cm-search-count');
    const marks = panel.locator('.cm-match-mark');

    await input.pressSequentially('ab');
    await expect(count).toHaveText('? of 3');
    await expect(marks).toHaveCount(3);
    await input.press('Enter');
    await expect(count).toHaveText('1 of 3');
    await input.press('Enter');
    await expect(count).toHaveText('2 of 3');
    await expect(panel.locator('.cm-match-mark-active')).toHaveCount(1);

    await input.selectText();
    await input.pressSequentially('zz');
    await expect(count).toHaveText('No results');
    await expect(marks).toHaveCount(0);

    await input.selectText();
    await input.pressSequentially('ab');
    await expect(marks).toHaveCount(3);
    await input.press('Escape');
    await expect(count).toHaveCount(0);
    await expect(marks).toHaveCount(0);
  } finally {
    await panel.close();
    await page.close();
  }
});
