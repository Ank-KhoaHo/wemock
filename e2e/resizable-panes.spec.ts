import { expect, test, type Page } from '@playwright/test';
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

async function openNewMock(width: number): Promise<{ page: Page; panel: Page }> {
  const { state } = ensureProject({ ...emptyState(), enabledOrigins: [fixture.origin] }, fixture.origin, newId);
  await session.setState(state);
  const page = await session.context.newPage();
  await page.goto(`${fixture.url}/index.html`);
  const tabId = await session.tabIdOf(page);
  const panel = await session.context.newPage();
  await panel.setViewportSize({ width, height: 600 });
  await panel.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);
  await panel.evaluate(() => localStorage.removeItem('wemock.paneWidth.mocks'));
  await panel.getByTestId('tab-mocks').click();
  await panel.getByTestId('add-menu-open').click();
  await panel.getByTestId('mock-new').click();
  await expect(panel.getByTestId('field-pattern')).toHaveValue('/');
  return { page, panel };
}

function detailWidth(panel: Page): Promise<number> {
  return panel
    .locator('.panel-split-right')
    .filter({ visible: true })
    .evaluate((el) => el.getBoundingClientRect().width);
}

test('dragging the divider resizes the detail pane, keeps it after a reload, and a double-click resets it', async () => {
  const { page, panel } = await openNewMock(1200);
  try {
    const before = await detailWidth(panel);
    const handle = panel.getByTestId('split-handle').filter({ visible: true });
    const box = (await handle.boundingBox())!;
    await panel.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await panel.mouse.down();
    await panel.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2, { steps: 5 });
    await panel.mouse.up();
    const dragged = await detailWidth(panel);
    expect(dragged).toBeGreaterThan(before + 140);

    await panel.reload();
    await panel.getByTestId('tab-mocks').click();
    await panel.getByTestId('mock-row').first().click();
    expect(Math.round(await detailWidth(panel))).toBe(Math.round(dragged));

    await panel.getByTestId('split-handle').filter({ visible: true }).dblclick();
    expect(Math.round(await detailWidth(panel))).toBe(Math.round(before));
  } finally {
    await panel.close();
    await page.close();
  }
});

test('the arrow keys move the divider', async () => {
  const { page, panel } = await openNewMock(1200);
  try {
    const before = await detailWidth(panel);
    await panel.getByTestId('split-handle').filter({ visible: true }).focus();
    await panel.keyboard.press('ArrowLeft');
    expect(Math.round(await detailWidth(panel))).toBe(Math.round(before) + 16);
    await panel.keyboard.press('Shift+ArrowRight');
    expect(Math.round(await detailWidth(panel))).toBe(Math.round(before) + 16 - 64);
  } finally {
    await panel.close();
    await page.close();
  }
});

test('a narrow panel shows no divider, as the list and the detail take turns', async () => {
  const { page, panel } = await openNewMock(600);
  try {
    await expect(panel.getByTestId('split-handle').filter({ visible: true })).toHaveCount(0);
  } finally {
    await panel.close();
    await page.close();
  }
});
