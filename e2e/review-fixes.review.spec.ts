// Claude's review tests for what a whole-branch review of the new panel found. Change the code, not
// these tests, to make them pass.
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

function project(origin: string, id = 'p1'): Project {
  return {
    id, name: 'site', origins: [origin], activeScenarioId: 'default',
    scenarios: [
      { id: 'default', name: 'Default', mocks: [mock(`${id}a`, '/api/a', 'Alpha'), mock(`${id}b`, '/api/b', 'Beta')] },
      { id: 'e', name: 'Errors', mocks: [mock(`${id}c`, '/api/c', 'Gamma')] },
    ],
  };
}

async function readState(): Promise<WemockState> {
  return session.worker.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await (globalThis as any).chrome.storage.local.get('wemock.state'))['wemock.state'];
  });
}

async function openPanel(projects: Project[], width = 1280, height = 800): Promise<{ page: Page; panel: Page }> {
  await session.setState({ ...emptyState(), enabledOrigins: [fixture.origin], projects });
  const page = await session.context.newPage();
  await page.goto(`${fixture.url}/index.html`);
  const tabId = await session.tabIdOf(page);
  const panel = await session.context.newPage();
  await panel.setViewportSize({ width, height });
  await panel.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);
  return { page, panel };
}

const group = (panel: Page, name: string) =>
  panel.locator('.scenario-group').filter({ has: panel.locator('.scenario-name-badge', { hasText: new RegExp(`^${name}$`) }) });

test('a change after a delete withdraws its Undo, so Undo never rolls that change back', async () => {
  const { page, panel } = await openPanel([project(fixture.origin)]);
  try {
    await panel.getByTestId('tab-mocks').click();
    await group(panel, 'Default').getByTestId('mock-row').first().hover();
    await group(panel, 'Default').getByTestId('mock-row').first().getByTestId('mock-row-delete').click();
    await expect(panel.getByTestId('undo-bar')).toHaveCount(1);
    await group(panel, 'Errors').getByTestId('scenario-name').click();
    await expect.poll(async () => (await readState()).projects[0]!.activeScenarioId).toBe('e');
    await expect(panel.getByTestId('undo-bar')).toHaveCount(0);
  } finally {
    await panel.close(); await page.close();
  }
});

test('deleting one row keeps another mock open in the editor, with its unsaved edit', async () => {
  const { page, panel } = await openPanel([project(fixture.origin)]);
  try {
    await panel.getByTestId('tab-mocks').click();
    await group(panel, 'Default').getByTestId('mock-row').first().click();
    await panel.getByTestId('field-name').fill('Alpha, half edited');
    const other = group(panel, 'Errors').getByTestId('mock-row').first();
    await other.hover();
    await other.getByTestId('mock-row-delete').click();
    await expect.poll(async () => (await readState()).projects[0]!.scenarios[1]!.mocks).toEqual([]);
    await expect(panel.getByTestId('field-name')).toHaveValue('Alpha, half edited');
  } finally {
    await panel.close(); await page.close();
  }
});

test('on a narrow panel, clearing the Log shows the list again, not an empty detail', async () => {
  const { page, panel } = await openPanel([project(fixture.origin)], 400, 640);
  try {
    await page.evaluate(async () => (await fetch('/api/not-mocked')).text().catch(() => ''));
    await panel.getByTestId('log-row').first().click();
    await expect(panel.locator('.panel-split-view.has-detail')).toHaveCount(1);
    await panel.getByTitle('Clear log').click();
    await expect(panel.getByTestId('log-row')).toHaveCount(0);
    await expect(panel.locator('.panel-split-view.has-detail')).toHaveCount(0);
    await page.evaluate(async () => (await fetch('/api/after-clear')).text().catch(() => ''));
    await expect(panel.getByTestId('log-row').first()).toBeVisible();
  } finally {
    await panel.close(); await page.close();
  }
});

test('leaving the rename box without a change says nothing and saves nothing', async () => {
  const { page, panel } = await openPanel([project(fixture.origin)]);
  try {
    await panel.getByTestId('tab-mocks').click();
    await group(panel, 'Errors').getByTestId('scenario-rename').click();
    await expect(panel.getByTestId('scenario-rename-input')).toBeFocused();
    // Tab moves focus on, which leaves the box the way a click elsewhere does.
    await panel.keyboard.press('Tab');
    await expect(panel.getByTestId('scenario-rename-input')).toHaveCount(0);
    await panel.waitForTimeout(300);
    // Counted once, not polled: a polled count of 0 would pass after the message fades.
    expect(await panel.getByTestId('toast').filter({ hasText: 'Renamed' }).count()).toBe(0);
  } finally {
    await panel.close(); await page.close();
  }
});

test('Sample from the Log tab lands in this site\'s project, never in another site\'s', async () => {
  const other = project('http://localhost:59999', 'p9');
  const { page, panel } = await openPanel([other]);
  try {
    await expect(panel.getByTestId('tab-log')).toHaveAttribute('aria-current', 'page');
    await panel.getByTestId('sample-load-toolbar').click();
    await expect.poll(async () => {
      const mine = (await readState()).projects.find((p) => p.origins.includes(fixture.origin));
      return mine?.scenarios.length ?? 0;
    }).toBeGreaterThan(2);
    const still = (await readState()).projects.find((p) => p.id === 'p9')!;
    expect(still.scenarios.map((s) => s.name)).toEqual(['Default', 'Errors']);
  } finally {
    await panel.close(); await page.close();
  }
});
