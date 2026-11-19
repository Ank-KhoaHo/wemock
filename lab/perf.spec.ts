// The lab's timing run: the panel with 900 mocks from the lab's OpenAPI file and 900 calls in the
// Log. Each step is timed from the input to the next painted frame. The times go to lab/out/ and to
// the console; a step slower than the panel's budget (100 ms) is a soft failure, so every step runs.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { emptyState, type Project, type WemockState } from '../src/core/types';
import { type WemockSession, launchWemock } from '../e2e/helpers';

const LAB = process.env.LAB_URL ?? 'http://localhost:5199';
const ORIGIN = new URL(LAB).origin;
const BUDGET_MS = 100;
const OUT = path.resolve('lab/out');

let session: WemockSession;

test.beforeAll(async () => {
  session = await launchWemock(LAB);
});

test.afterAll(async () => {
  await session?.context?.close();
});

/** 900 mocks, as an import of the lab's OpenAPI file makes them, in Default. */
async function nineHundred(): Promise<Project> {
  const spec = JSON.parse(await (await fetch(`${LAB}/openapi.json`)).text()) as { paths: Record<string, { get: { summary: string; responses: { '200': { content: { 'application/json': { example: unknown } } } } } }> };
  const mocks = Object.entries(spec.paths).map(([url, op], i) => ({
    id: `i${i + 1}`,
    name: op.get.summary,
    enabled: true,
    method: 'GET' as const,
    urlPattern: url,
    response: {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(op.get.responses['200'].content['application/json'].example),
      bodyEncoding: 'text' as const,
      delayMs: 0,
    },
    source: 'recorded' as const,
    createdAt: 0,
  }));
  return {
    id: 'lab', name: 'lab', origins: [ORIGIN], activeScenarioId: 'default',
    scenarios: [{ id: 'default', name: 'Default', mocks }, { id: 'down', name: 'Checkout down', mocks: mocks.slice(0, 3).map((m) => ({ ...m, id: `d-${m.id}` })) }],
  };
}

/** Milliseconds from now until the panel has painted the result of `act`. */
async function timed(panel: Page, act: () => Promise<void>): Promise<number> {
  const t0 = Date.now();
  await act();
  await panel.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
  return Date.now() - t0;
}

async function typeTimed(panel: Page, selector: string, text: string): Promise<number[]> {
  const field = panel.getByTestId(selector);
  await field.click();
  const times: number[] = [];
  for (const ch of text) times.push(await timed(panel, () => field.press(ch === ' ' ? 'Space' : ch)));
  return times;
}

/** Long tasks (main thread busy for over 50 ms) seen while `act` runs, in total milliseconds. */
async function longTasks(panel: Page, act: () => Promise<void>): Promise<{ count: number; totalMs: number }> {
  await panel.evaluate(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__long.push(e.duration); }).observe({ type: 'longtask', buffered: false });
  });
  await act();
  await panel.waitForTimeout(300);
  const d = await panel.evaluate(() => (window as unknown as { __long: number[] }).__long);
  return { count: d.length, totalMs: Math.round(d.reduce((a, b) => a + b, 0)) };
}

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))]!;

test('the panel with 900 mocks and 900 logged calls stays within its budget', async () => {
  test.setTimeout(300_000);
  const project = await nineHundred();
  await session.setState({ ...emptyState(), enabledOrigins: [ORIGIN], projects: [project] } as WemockState);
  const page = await session.context.newPage();
  await page.goto(LAB);
  const tabId = await session.tabIdOf(page);
  const panel = await session.context.newPage();
  await panel.setViewportSize({ width: 1280, height: 800 });
  await panel.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);

  const results: Record<string, unknown> = {};
  try {
    // 900 calls, every one answered by a mock, so the Log shows each of them.
    await page.click('#many');
    await expect(page.locator('[data-r="many"]')).toContainText('900 of 900 ok', { timeout: 120_000 });
    await expect(panel.getByTestId('tab-log-count')).toHaveText(/^9\d\d$/, { timeout: 30_000 });

    results.openMocksTab = await timed(panel, async () => {
      await panel.getByTestId('tab-mocks').click();
      await panel.getByTestId('mock-row').first().waitFor();
    });

    const filterKeys = await typeTimed(panel, 'mocks-filter', 'item 45');
    results.filterKeyP95 = p95(filterKeys);
    results.filterKeys = filterKeys;
    const clear = await timed(panel, () => panel.getByTestId('mocks-filter').fill(''));
    results.filterClear = clear;

    const row = panel.getByTestId('mock-row').first();
    await row.hover();
    const scroll = await longTasks(panel, async () => {
      for (let i = 0; i < 20; i++) {
        await panel.mouse.wheel(0, 800);
        await panel.waitForTimeout(16);
      }
    });
    results.scrollLongTasks = scroll;

    results.openMock = await timed(panel, async () => {
      await panel.getByTestId('mock-row').nth(3).click();
      await panel.getByTestId('field-name').waitFor();
    });

    const editKeys = await typeTimed(panel, 'field-name', ' renamed');
    results.editorKeyP95 = p95(editKeys);
    results.editorKeys = editKeys;

    results.foldDefault = await timed(panel, () => panel.locator('.scenario-group').first().getByTestId('scenario-fold').click());
    results.unfoldDefault = await timed(panel, () => panel.locator('.scenario-group').first().getByTestId('scenario-fold').click());

    await panel.getByTestId('tab-log').click();
    const logKeys = await typeTimed(panel, 'log-filter', 'items/45');
    results.logFilterKeyP95 = p95(logKeys);
    results.logFilterKeys = logKeys;
  } finally {
    fs.mkdirSync(OUT, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(OUT, `perf-${stamp}.json`), JSON.stringify(results, null, 2) + '\n', 'utf-8');
    console.log('lab perf (ms):', JSON.stringify(results));
    await panel.close();
    await page.close();
  }

  expect.soft(results.openMocksTab as number, 'opening the Mocks tab').toBeLessThan(1000);
  expect.soft(results.filterKeyP95 as number, 'a key in Filter mocks (95th percentile)').toBeLessThan(BUDGET_MS);
  expect.soft(results.filterClear as number, 'clearing Filter mocks').toBeLessThan(BUDGET_MS * 3);
  expect.soft((results.scrollLongTasks as { totalMs: number }).totalMs, 'main thread busy while scrolling').toBeLessThan(200);
  expect.soft(results.openMock as number, 'opening a mock').toBeLessThan(BUDGET_MS * 3);
  expect.soft(results.editorKeyP95 as number, 'a key in the editor (95th percentile)').toBeLessThan(BUDGET_MS);
  expect.soft(results.foldDefault as number, 'folding a 900-mock scenario').toBeLessThan(BUDGET_MS * 3);
  expect.soft(results.unfoldDefault as number, 'unfolding it').toBeLessThan(BUDGET_MS * 5);
  expect.soft(results.logFilterKeyP95 as number, 'a key in the Log filter (95th percentile)').toBeLessThan(BUDGET_MS);
});
