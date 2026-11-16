// Claude's review tests for the toolbar popup: the site, its scenario dropdown, and how to open
// wemock in DevTools. Change the code, not these tests, to make them pass.
import { expect, test, type Page } from '@playwright/test';
import { emptyState, type Project, type WemockState } from '../src/core/types';
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

function project(): Project {
  return {
    id: 'p1', name: 'site', origins: [fixture.origin], activeScenarioId: 'default',
    scenarios: [
      { id: 'default', name: 'Default', mocks: [] },
      { id: 'e', name: 'Errors', mocks: [] },
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

/** The popup, opened while the fixture page is the active tab, as when its toolbar icon is clicked there. */
async function popupFor(page: Page): Promise<Page> {
  const tabId = await session.tabIdOf(page);
  const popup = await session.context.newPage();
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.goto(`chrome-extension://${session.extensionId}/popup.html`);
  await session.worker.evaluate(async (id) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (globalThis as any).chrome.tabs.update(id, { active: true });
  }, tabId);
  await popup.reload();
  return popup;
}

test('on a site wemock works on, the popup names it and offers the scenarios in a dropdown', async () => {
  await session.setState({ ...emptyState(), enabledOrigins: [fixture.origin], projects: [project()] });
  const page = await session.context.newPage();
  await page.goto(`${fixture.url}/index.html`);
  const popup = await popupFor(page);
  try {
    await expect(popup.getByTestId('popup-site')).toContainText(new URL(fixture.origin).host);
    const select = popup.getByTestId('popup-scenario');
    await expect(select).toBeVisible();
    await expect(popup.getByLabel('Active scenario')).toBeVisible();
    await expect(select.locator('option')).toHaveText(['Default only', 'Errors', 'Slow']);
    await expect(select).toHaveValue('default');
    await expect(popup.getByTestId('scenario-chip')).toHaveCount(0);

    await select.selectOption('e');
    await expect.poll(async () => (await readState()).projects[0]!.activeScenarioId).toBe('e');

    await session.setState({ ...emptyState(), enabledOrigins: [fixture.origin], projects: [{ ...project(), activeScenarioId: 's' }] });
    await expect(select, 'the dropdown follows a change made in the panel').toHaveValue('s');
  } finally {
    await popup.close(); await page.close();
  }
});

test('the popup always says how to open wemock in DevTools', async () => {
  await session.setState({ ...emptyState(), enabledOrigins: [fixture.origin], projects: [project()] });
  const page = await session.context.newPage();
  await page.goto(`${fixture.url}/index.html`);
  const popup = await popupFor(page);
  try {
    const steps = popup.getByTestId('devtools-steps');
    await expect(steps).toBeVisible();
    await expect(steps).toContainText('wemock lives in DevTools');
    await expect(steps).toContainText('F12');
    await expect(steps.locator('kbd')).toContainText(['F12']);
    await expect(steps).toContainText(/Ctrl.*Shift.*I|⌥.*⌘.*I/s);
    await expect(steps).toContainText('wemock tab');
    await expect(steps).toContainText('»');
  } finally {
    await popup.close(); await page.close();
  }
});

test('on a page wemock cannot run on, the popup says so and still shows the DevTools steps', async () => {
  await session.setState({ ...emptyState(), enabledOrigins: [fixture.origin], projects: [project()] });
  const popup = await session.context.newPage();
  try {
    // With no other tab made active, the popup sees its own extension page.
    await popup.goto(`chrome-extension://${session.extensionId}/popup.html`);
    await expect(popup.getByText(/cannot run on this page/)).toBeVisible();
    await expect(popup.getByTestId('devtools-steps')).toBeVisible();
    await expect(popup.getByTestId('popup-scenario')).toHaveCount(0);
  } finally {
    await popup.close();
  }
});
