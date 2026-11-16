// Claude's review tests for the editors' icon buttons and the message after each action. Change the code, not these tests, to make them pass.
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
    response: { status: 200, headers: {}, body: 'mocked', bodyEncoding: 'text', delayMs: 0 },
    source: 'manual', createdAt: 0,
  };
}
const hub: SocketMock = { id: 'w1', name: 'Hub', enabled: true, kind: 'signalr', urlPattern: '/hubs/x', onConnect: [], replies: [], createdAt: 0 };

function project(): Project {
  return {
    id: 'p1', name: 'site', origins: [fixture.origin], activeScenarioId: 'default',
    scenarios: [
      { id: 'default', name: 'Default', mocks: [mock('m1', '/api/one', 'One'), mock('m2', '/api/two', 'Two')], sockets: [hub] },
      { id: 'e', name: 'Errors', mocks: [] },
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

const lastToast = (panel: Page) => panel.locator('[data-testid="toast"], [data-testid="undo-bar"], [data-testid="import-summary"]').last();

function rgb(c: string): [number, number, number] {
  const m = c.match(/\d+(\.\d+)?/g)!.map(Number);
  return [m[0]!, m[1]!, m[2]!];
}

test('the mock editor header: switch, then duplicate, delete in red and save in blue, as icons with names', async () => {
  const { page, panel } = await openPanel();
  try {
    await panel.getByTestId('tab-mocks').click();
    await panel.getByTestId('mock-row').first().click();
    const ids = ['mock-enabled', 'mock-duplicate', 'mock-delete', 'mock-save'];
    const xs: number[] = [];
    for (const id of ids) xs.push((await panel.getByTestId(id).boundingBox())!.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!, `${ids[i]} after ${ids[i - 1]}`).toBeGreaterThan(xs[i - 1]!);
    for (const id of ['mock-duplicate', 'mock-delete', 'mock-save']) {
      const b = panel.getByTestId(id);
      expect((await b.innerText()).trim(), `${id} shows an icon, not a word`).toBe('');
      await expect(b).toHaveAttribute('aria-label', /\w/);
      await expect(b.locator('svg')).toHaveCount(1);
    }
    const [dr, dg, db] = rgb(await panel.getByTestId('mock-delete').evaluate((el) => getComputedStyle(el).color));
    expect(dr, 'delete is red').toBeGreaterThan(Math.max(dg, db) + 60);
    const [sr, , sb] = rgb(await panel.getByTestId('mock-save').evaluate((el) => getComputedStyle(el).backgroundColor));
    expect(sb, 'save is blue').toBeGreaterThan(sr + 60);
  } finally {
    await panel.close(); await page.close();
  }
});

test('the socket editor header has the same icons', async () => {
  const { page, panel } = await openPanel();
  try {
    await panel.getByTestId('tab-mocks').click();
    await panel.getByTestId('socket-row').first().click();
    for (const id of ['socket-enabled', 'socket-duplicate', 'socket-delete', 'socket-save']) await expect(panel.getByTestId(id)).toBeVisible();
    for (const id of ['socket-duplicate', 'socket-delete', 'socket-save']) {
      expect((await panel.getByTestId(id).innerText()).trim()).toBe('');
      await expect(panel.getByTestId(id)).toHaveAttribute('aria-label', /\w/);
    }
  } finally {
    await panel.close(); await page.close();
  }
});

test('Save, Ctrl+S, Duplicate and Delete each say what they did; Delete has Undo', async () => {
  const { page, panel } = await openPanel();
  try {
    await panel.getByTestId('tab-mocks').click();
    await panel.getByTestId('mock-row').first().click();
    await panel.getByTestId('field-name').fill('One renamed');
    await panel.getByTestId('mock-save').click();
    await expect(lastToast(panel)).toHaveText('Saved One renamed');

    await panel.getByTestId('field-name').fill('One again');
    await panel.getByTestId('field-name').press('Control+s');
    await expect.poll(async () => (await proj()).scenarios[0]!.mocks[0]!.name).toBe('One again');
    await expect(lastToast(panel)).toHaveText('Saved One again');

    await panel.getByTestId('mock-duplicate').click();
    await expect.poll(async () => (await proj()).scenarios[0]!.mocks.length).toBe(3);
    await expect(lastToast(panel)).toContainText('duplicated');

    await panel.getByTestId('mock-delete').click();
    await expect.poll(async () => (await proj()).scenarios[0]!.mocks.length).toBe(2);
    await expect(panel.getByTestId('undo-bar').last()).toContainText('Deleted');
    await panel.getByTestId('undo').last().click();
    await expect.poll(async () => (await proj()).scenarios[0]!.mocks.length).toBe(3);
  } finally {
    await panel.close(); await page.close();
  }
});

test('a new mock says where it went', async () => {
  const { page, panel } = await openPanel();
  try {
    await panel.getByTestId('tab-mocks').click();
    await panel.getByTestId('add-menu-open').click();
    await panel.getByTestId('mock-new').click();
    await panel.getByTestId('field-pattern').fill('/api/three');
    await panel.getByTestId('mock-save').click();
    await expect(lastToast(panel)).toHaveText(/added to Default/);
  } finally {
    await panel.close(); await page.close();
  }
});

test('Rec, Console and On/off each say what changed', async () => {
  const { page, panel } = await openPanel();
  try {
    const rec = panel.getByTestId('rec-toggle');
    const was = await rec.getAttribute('aria-pressed');
    await rec.click();
    await expect(lastToast(panel)).toHaveText(was === 'true' ? 'Recording paused' : 'Recording calls');
    await panel.getByTestId('console-toggle').click();
    await expect(lastToast(panel)).toHaveText(/Console/);
    const power = panel.getByTestId('power-toggle');
    const on = await power.getAttribute('aria-pressed');
    await power.click();
    await expect(lastToast(panel)).toHaveText(on === 'true' ? 'Mocking off: every call goes to the server' : 'Mocking on: mocks answer again');
  } finally {
    await panel.close(); await page.close();
  }
});

test('Mock this in the Log says which scenario got the mock', async () => {
  const { page, panel } = await openPanel();
  try {
    await page.evaluate(async () => (await fetch('/api/real-thing')).text().catch(() => ''));
    await panel.getByTestId('log-row').filter({ hasText: '/api/real-thing' }).first().click();
    await panel.getByTestId('mock-this').click();
    await expect(lastToast(panel)).toHaveText(/added to Default/);
  } finally {
    await panel.close(); await page.close();
  }
});

test('moving a mock up or down shows no message', async () => {
  const { page, panel } = await openPanel();
  try {
    await panel.getByTestId('tab-mocks').click();
    await panel.waitForTimeout(400);
    const before = await panel.locator('[data-testid="toast"], [data-testid="undo-bar"]').count();
    await panel.getByTestId('mock-row').first().getByTestId('mock-down').click();
    await expect.poll(async () => (await proj()).scenarios[0]!.mocks.map((m) => m.id)).toEqual(['m2', 'm1']);
    await panel.waitForTimeout(300);
    expect(await panel.locator('[data-testid="toast"], [data-testid="undo-bar"]').count()).toBe(before);
  } finally {
    await panel.close(); await page.close();
  }
});
