// Claude's review tests for the Mocks list: scenario headers with their own icons, no checkboxes,
// a + menu, and one scroll area. Change the code, not these tests, to make them pass.
import { expect, test, type Locator, type Page } from '@playwright/test';
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

function mock(id: string, urlPattern: string, name: string, status = 200, method: Mock['method'] = 'GET'): Mock {
  return {
    id, name, enabled: true, method, urlPattern,
    response: { status, headers: {}, body: '{}', bodyEncoding: 'text', delayMs: 0 },
    source: 'manual', createdAt: 0,
  };
}

function project(defaultMocks?: Mock[]): Project {
  return {
    id: 'p1', name: 'site', origins: [fixture.origin], activeScenarioId: 'default',
    scenarios: [
      { id: 'default', name: 'Default', mocks: defaultMocks ?? [mock('m1', '/api/products', 'Product list'), mock('m2', '/api/me', 'Guest', 401)] },
      { id: 'e', name: 'Errors', mocks: [mock('m3', '/api/checkout', 'Checkout 503', 503, 'POST')] },
      { id: 's', name: 'Slow', mocks: [] },
    ],
  };
}

async function readState(): Promise<WemockState> {
  return session.worker.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await (globalThis as any).chrome.storage.local.get('wemock.state'))['wemock.state'];
  });
}
const proj = async () => (await readState()).projects[0]!;

async function openList(p: Project = project()): Promise<{ page: Page; panel: Page }> {
  await session.setState({ ...emptyState(), enabledOrigins: [fixture.origin], projects: [p] });
  const page = await session.context.newPage();
  await page.goto(`${fixture.url}/index.html`);
  const tabId = await session.tabIdOf(page);
  const panel = await session.context.newPage();
  await panel.setViewportSize({ width: 1280, height: 800 });
  await panel.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);
  await panel.evaluate(() => localStorage.clear());
  await panel.reload();
  await panel.getByTestId('tab-mocks').click();
  await expect(panel.getByTestId('mocks-filter')).toBeVisible();
  return { page, panel };
}

function group(panel: Page, name: string): Locator {
  return panel.locator('.scenario-group').filter({ has: panel.locator('.scenario-name-badge', { hasText: new RegExp(`^${name}$`) }) });
}

async function left(l: Locator): Promise<number> {
  const b = await l.boundingBox();
  expect(b).not.toBeNull();
  return b!.x;
}

test('the list has no checkboxes at all', async () => {
  const { page, panel } = await openList();
  try {
    await expect(panel.getByTestId('mock-row')).toHaveCount(3);
    await expect(panel.locator('.scenarios-list input[type=checkbox]')).toHaveCount(0);
    for (const gone of ['scenario-select', 'scenarios-delete-selected', 'scenarios-delete-all', 'scenario-chip']) {
      await expect(panel.getByTestId(gone)).toHaveCount(0);
    }
  } finally {
    await panel.close(); await page.close();
  }
});

test('a scenario header: name and pencil on the left, then duplicate, export, delete, then the count', async () => {
  const { page, panel } = await openList();
  try {
    const errors = group(panel, 'Errors');
    const name = errors.getByTestId('scenario-name');
    await expect(name).toHaveText('Errors');
    const xs = [await left(name), await left(errors.getByTestId('scenario-rename')), await left(errors.getByTestId('scenario-duplicate')),
      await left(errors.getByTestId('scenario-export')), await left(errors.getByTestId('scenario-delete')), await left(errors.getByTestId('scenario-count'))];
    for (let i = 1; i < xs.length; i++) expect(xs[i]!, `item ${i} is right of item ${i - 1}`).toBeGreaterThan(xs[i - 1]!);
    await expect(errors.getByTestId('scenario-count')).toHaveText('1');
    for (const id of ['scenario-duplicate', 'scenario-export', 'scenario-delete', 'scenario-rename']) {
      await expect(errors.getByTestId(id), `${id} says what it does`).toHaveAttribute('aria-label', /\w/);
    }
    await expect(errors.getByTestId('scenario-delete')).toHaveAttribute('aria-label', /Delete/);
  } finally {
    await panel.close(); await page.close();
  }
});

test('Default cannot be renamed or deleted; its bin empties it and keeps it, with Undo', async () => {
  const { page, panel } = await openList();
  try {
    const def = group(panel, 'Default');
    await expect(def.getByTestId('scenario-rename')).toHaveCount(0);
    await expect(def.getByTestId('scenario-delete')).toHaveCount(0);
    await expect(def.getByTestId('scenario-duplicate')).toBeVisible();
    await expect(def.getByTestId('scenario-export')).toBeVisible();
    await expect(def.getByTestId('scenario-count')).toHaveText('2');
    await def.getByTestId('scenario-clear').click();
    await expect.poll(async () => (await proj()).scenarios.map((s) => [s.name, s.mocks.length])).toEqual([['Default', 0], ['Errors', 1], ['Slow', 0]]);
    await expect(panel.getByTestId('undo-bar')).toContainText('Default');
    await panel.getByTestId('undo').click();
    await expect.poll(proj).toEqual(project());
  } finally {
    await panel.close(); await page.close();
  }
});

test('clicking a header makes that scenario active; only one says Active; icons do not activate', async () => {
  const { page, panel } = await openList();
  try {
    await expect(group(panel, 'Default').getByTestId('scenario-active')).toBeVisible();
    await group(panel, 'Errors').getByTestId('scenario-name').click();
    await expect.poll(async () => (await proj()).activeScenarioId).toBe('e');
    await expect(group(panel, 'Errors').getByTestId('scenario-active')).toHaveText('Active');
    await expect(panel.getByTestId('scenario-active')).toHaveCount(1);
    await expect(panel.getByTestId('toast').last()).toHaveText('Errors is active');

    const dl = panel.waitForEvent('download');
    await group(panel, 'Slow').getByTestId('scenario-export').click();
    await dl;
    await group(panel, 'Slow').getByTestId('scenario-fold').click();
    await panel.waitForTimeout(300);
    expect((await proj()).activeScenarioId, 'an icon in a header does not make it active').toBe('e');

    await group(panel, 'Slow').getByTestId('scenario-header').focus();
    await panel.keyboard.press('Enter');
    await expect.poll(async () => (await proj()).activeScenarioId, 'Enter on a focused header activates it').toBe('s');
  } finally {
    await panel.close(); await page.close();
  }
});

test('deleting the active scenario makes Default active; Undo restores both', async () => {
  const p = { ...project(), activeScenarioId: 'e' };
  const { page, panel } = await openList(p);
  try {
    await group(panel, 'Errors').getByTestId('scenario-delete').click();
    await expect.poll(async () => (await proj()).scenarios.map((s) => s.name)).toEqual(['Default', 'Slow']);
    expect((await proj()).activeScenarioId).toBe('default');
    await panel.getByTestId('undo').click();
    await expect.poll(proj).toEqual(p);
  } finally {
    await panel.close(); await page.close();
  }
});

test('rename in place: Enter saves, Escape cancels, an empty name is refused', async () => {
  const { page, panel } = await openList();
  try {
    await group(panel, 'Errors').getByTestId('scenario-rename').click();
    const input = panel.getByTestId('scenario-rename-input');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('Errors');
    await input.fill('Payments down');
    await input.press('Enter');
    await expect.poll(async () => (await proj()).scenarios[1]!.name).toBe('Payments down');

    await group(panel, 'Payments down').getByTestId('scenario-rename').click();
    await panel.getByTestId('scenario-rename-input').fill('Nope');
    await panel.getByTestId('scenario-rename-input').press('Escape');
    await expect(panel.getByTestId('scenario-rename-input')).toHaveCount(0);
    await panel.waitForTimeout(200);
    expect((await proj()).scenarios[1]!.name).toBe('Payments down');

    await group(panel, 'Payments down').getByTestId('scenario-rename').click();
    await panel.getByTestId('scenario-rename-input').fill('   ');
    await panel.getByTestId('scenario-rename-input').press('Enter');
    await panel.waitForTimeout(200);
    expect((await proj()).scenarios[1]!.name).toBe('Payments down');
  } finally {
    await panel.close(); await page.close();
  }
});

test('a mock row: method, URL pattern in monospace, name; then delete on hover, the status, up and down', async () => {
  const { page, panel } = await openList();
  try {
    const row = group(panel, 'Errors').getByTestId('mock-row');
    await expect(row).toContainText('POST');
    await expect(row).toContainText('/api/checkout');
    await expect(row).toContainText('Checkout 503');
    const font = await row.locator('.mock-name-or-pattern').evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font.toLowerCase()).toMatch(/mono|consolas|courier/);
    const order = [await left(row.getByText('/api/checkout')), await left(row.getByTestId('mock-row-delete')),
      await left(row.getByTestId('mock-status')), await left(row.getByTestId('mock-up'))];
    for (let i = 1; i < order.length; i++) expect(order[i]!).toBeGreaterThan(order[i - 1]!);
    await expect(row.getByTestId('mock-status')).toHaveText('503');

    const s5 = await row.getByTestId('mock-status').evaluate((el) => getComputedStyle(el).color);
    const s2 = await group(panel, 'Default').getByTestId('mock-row').first().getByTestId('mock-status').evaluate((el) => getComputedStyle(el).color);
    expect(s5, '5xx and 2xx statuses differ in colour').not.toBe(s2);

    await panel.mouse.move(5, 5);
    const hiddenOpacity = await row.getByTestId('mock-row-delete').evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(hiddenOpacity), 'the delete icon waits for hover').toBeLessThan(0.5);
    await row.hover();
    await expect.poll(async () => Number(await row.getByTestId('mock-row-delete').evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(0.9);
    await row.getByTestId('mock-row-delete').click();
    await expect.poll(async () => (await proj()).scenarios[1]!.mocks).toEqual([]);
    await panel.getByTestId('undo').click();
    await expect.poll(async () => (await proj()).scenarios[1]!.mocks.length).toBe(1);
  } finally {
    await panel.close(); await page.close();
  }
});

test('the + menu adds a mock to the active scenario, a socket mock, or a scenario named in place', async () => {
  const { page, panel } = await openList({ ...project(), activeScenarioId: 'e' });
  try {
    const plus = panel.getByTestId('add-menu-open');
    const filterX = await left(panel.getByTestId('mocks-filter'));
    expect(await left(plus), '+ is left of the filter').toBeLessThan(filterX);
    await expect(panel.getByTestId('mock-new')).toHaveCount(0);

    await plus.focus();
    await panel.keyboard.press('Enter');
    await expect(panel.getByRole('menu')).toBeVisible();
    await expect(panel.getByRole('menuitem')).toHaveCount(3);
    await panel.keyboard.press('Escape');
    await expect(panel.getByRole('menu')).toHaveCount(0);

    await plus.click();
    await panel.getByTestId('mock-new').click();
    await expect(panel.getByTestId('field-pattern')).toBeVisible();
    await panel.getByTestId('field-pattern').fill('/api/new-one');
    await panel.getByTestId('mock-save').click();
    await expect.poll(async () => (await proj()).scenarios[1]!.mocks.map((m) => m.urlPattern)).toContain('/api/new-one');

    await plus.click();
    await panel.getByTestId('socket-new').click();
    await expect(panel.getByTestId('socket-pattern')).toBeVisible();

    await plus.click();
    await panel.getByTestId('scenario-new').click();
    const input = panel.getByTestId('scenario-rename-input');
    await expect(input).toBeFocused();
    await input.fill('Brand new');
    await input.press('Enter');
    await expect.poll(async () => (await proj()).scenarios.map((s) => s.name)).toContain('Brand new');
  } finally {
    await panel.close(); await page.close();
  }
});

test('on/off is a switch in the editor that saves at once; an off mock is faded and says off', async () => {
  const { page, panel } = await openList();
  try {
    const row = group(panel, 'Default').getByTestId('mock-row').first();
    await row.click();
    const sw = panel.getByTestId('mock-enabled');
    await expect(sw).toBeChecked();
    await expect(sw).toHaveAttribute('role', 'switch');
    const sx = await left(sw);
    expect(sx, 'the switch sits in the editor, right of the list').toBeGreaterThan(await left(row) + 300);
    await sw.uncheck();
    await expect.poll(async () => (await proj()).scenarios[0]!.mocks[0]!.enabled).toBe(false);
    await expect(row).toContainText('off');
    expect(Number(await row.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(0.9);
  } finally {
    await panel.close(); await page.close();
  }
});

test('one scroll area: a scenario header sticks while its mocks scroll', async () => {
  const many = Array.from({ length: 80 }, (_, i) => mock(`d${i}`, `/api/items/${i}`, `Item ${i}`));
  const { page, panel } = await openList(project(many));
  try {
    const list = panel.locator('.scenarios-list');
    const top = (await list.boundingBox())!.y;
    await panel.getByTestId('mock-row').first().hover();
    await panel.mouse.wheel(0, 1200);
    await panel.waitForTimeout(300);
    expect(await list.evaluate((el) => el.scrollTop), 'the list itself scrolls').toBeGreaterThan(500);
    const header = group(panel, 'Default').getByTestId('scenario-header');
    const hy = (await header.boundingBox())!.y;
    expect(Math.abs(hy - top), 'Default\'s header stays at the top of the list').toBeLessThan(6);
  } finally {
    await panel.close(); await page.close();
  }
});

test('a hovered header sits above the next one, so its tooltips are not hidden', async () => {
  const { page, panel } = await openList();
  try {
    await group(panel, 'Default').getByTestId('scenario-fold').click();
    await group(panel, 'Errors').getByTestId('scenario-fold').click();
    await group(panel, 'Errors').getByTestId('scenario-duplicate').hover();
    const z = async (name: string) => Number(await group(panel, name).getByTestId('scenario-header').evaluate((el) => getComputedStyle(el).zIndex)) || 0;
    expect(await z('Errors')).toBeGreaterThan(await z('Slow'));
  } finally {
    await panel.close(); await page.close();
  }
});
