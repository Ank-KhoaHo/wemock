// Real calls in the Log: a user who lets calls through to the real server must see each one in the
// Log. Each case below makes a real call a different way and checks the Log for it.
import { expect, test, type Page } from '@playwright/test';
import { emptyState, type Project, type WemockState } from '../src/core/types';
import { type WemockSession, launchWemock } from '../e2e/helpers';

const LAB = process.env.LAB_URL ?? 'http://localhost:5199';
const ORIGIN = new URL(LAB).origin;

let session: WemockSession;

test.beforeAll(async () => {
  session = await launchWemock(LAB);
});

test.afterAll(async () => {
  await session?.context?.close();
});

const empty = (): Project => ({
  id: 'lab', name: 'lab', origins: [ORIGIN], activeScenarioId: 'default',
  scenarios: [{ id: 'default', name: 'Default', mocks: [] }],
});

async function start(settings?: Partial<WemockState['settings']>): Promise<Page> {
  const st = { ...emptyState(), enabledOrigins: [ORIGIN], projects: [empty()] };
  await session.setState({ ...st, settings: { ...st.settings, ...settings } });
  const page = await session.context.newPage();
  await page.goto(LAB);
  return page;
}

async function openPanel(page: Page): Promise<Page> {
  const tabId = await session.tabIdOf(page);
  const panel = await session.context.newPage();
  await panel.setViewportSize({ width: 1280, height: 800 });
  await panel.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);
  return panel;
}

async function press(page: Page, id: string): Promise<string> {
  const out = page.locator(`[data-r="${id}"]`);
  await page.click(`#${id}`);
  await expect(out).not.toHaveText(/^(\.\.\.)?$/, { timeout: 15_000 });
  return (await out.textContent()) ?? '';
}

const row = (panel: Page, path: string) => panel.getByTestId('log-row').filter({ hasText: path });

test('calls made before DevTools opened are in the Log when it opens', async () => {
  const page = await start();
  try {
    expect(await press(page, 'product')).toContain('"id":7');
    expect(await press(page, 'search')).toContain('"q":"green"');
    const panel = await openPanel(page);
    await expect(row(panel, '/api/products/7')).toHaveCount(1);
    await expect(row(panel, '/api/products/search')).toHaveCount(1);
    await panel.close();
  } finally {
    await page.close();
  }
});

test('with mocking switched off, real calls are still in the Log', async () => {
  const page = await start({ enabled: false });
  const panel = await openPanel(page);
  try {
    expect(await press(page, 'product')).toContain('"id":7');
    await expect(row(panel, '/api/products/7')).toHaveCount(1);
  } finally {
    await panel.close();
    await page.close();
  }
});

test('calls after a reload are in the Log', async () => {
  const page = await start();
  const panel = await openPanel(page);
  try {
    await page.reload();
    expect(await press(page, 'price')).toContain('"total"');
    await expect(row(panel, '/api/price/7')).toHaveCount(1);
  } finally {
    await panel.close();
    await page.close();
  }
});

test('a call to another origin (the API on 127.0.0.1) is in the Log', async () => {
  const page = await start();
  const panel = await openPanel(page);
  try {
    expect(await press(page, 'cross')).toContain('"id":11');
    await expect(row(panel, '/api/products/11')).toHaveCount(1);
  } finally {
    await panel.close();
    await page.close();
  }
});

test('a call from an iframe on the same site is in the Log', async () => {
  const page = await start();
  const panel = await openPanel(page);
  try {
    expect(await press(page, 'frame')).toContain('"id":9');
    await expect(row(panel, '/api/products/9')).toHaveCount(1);
  } finally {
    await panel.close();
    await page.close();
  }
});

test('a call from a Web Worker is in the Log', async () => {
  // Not yet: wemock's page scripts do not reach a worker's own fetch (README, Limits). This test
  // passes while that holds, and fails the day workers are covered, so the note gets updated.
  test.fail();
  const page = await start();
  const panel = await openPanel(page);
  try {
    expect(await press(page, 'worker')).toContain('"id":10');
    await expect(row(panel, '/api/products/10')).toHaveCount(1);
  } finally {
    await panel.close();
    await page.close();
  }
});

test('after 900 calls, the newest real call is still in the Log', async () => {
  test.setTimeout(240_000);
  const page = await start();
  const panel = await openPanel(page);
  try {
    expect(await press(page, 'many')).toMatch(/^900 of 900 ok/);
    expect(await press(page, 'product')).toContain('"id":7');
    await expect(row(panel, '/api/products/7')).toHaveCount(1);
  } finally {
    await panel.close();
    await page.close();
  }
});
