// Claude's review tests for the panel's header, left rail, messages and Delete all. Change the code, not these tests, to make them pass.
import { expect, test, type Page } from '@playwright/test';
import { emptyState, type Mock, type Project, type SocketMock, type WemockState } from '../src/core/types';
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

const hub: SocketMock = { id: 's1', name: 'Hub', enabled: true, kind: 'signalr', urlPattern: '/hubs/x', onConnect: [], replies: [], createdAt: 0 };

function project(): Project {
  return {
    id: 'p1', name: 'site', origins: [fixture.origin], activeScenarioId: 'default',
    scenarios: [
      { id: 'default', name: 'Default', mocks: [mock('m1', '/api/a', 'A'), mock('m2', '/api/b', 'B')], sockets: [hub] },
      { id: 'e', name: 'Errors', mocks: [mock('m3', '/api/c', 'C')] },
    ],
  };
}

async function readState(): Promise<WemockState> {
  return session.worker.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await (globalThis as any).chrome.storage.local.get('wemock.state'))['wemock.state'];
  });
}

async function openPanel(): Promise<{ page: Page; panel: Page }> {
  await session.setState({ ...emptyState(), enabledOrigins: [fixture.origin], projects: [project()] });
  const page = await session.context.newPage();
  await page.goto(`${fixture.url}/index.html`);
  const tabId = await session.tabIdOf(page);
  const panel = await session.context.newPage();
  await panel.setViewportSize({ width: 1280, height: 800 });
  await panel.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);
  return { page, panel };
}

async function x(panel: Page, id: string): Promise<number> {
  const box = await panel.getByTestId(id).boundingBox();
  expect(box, `${id} is on screen`).not.toBeNull();
  return box!.x;
}

test('the header reads: project, Import, Export, Sample, then Rec, Console and On/off on the right', async () => {
  const { page, panel } = await openPanel();
  try {
    const order = ['project-picker', 'import-open', 'export-open', 'sample-load-toolbar', 'rec-toggle', 'console-toggle', 'power-toggle'];
    const xs: number[] = [];
    for (const id of order) xs.push(await x(panel, id));
    for (let i = 1; i < xs.length; i++) expect(xs[i]!, `${order[i]} is right of ${order[i - 1]}`).toBeGreaterThan(xs[i - 1]!);
    const tops = await Promise.all(order.map(async (id) => (await panel.getByTestId(id).boundingBox())!.y));
    expect(Math.max(...tops) - Math.min(...tops), 'all on one row at 1280 px').toBeLessThan(12);
    await expect(panel.getByTestId('import-open')).toHaveText(/Import/);
    await expect(panel.getByTestId('export-open')).toHaveText(/Export/);
    await expect(panel.getByTestId('sample-load-toolbar')).toHaveText(/Sample/);
  } finally {
    await panel.close(); await page.close();
  }
});

test('Log and Mocks sit in a rail on the left, the open one marked, each with its count', async () => {
  const { page, panel } = await openPanel();
  try {
    const rail = panel.getByRole('navigation');
    await expect(rail.getByTestId('tab-log')).toBeVisible();
    await expect(rail.getByTestId('tab-mocks')).toBeVisible();
    const log = (await panel.getByTestId('tab-log').boundingBox())!;
    const mocks = (await panel.getByTestId('tab-mocks').boundingBox())!;
    expect(mocks.y, 'Mocks is under Log').toBeGreaterThan(log.y + log.height - 2);
    expect(Math.abs(mocks.x - log.x), 'one column').toBeLessThan(4);

    await panel.getByTestId('tab-mocks').click();
    await expect(panel.getByTestId('tab-mocks')).toHaveAttribute('aria-current', 'page');
    await expect(panel.getByTestId('tab-log')).not.toHaveAttribute('aria-current', 'page');
    expect(mocks.x + mocks.width, 'the rail is left of the list').toBeLessThanOrEqual(await x(panel, 'mocks-filter'));
    // 3 mocks and 1 socket mock in the project.
    await expect(panel.getByTestId('tab-mocks-count')).toHaveText('4');

    await page.evaluate(() => fetch('/api/real-one').catch(() => {}));
    await expect(panel.getByTestId('tab-log-count')).not.toHaveText('0');
    await panel.getByTestId('tab-log').click();
    await expect(panel.getByTestId('tab-log')).toHaveAttribute('aria-current', 'page');
  } finally {
    await panel.close(); await page.close();
  }
});

test('the Mocks tab has no toolbar row and no Test bar', async () => {
  const { page, panel } = await openPanel();
  try {
    await panel.getByTestId('tab-mocks').click();
    await expect(panel.getByTestId('mocks-filter')).toBeVisible();
    for (const gone of ['export', 'clear-all', 'test-bar', 'test-url', 'sample-tip', 'import-choice']) {
      await expect(panel.getByTestId(gone), `${gone} is gone`).toHaveCount(0);
    }
  } finally {
    await panel.close(); await page.close();
  }
});

test('text is at least 13 px and field labels are not in capitals', async () => {
  const { page, panel } = await openPanel();
  try {
    await panel.getByTestId('tab-mocks').click();
    await panel.getByTestId('mock-row').first().click();
    await expect(panel.getByTestId('field-name')).toBeVisible();
    const sizes = await panel.evaluate(() => {
      const px = (el: Element | null) => (el ? parseFloat(getComputedStyle(el).fontSize) : 0);
      const label = document.querySelector('label');
      return {
        body: px(document.body),
        filter: px(document.querySelector('[data-testid="mocks-filter"]')),
        name: px(document.querySelector('[data-testid="field-name"]')),
        labelTransform: label ? getComputedStyle(label).textTransform : 'none',
      };
    });
    expect(sizes.body).toBeGreaterThanOrEqual(13);
    expect(sizes.filter).toBeGreaterThanOrEqual(13);
    expect(sizes.name).toBeGreaterThanOrEqual(13);
    expect(sizes.labelTransform).not.toBe('uppercase');
  } finally {
    await panel.close(); await page.close();
  }
});

test('Sample in the header loads the sample with a message and Undo', async () => {
  const { page, panel } = await openPanel();
  try {
    await panel.getByTestId('tab-mocks').click();
    await panel.getByTestId('sample-load-toolbar').click();
    await expect(panel.getByTestId('undo-bar')).toContainText('Sample loaded: a small shop with 3 scenarios');
    await expect.poll(async () => (await readState()).projects[0]!.scenarios.length).toBeGreaterThan(2);
    await panel.getByTestId('undo').click();
    await expect.poll(async () => (await readState()).projects[0]!.scenarios.map((s) => s.name)).toEqual(['Default', 'Errors']);
  } finally {
    await panel.close(); await page.close();
  }
});

test('the red bin by the filter asks first, then deletes all, with Undo', async () => {
  const { page, panel } = await openPanel();
  try {
    await panel.getByTestId('tab-mocks').click();
    const bin = panel.getByTestId('delete-all');
    expect(await x(panel, 'delete-all'), 'the bin is right of the filter').toBeGreaterThan(await x(panel, 'mocks-filter'));

    await bin.click();
    await expect(panel.getByTestId('confirm-dialog')).toBeVisible();
    await expect(panel.getByTestId('confirm-dialog')).toHaveAttribute('role', /dialog/);
    await panel.getByTestId('confirm-cancel').click();
    await expect(panel.getByTestId('confirm-dialog')).toHaveCount(0);
    expect((await readState()).projects[0]!.scenarios[0]!.mocks).toHaveLength(2);

    await bin.click();
    await panel.keyboard.press('Escape');
    await expect(panel.getByTestId('confirm-dialog')).toHaveCount(0);
    expect((await readState()).projects[0]!.scenarios[0]!.mocks).toHaveLength(2);

    await bin.click();
    await panel.getByTestId('confirm-ok').click();
    await expect.poll(async () => (await readState()).projects[0]!.scenarios.map((s) => [s.name, s.mocks.length])).toEqual([['Default', 0]]);
    await expect(panel.getByTestId('undo-bar')).toContainText('Deleted all scenarios and mocks');
    await panel.getByTestId('undo').click();
    await expect.poll(async () => (await readState()).projects[0]!.scenarios.map((s) => [s.name, s.mocks.length])).toEqual([['Default', 2], ['Errors', 1]]);
  } finally {
    await panel.close(); await page.close();
  }
});

test('messages sit at the bottom, are announced politely, and show at most 3', async () => {
  const { page, panel } = await openPanel();
  try {
    await panel.getByTestId('tab-mocks').click();
    for (let i = 0; i < 4; i++) {
      await panel.getByTestId('export-open').click();
      const dl = panel.waitForEvent('download');
      await panel.getByTestId('export-project').click();
      await dl;
    }
    const toasts = panel.getByTestId('toast');
    await expect(toasts.first()).toBeVisible();
    expect(await toasts.count()).toBeLessThanOrEqual(3);
    const live = await toasts.first().evaluate((el) => el.closest('[aria-live]')?.getAttribute('aria-live'));
    expect(live).toBe('polite');
    const box = (await toasts.first().boundingBox())!;
    expect(box.y, 'in the bottom third').toBeGreaterThan(800 * 0.66);
  } finally {
    await panel.close(); await page.close();
  }
});

test('only the newest change can be undone, so an old Undo never rolls back later work', async () => {
  const { page, panel } = await openPanel();
  try {
    await panel.getByTestId('tab-mocks').click();
    await panel.getByTestId('sample-load-toolbar').click();
    await expect(panel.getByTestId('undo-bar')).toHaveCount(1);
    await panel.getByTestId('delete-all').click();
    await panel.getByTestId('confirm-ok').click();
    await expect(panel.getByTestId('undo-bar')).toHaveCount(1);
    await expect(panel.getByTestId('undo-bar')).toContainText('Deleted all scenarios and mocks');
    await panel.getByTestId('undo').click();
    // Back to just after the sample, not to before it.
    await expect.poll(async () => (await readState()).projects[0]!.scenarios.length).toBeGreaterThan(2);
  } finally {
    await panel.close(); await page.close();
  }
});
