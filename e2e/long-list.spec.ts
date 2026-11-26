// A scenario with hundreds of mocks must scroll, so its last mock can be reached and opened.
import { expect, test, type Page } from '@playwright/test';
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

function mock(i: number): Mock {
  return {
    id: `m${i}`,
    name: `Item ${i}`,
    enabled: true,
    method: 'GET',
    urlPattern: `/api/items/${i}`,
    response: { status: 200, headers: {}, body: '{}', bodyEncoding: 'text', delayMs: 0 },
    source: 'manual',
    createdAt: 0,
  };
}

function project(): Project {
  return {
    id: 'p1',
    name: 'site',
    origins: [fixture.origin],
    activeScenarioId: 'default',
    scenarios: [
      { id: 'default', name: 'Default', mocks: Array.from({ length: 700 }, (_, i) => mock(i + 1)) },
      { id: 'b', name: 'Errors', mocks: [mock(9001)] },
    ],
  };
}

async function openMocks(): Promise<Page> {
  await session.setState({ ...emptyState(), enabledOrigins: [fixture.origin], projects: [project()] });
  const page = await session.context.newPage();
  await page.goto(`${fixture.url}/index.html`);
  const tabId = await session.tabIdOf(page);
  const panel = await session.context.newPage();
  await panel.setViewportSize({ width: 1280, height: 800 });
  await panel.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);
  await panel.evaluate(() => localStorage.removeItem('wemock.folded.p1'));
  await panel.reload();
  await panel.getByTestId('tab-mocks').click();
  await expect(panel.getByTestId('mock-row')).toHaveCount(701);
  return panel;
}

/** Wheel over the list until the row is on screen, as a user would: no scrollIntoView. */
async function wheelTo(panel: Page, name: RegExp): Promise<{ x: number; y: number; width: number; height: number }> {
  // The row's name cell, so the status and other text beside it do not matter.
  const row = panel.getByTestId('mock-row').filter({ has: panel.locator('.mock-name-or-pattern', { hasText: name }) });
  await expect(row).toHaveCount(1);
  const first = await panel.getByTestId('mock-row').first().boundingBox();
  await panel.mouse.move(first!.x + 40, first!.y + 4);
  for (let i = 0; i < 50; i++) {
    const box = await row.boundingBox();
    // On screen, full height, and the point a click would land on is inside this row.
    const clickable = await row.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + 40, r.y + r.height / 2);
      return r.height >= 20 && hit !== null && el.contains(hit);
    });
    if (box && box.y > 0 && box.y < 760 && clickable) return box;
    await panel.mouse.wheel(0, 600);
    await panel.waitForTimeout(30);
  }
  const box = await row.boundingBox();
  throw new Error(`50 wheel turns did not make ${name} clickable: top y = ${box?.y}, height = ${box?.height}`);
}

// Building and drawing a list this long takes a few seconds; on a machine busy with other work it passed
// the default 30 s twice. These two tests prove the list scrolls, not how fast, so each has 90 s.
test('the mouse wheel scrolls a list of 700 mocks to its last one, which then opens', async () => {
  test.setTimeout(90_000);
  const panel = await openMocks();
  try {
    const box = await wheelTo(panel, /Item 700$/);
    await panel.mouse.click(box.x + 40, box.y + box.height / 2);
    await expect(panel.getByTestId('field-pattern')).toHaveValue('/api/items/700');
  } finally {
    await panel.close();
  }
});

test('the scenario after a 700-mock Default is reachable by the wheel too', async () => {
  test.setTimeout(90_000);
  const panel = await openMocks();
  try {
    const box = await wheelTo(panel, /Item 9001$/);
    await panel.mouse.click(box.x + 40, box.y + box.height / 2);
    await expect(panel.getByTestId('field-pattern')).toHaveValue('/api/items/9001');
  } finally {
    await panel.close();
  }
});
