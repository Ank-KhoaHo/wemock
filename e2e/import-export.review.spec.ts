// Claude's review tests for the Import dialog and the Export menu. Change the code, not these tests, to make them pass.
import { expect, test, type Page } from '@playwright/test';
import { exportProject, exportScenario } from '../src/core/exportFile';
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

function project(origin: string): Project {
  return {
    id: 'p1', name: 'site', origins: [origin], activeScenarioId: 'e',
    scenarios: [
      { id: 'default', name: 'Default', mocks: [mock('m1', '/api/a', 'Mine')] },
      { id: 'e', name: 'Errors', mocks: [mock('m3', '/api/c', 'C')] },
    ],
  };
}

function har(origin: string): Buffer {
  const e = (url: string) => ({
    startedDateTime: '2026-11-09T10:00:00.000Z', _resourceType: 'fetch',
    request: { method: 'GET', url: `${origin}${url}`, headers: [] },
    response: { status: 200, headers: [{ name: 'content-type', value: 'application/json' }], content: { mimeType: 'application/json', text: '{"from":"har"}' } },
  });
  return Buffer.from(JSON.stringify({ log: { version: '1.2', entries: [e('/api/h1'), e('/api/h2')] } }));
}

async function readState(): Promise<WemockState> {
  return session.worker.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await (globalThis as any).chrome.storage.local.get('wemock.state'))['wemock.state'];
  });
}

const urls = async () => (await readState()).projects.flatMap((p) => p.scenarios.flatMap((s) => s.mocks.map((m) => m.urlPattern))).sort();

async function openPanel(withProject = true): Promise<{ page: Page; panel: Page }> {
  await session.setState({ ...emptyState(), enabledOrigins: [fixture.origin], projects: withProject ? [project(fixture.origin)] : [] });
  const page = await session.context.newPage();
  await page.goto(`${fixture.url}/index.html`);
  const tabId = await session.tabIdOf(page);
  const panel = await session.context.newPage();
  await panel.setViewportSize({ width: 1280, height: 800 });
  await panel.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);
  await panel.getByTestId('tab-mocks').click();
  return { page, panel };
}

test('Import opens a dialog that names the 4 formats and has a drop zone', async () => {
  const { page, panel } = await openPanel();
  try {
    await panel.getByTestId('import-open').click();
    const dialog = panel.getByTestId('import-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByTestId('import-drop')).toBeVisible();
    for (const word of ['wemock', 'HAR', 'OpenAPI', 'JSON mock file']) await expect(dialog).toContainText(word);
    await expect(dialog.getByRole('button', { name: /Choose file/ })).toBeVisible();
    await expect(dialog.getByTestId('import-found')).toHaveCount(0);
    await expect(dialog.getByTestId('import-confirm')).toHaveCount(0);
    await panel.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  } finally {
    await panel.close(); await page.close();
  }
});

test('a HAR file: the dialog says what it found, Add is the default, and Import adds with Undo', async () => {
  const { page, panel } = await openPanel();
  try {
    await panel.getByTestId('import-open').click();
    await panel.getByTestId('import').setInputFiles({ name: 'b.har', mimeType: 'application/json', buffer: har(fixture.origin) });
    const found = panel.getByTestId('import-found');
    await expect(found).toContainText('b.har');
    await expect(found).toContainText('2 mocks');
    await expect(panel.getByTestId('import-add')).toHaveText('Add to what you have');
    await expect(panel.getByTestId('import-add').locator('input[type=radio]')).toBeChecked();
    await expect(panel.getByTestId('import-replace')).toContainText('Replace everything');
    expect(await urls(), 'nothing changes before Import is pressed').toEqual(['/api/a', '/api/c']);

    await panel.getByTestId('import-confirm').click();
    await expect(panel.getByTestId('import-dialog')).toHaveCount(0);
    await expect.poll(urls).toEqual(['/api/a', '/api/c', '/api/h1', '/api/h2']);
    await expect(panel.getByTestId('import-summary')).toContainText('2 mocks');
    await panel.getByTestId('import-summary').getByTestId('undo').click();
    await expect.poll(urls).toEqual(['/api/a', '/api/c']);
  } finally {
    await panel.close(); await page.close();
  }
});

test('Replace everything swaps the project, and Undo brings back the old one with its active scenario', async () => {
  const { page, panel } = await openPanel();
  try {
    const other: Project = { ...project(fixture.origin), activeScenarioId: 'default', scenarios: [{ id: 'default', name: 'Default', mocks: [mock('x1', '/api/theirs', 'Theirs')] }] };
    await panel.getByTestId('import-open').click();
    await panel.getByTestId('import').setInputFiles({ name: 'wemock-theirs.json', mimeType: 'application/json', buffer: Buffer.from(exportProject(other)) });
    await panel.getByTestId('import-replace').click();
    await expect(panel.getByTestId('import-replace').locator('input[type=radio]')).toBeChecked();
    await panel.getByTestId('import-confirm').click();
    await expect.poll(urls).toEqual(['/api/theirs']);
    await panel.getByTestId('undo').click();
    await expect.poll(urls).toEqual(['/api/a', '/api/c']);
    expect((await readState()).projects[0]!.activeScenarioId).toBe('e');
  } finally {
    await panel.close(); await page.close();
  }
});

test('a scenario file has one choice, Add as a new scenario', async () => {
  const { page, panel } = await openPanel();
  try {
    const sc = { id: 'z', name: 'From a friend', mocks: [mock('f1', '/api/friend', 'F')] };
    await panel.getByTestId('import-open').click();
    await panel.getByTestId('import').setInputFiles({ name: 'wemock-friend.json', mimeType: 'application/json', buffer: Buffer.from(exportScenario(sc)) });
    await expect(panel.getByTestId('import-add')).toHaveText('Add as a new scenario');
    await expect(panel.getByTestId('import-replace')).toHaveCount(0);
    await panel.getByTestId('import-confirm').click();
    await expect.poll(async () => (await readState()).projects[0]!.scenarios.map((s) => s.name)).toEqual(['Default', 'Errors', 'From a friend']);
  } finally {
    await panel.close(); await page.close();
  }
});

test('a file wemock cannot read shows the error in the dialog, which stays open; Cancel closes it', async () => {
  const { page, panel } = await openPanel();
  try {
    await panel.getByTestId('import-open').click();
    await panel.getByTestId('import').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('not json at all') });
    const dialog = panel.getByTestId('import-dialog');
    await expect(dialog.getByTestId('import-error')).toBeVisible();
    await expect(dialog.getByTestId('import-found')).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await panel.getByTestId('import-cancel').click();
    await expect(dialog).toHaveCount(0);
    expect(await urls()).toEqual(['/api/a', '/api/c']);
  } finally {
    await panel.close(); await page.close();
  }
});

test('with no project for the site yet, an import makes one without asking', async () => {
  const { page, panel } = await openPanel(false);
  try {
    await panel.getByTestId('import-open').click();
    await panel.getByTestId('import').setInputFiles({ name: 'first.har', mimeType: 'application/json', buffer: har(fixture.origin) });
    await expect(panel.getByTestId('import-dialog')).toHaveCount(0);
    await expect.poll(urls).toEqual(['/api/h1', '/api/h2']);
    await expect(panel.getByTestId('mock-row')).toHaveCount(2);
  } finally {
    await panel.close(); await page.close();
  }
});

test('Export offers the whole project or only the active scenario, and says what it saved', async () => {
  const { page, panel } = await openPanel();
  try {
    await panel.getByTestId('export-open').click();
    const menu = panel.getByTestId('export-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId('export-project')).toContainText('Whole project');
    await expect(menu.getByTestId('export-project')).toContainText('2 scenarios, 2 mocks');
    await expect(menu.getByTestId('export-active')).toContainText('Only Errors');

    const whole = panel.waitForEvent('download');
    await menu.getByTestId('export-project').click();
    expect((await whole).suggestedFilename()).toBe('wemock-site.json');
    await expect(panel.getByTestId('export-menu')).toHaveCount(0);
    await expect(panel.getByTestId('toast').last()).toHaveText('Saved wemock-site.json');

    await panel.getByTestId('export-open').click();
    const one = panel.waitForEvent('download');
    await panel.getByTestId('export-active').click();
    expect((await one).suggestedFilename()).toBe('wemock-Errors.json');
    await expect(panel.getByTestId('toast').last()).toHaveText('Saved wemock-Errors.json');
  } finally {
    await panel.close(); await page.close();
  }
});

test('the Export menu closes on Escape and on a click elsewhere', async () => {
  const { page, panel } = await openPanel();
  try {
    await panel.getByTestId('export-open').click();
    await expect(panel.getByTestId('export-menu')).toBeVisible();
    await panel.keyboard.press('Escape');
    await expect(panel.getByTestId('export-menu')).toHaveCount(0);
    await panel.getByTestId('export-open').click();
    // An empty spot in the rail, well away from the open menu.
    await panel.mouse.click(30, 700);
    await expect(panel.getByTestId('export-menu')).toHaveCount(0);
  } finally {
    await panel.close(); await page.close();
  }
});
