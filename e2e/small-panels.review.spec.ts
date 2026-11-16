// Claude's review tests for the panel docked narrow at the side or short at the bottom. Change the code, not these tests, to make them pass.
import { expect, test, type Page } from '@playwright/test';
import { emptyState, type Mock, type Project, type WemockState } from '../src/core/types';
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

function mock(id: string, urlPattern: string, name: string): Mock {
  return {
    id, name, enabled: true, method: 'GET', urlPattern,
    response: { status: 200, headers: {}, body: '{}', bodyEncoding: 'text', delayMs: 0 },
    source: 'manual', createdAt: 0,
  };
}

function project(): Project {
  return {
    id: 'p1', name: 'site', origins: [fixture.origin], activeScenarioId: 'default',
    scenarios: [
      { id: 'default', name: 'Default', mocks: [mock('m1', '/api/products/with/a/rather/long/path/:id', 'A long one'), mock('m2', '/api/me', 'Me')] },
      { id: 'e', name: 'Payments are down for everyone', mocks: [mock('m3', '/api/checkout', 'Checkout')] },
    ],
  };
}

async function readState(): Promise<WemockState> {
  return session.worker.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await (globalThis as any).chrome.storage.local.get('wemock.state'))['wemock.state'];
  });
}

async function openAt(width: number, height: number): Promise<{ page: Page; panel: Page }> {
  await session.setState({ ...emptyState(), enabledOrigins: [fixture.origin], projects: [project()] });
  const page = await session.context.newPage();
  await page.goto(`${fixture.url}/index.html`);
  const tabId = await session.tabIdOf(page);
  const panel = await session.context.newPage();
  await panel.setViewportSize({ width, height });
  await panel.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);
  return { page, panel };
}

async function noSideScroll(panel: Page, where: string) {
  const [sw, cw] = await panel.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw, `${where}: nothing scrolls sideways`).toBeLessThanOrEqual(cw);
}

test('docked right, 400 x 640: icon-only header and rail; list and editor take turns', async () => {
  const { page, panel } = await openAt(400, 640);
  try {
    for (const id of ['import-open', 'export-open', 'sample-load-toolbar']) {
      const b = panel.getByTestId(id);
      await expect(b).toBeVisible();
      expect((await b.boundingBox())!.width, `${id} is an icon`).toBeLessThan(48);
      await expect(b).toHaveAccessibleName(/\w/);
    }
    expect((await panel.getByTestId('tab-mocks').boundingBox())!.width, 'the rail is narrow').toBeLessThan(56);

    await panel.getByTestId('tab-mocks').click();
    await expect(panel.getByTestId('mocks-filter')).toBeVisible();
    await expect(panel.getByTestId('field-pattern')).toHaveCount(0);
    await noSideScroll(panel, 'list');

    await panel.getByTestId('mock-row').first().click();
    await expect(panel.getByTestId('field-pattern')).toBeVisible();
    await expect(panel.getByTestId('mocks-filter')).toBeHidden();
    await noSideScroll(panel, 'editor');
    await panel.getByTestId('field-name').fill('Renamed small');
    await panel.getByTestId('mock-save').click();
    await expect.poll(async () => (await readState()).projects[0]!.scenarios[0]!.mocks[0]!.name).toBe('Renamed small');

    await panel.getByTestId('editor-back').click();
    await expect(panel.getByTestId('mocks-filter')).toBeVisible();
    await panel.getByTestId('mocks-filter').fill('checkout');
    await expect(panel.getByTestId('mock-row')).toHaveCount(1);
    // On a narrow panel the delete icon always shows: there is no hover on touch.
    expect(Number(await panel.getByTestId('mock-row-delete').first().evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(0.9);
  } finally {
    await panel.close(); await page.close();
  }
});

test('docked bottom, 1180 x 300: list and editor side by side, and the editor scrolls', async () => {
  const { page, panel } = await openAt(1180, 300);
  try {
    await panel.getByTestId('tab-mocks').click();
    await panel.getByTestId('mock-row').first().click();
    await expect(panel.getByTestId('mocks-filter')).toBeVisible();
    await expect(panel.getByTestId('field-pattern')).toBeVisible();
    const header = (await panel.getByTestId('import-open').boundingBox())!;
    expect(header.y + header.height, 'the header stays short').toBeLessThan(48);
    await panel.getByTestId('field-name').focus();
    await panel.mouse.move(900, 200);
    await panel.mouse.wheel(0, 2000);
    await expect(panel.getByTestId('field-name')).not.toBeInViewport();
    await noSideScroll(panel, 'short panel');
  } finally {
    await panel.close(); await page.close();
  }
});

test('360 px wide: nothing scrolls sideways in the Log, the list or the editor', async () => {
  const { page, panel } = await openAt(360, 640);
  try {
    await page.evaluate(async () => (await fetch('/api/a-call-with-a-long-name?and=a&query=string')).text().catch(() => ''));
    await expect(panel.getByTestId('log-row').first()).toBeVisible();
    await noSideScroll(panel, 'Log');
    await panel.getByTestId('tab-mocks').click();
    await noSideScroll(panel, 'list');
    await panel.getByTestId('mock-row').first().click();
    await noSideScroll(panel, 'editor');
  } finally {
    await panel.close(); await page.close();
  }
});

test('at 1000 px the header buttons keep their words', async () => {
  const { page, panel } = await openAt(1000, 640);
  try {
    await expect(panel.getByTestId('import-open')).toHaveText(/Import/);
    await expect(panel.getByTestId('export-open')).toHaveText(/Export/);
  } finally {
    await panel.close(); await page.close();
  }
});
