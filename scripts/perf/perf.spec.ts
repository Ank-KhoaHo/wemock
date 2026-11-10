// A25: how fast wemock stays with a full log and many mocks. Run after `npm run build`:
//   npx playwright test --config scripts/perf/perf.config.ts
// Prints one line per measure; fails only past the budgets in the A25 ticket.
import { expect, test, type Page } from '@playwright/test';
import { emptyState, type Mock, type Project, type Scenario } from '../../src/core/types';
import { startFixtureServer } from '../../e2e/fixture/server';
import { launchWemock } from '../../e2e/helpers';

const SCENARIOS = 10;
const PER_SCENARIO = 30;

function mock(i: number, s: number): Mock {
  const base: Mock = {
    id: `m${s}-${i}`, name: `Mock ${s}-${i}`, enabled: true, method: i % 3 === 0 ? 'POST' : 'GET',
    urlPattern: `/api/s${s}/items${i}/:id`,
    response: { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ s, i, rows: Array.from({ length: 20 }, (_, k) => ({ k, label: `row ${k}` })) }), bodyEncoding: 'text', delayMs: 0 },
    source: 'manual', createdAt: 0,
  };
  if (i % 5 === 0) base.match = { query: { page: String(i) } };
  if (i % 7 === 0) base.templates = true;
  return base;
}

function project(origin: string): Project {
  const scenarios: Scenario[] = [];
  for (let s = 0; s < SCENARIOS; s++) {
    scenarios.push({ id: s === 0 ? 'default' : `sc${s}`, name: s === 0 ? 'Default' : `Scenario ${s}`, mocks: Array.from({ length: PER_SCENARIO }, (_, i) => mock(i, s)) });
  }
  // The page's target: the last mock of Default, so matching walks the whole list first.
  scenarios[0]!.mocks.push({ ...mock(999, 0), id: 'target', name: 'Target', urlPattern: '/api/target/:id', method: 'GET' });
  return { id: 'p1', name: 'perf', origins: [origin], activeScenarioId: 'sc9', scenarios };
}

/** Time from a click to the frame after it, measured in the page. */
function clickTime(panel: Page, selector: string, nth = 0): Promise<number> {
  return panel.evaluate(({ selector, nth }) => new Promise<number>((resolve) => {
    const el = document.querySelectorAll<HTMLElement>(selector)[nth]!;
    const t = performance.now();
    el.click();
    requestAnimationFrame(() => setTimeout(() => resolve(performance.now() - t), 0));
  }), { selector, nth });
}

function typeTime(panel: Page, selector: string, value: string): Promise<number> {
  return panel.evaluate(({ selector, value }) => new Promise<number>((resolve) => {
    const el = document.querySelector<HTMLInputElement>(selector)!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    const t = performance.now();
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    requestAnimationFrame(() => setTimeout(() => resolve(performance.now() - t), 0));
  }), { selector, value });
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

test('A25 load check', async () => {
  const fixture = await startFixtureServer();
  const s = await launchWemock(fixture.url);
  const results: Record<string, number> = {};
  try {
    await s.setState({ ...emptyState(), enabledOrigins: [fixture.origin], projects: [project(fixture.origin)] });
    const page = await s.context.newPage();
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await s.tabIdOf(page);

    // Page side: a mocked fetch that has to walk every mock, against a real one.
    results['fetch, mocked, last of 301 (median ms)'] = await page.evaluate(async () => {
      const xs: number[] = [];
      for (let i = 0; i < 60; i++) {
        const t = performance.now();
        await (await fetch(`/api/target/${i}`)).text();
        xs.push(performance.now() - t);
      }
      return xs.sort((a, b) => a - b)[30]!;
    });
    results['fetch, real, no mock (median ms)'] = await page.evaluate(async () => {
      const xs: number[] = [];
      for (let i = 0; i < 60; i++) {
        const t = performance.now();
        await (await fetch('/api/goals')).text();
        xs.push(performance.now() - t);
      }
      return xs.sort((a, b) => a - b)[30]!;
    });

    // Fill the log: 500 rows is the cap; plus a socket with 200 messages.
    await page.evaluate(async () => {
      for (let i = 0; i < 520; i++) await (await fetch(`/api/target/${i}`)).text();
      const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/ws/real`);
      await new Promise((r) => (ws.onopen = r));
      for (let i = 0; i < 200; i++) ws.send(`m${i}`);
      await new Promise((r) => setTimeout(r, 1500));
      ws.close();
    });

    const panel = await s.context.newPage();
    await panel.setViewportSize({ width: 1280, height: 800 });
    const t0 = Date.now();
    await panel.goto(`chrome-extension://${s.extensionId}/panel.html?tabId=${tabId}`);
    await expect(panel.getByTestId('log-row').first()).toBeVisible();
    results['open the panel with a full log (ms, includes Playwright)'] = Date.now() - t0;
    results['log rows shown'] = await panel.getByTestId('log-row').count();

    const rowClicks: number[] = [];
    for (let i = 0; i < 9; i++) rowClicks.push(await clickTime(panel, '[data-testid="log-row"]', i * 40));
    results['select a log row (median ms)'] = median(rowClicks);
    results['type in the log filter (ms)'] = await typeTime(panel, '[data-testid="log-filter"]', 'target/1');
    results['clear the log filter (ms)'] = await typeTime(panel, '[data-testid="log-filter"]', '');
    results['press a Type chip (ms)'] = await clickTime(panel, '[data-testid="log-chip-type-MOCK"]');

    results['switch to the Mocks tab (ms)'] = await clickTime(panel, '[data-testid="tab-mocks"]');
    await expect(panel.getByTestId('mock-row').first()).toBeVisible();
    results['mock rows shown'] = await panel.getByTestId('mock-row').count();
    const opens: number[] = [];
    for (let i = 0; i < 9; i++) opens.push(await clickTime(panel, '[data-testid="mock-row"]', i * 30));
    results['open a mock (median ms)'] = median(opens);
    results['type in the mocks filter (ms)'] = await typeTime(panel, '[data-testid="mocks-filter"]', 'items2');
    results['clear the mocks filter (ms)'] = await typeTime(panel, '[data-testid="mocks-filter"]', '');
    results['toggle a mock on/off (ms)'] = await clickTime(panel, '[data-testid="mock-enabled"]', 100);
    results['switch scenario chip (ms)'] = await clickTime(panel, '[data-testid="scenario-chip"]', 3);
    results['switch back to the Log tab (ms)'] = await clickTime(panel, '[data-testid="tab-log"]');
  } finally {
    for (const [k, v] of Object.entries(results)) console.log(`PERF ${k}: ${typeof v === 'number' ? Math.round(v * 10) / 10 : v}`);
    await s.context.close();
    await fixture.close();
  }
});
