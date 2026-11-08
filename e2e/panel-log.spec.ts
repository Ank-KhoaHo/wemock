import { expect, test } from '@playwright/test';
import { emptyState, type WemockState } from '../src/core/types';
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

test.beforeEach(async () => {
  const state: WemockState = {
    ...emptyState(),
    enabledOrigins: [fixture.origin],
  };
  await session.setState(state);
});

test('real calls appear as log rows with method, path, status, badge', async () => {
  const page = await session.context.newPage();
  const panelPage = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panelPage.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);

    await page.click('#btn-fetch');

    const row = panelPage.getByTestId('log-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('GET');
    await expect(row).toContainText('/api/goals');
    await expect(row).toContainText('200');
    await expect(row).toContainText('real');

    await row.click();
    await expect(panelPage.getByTestId('detail-method')).toHaveText('GET');
    await expect(panelPage.getByTestId('detail-url')).toContainText('/api/goals');
    await expect(panelPage.getByTestId('response-body')).toContainText('"source": "server"');
  } finally {
    await panelPage.close();
    await page.close();
  }
});

test('the filter narrows rows by URL text', async () => {
  const page = await session.context.newPage();
  const panelPage = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panelPage.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);

    await page.click('#btn-fetch');
    await page.click('#btn-echo');

    await expect(panelPage.getByTestId('log-row')).toHaveCount(2);

    await panelPage.getByTestId('log-filter').fill('goals');
    await expect(panelPage.getByTestId('log-row')).toHaveCount(1);
    await expect(panelPage.getByTestId('log-row')).toContainText('/api/goals');

    await panelPage.getByTestId('log-filter').fill('echo');
    await expect(panelPage.getByTestId('log-row')).toHaveCount(1);
    await expect(panelPage.getByTestId('log-row')).toContainText('/api/echo');

    await panelPage.getByTestId('log-filter').fill('');
    await expect(panelPage.getByTestId('log-row')).toHaveCount(2);
  } finally {
    await panelPage.close();
    await page.close();
  }
});

test('Mock this, then reload, serves the recorded body with badge MOCK', async () => {
  const page = await session.context.newPage();
  const panelPage = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panelPage.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);

    await page.click('#btn-fetch');
    const firstRow = panelPage.getByTestId('log-row');
    await expect(firstRow).toHaveCount(1);
    await firstRow.click();

    await panelPage.getByTestId('mock-this').click();

    await page.reload();
    await page.click('#btn-fetch');
    await expect(page.locator('#out')).toHaveText('{"source":"server"}');

    await expect(panelPage.getByTestId('log-row')).toHaveCount(2);
    const secondRow = panelPage.getByTestId('log-row').nth(1);
    await expect(secondRow).toContainText('MOCK');
  } finally {
    await panelPage.close();
    await page.close();
  }
});

test('Save as scenario makes a chip; picking it switches responses', async () => {
  const page = await session.context.newPage();
  const panelPage = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panelPage.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);

    await page.click('#btn-fetch');
    await expect(panelPage.getByTestId('log-row')).toHaveCount(1);

    await panelPage.getByTestId('save-scenario').click();
    await panelPage.getByTestId('save-scenario-name').fill('Alt Scenario');
    await panelPage.getByTestId('save-scenario-submit').click();

    const chips = panelPage.getByTestId('scenario-chip');
    await expect(chips).toHaveCount(2);
    const altChip = panelPage.getByRole('button', { name: 'Alt Scenario' });
    await expect(altChip).toBeVisible();
    await expect(altChip).toHaveAttribute('aria-pressed', 'true');

    // Switch to Default
    const defaultChip = panelPage.getByRole('button', { name: 'Default' });
    await defaultChip.click();
    await expect(defaultChip).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await page.click('#btn-fetch');
    // In Default, there are no mocks, so it reaches the server
    await expect(page.locator('#out')).toHaveText('{"source":"server"}');

    // Switch back to Alt Scenario (which contains the saved mock)
    await altChip.click();
    await expect(altChip).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await page.click('#btn-fetch');
    await expect(page.locator('#out')).toHaveText('{"source":"server"}');
    // Log row should now be MOCK
    const rows = panelPage.getByTestId('log-row');
    const lastRow = rows.last();
    await expect(lastRow).toContainText('MOCK');
  } finally {
    await panelPage.close();
    await page.close();
  }
});

test('rec off stops new rows; power off makes every call real', async () => {
  const page = await session.context.newPage();
  const panelPage = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panelPage.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);

    // Turn off recording
    const recToggle = panelPage.getByTestId('rec-toggle');
    await expect(recToggle).toHaveAttribute('aria-pressed', 'true');
    await recToggle.click();
    await expect(recToggle).toHaveAttribute('aria-pressed', 'false');

    await page.click('#btn-fetch');
    await expect(panelPage.getByTestId('log-row')).toHaveCount(0);

    // Turn recording back on
    await recToggle.click();
    await expect(recToggle).toHaveAttribute('aria-pressed', 'true');

    await page.click('#btn-fetch');
    await expect(panelPage.getByTestId('log-row')).toHaveCount(1);
    await panelPage.getByTestId('log-row').click();
    await panelPage.getByTestId('mock-this').click();

    // Verify mock works
    await page.reload();
    await page.click('#btn-fetch');
    await expect(panelPage.getByTestId('log-row')).toHaveCount(2);
    await expect(panelPage.getByTestId('log-row').nth(1)).toContainText('MOCK');

    // Turn off power
    const powerToggle = panelPage.getByTestId('power-toggle');
    await expect(powerToggle).toHaveAttribute('aria-pressed', 'true');
    await powerToggle.click();
    await expect(powerToggle).toHaveAttribute('aria-pressed', 'false');

    // Reload and fetch - mock is skipped because power is off
    await page.reload();
    await page.click('#btn-fetch');
    await expect(page.locator('#out')).toHaveText('{"source":"server"}');

    await expect(panelPage.getByTestId('log-row')).toHaveCount(3);
    await expect(panelPage.getByTestId('log-row').nth(2)).toContainText('real');
  } finally {
    await panelPage.close();
    await page.close();
  }
});

test('a body containing <img src=x onerror=...> renders as text', async () => {
  const page = await session.context.newPage();
  const panelPage = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panelPage.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);

    const payload = '<img src=x onerror=alert(1)>';
    await page.evaluate(async (body) => {
      await fetch('/api/echo', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body,
      });
    }, payload);

    const row = panelPage.getByTestId('log-row');
    await expect(row).toHaveCount(1);
    await row.click();

    const responseBody = panelPage.getByTestId('response-body');
    await expect(responseBody).toContainText(payload);
    await expect(panelPage.locator('img[src="x"]')).toHaveCount(0);
  } finally {
    await panelPage.close();
    await page.close();
  }
});

test('a recorded PNG row: Mock this, reload, the <img> loads from the mock', async () => {
  const page = await session.context.newPage();
  const panelPage = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panelPage.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);

    await page.evaluate(async () => {
      await fetch('/api/logo.png');
    });

    const row = panelPage.getByTestId('log-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('/api/logo.png');
    await row.click();

    await expect(panelPage.getByTestId('response-body')).toContainText('binary, 10240 bytes');
    await panelPage.getByTestId('mock-this').click();

    await page.reload();
    await page.evaluate(async () => {
      await fetch('/api/logo.png');
    });

    await expect(panelPage.getByTestId('log-row')).toHaveCount(2);
    await expect(panelPage.getByTestId('log-row').nth(1)).toContainText('MOCK');
  } finally {
    await panelPage.close();
    await page.close();
  }
});

test('a truncated row has mock-this disabled', async () => {
  const page = await session.context.newPage();
  const panelPage = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panelPage.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);

    await page.evaluate(async () => {
      await fetch('/api/big.bin');
    });

    const row = panelPage.getByTestId('log-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('/api/big.bin');
    await row.click();

    await expect(panelPage.getByTestId('response-body')).toContainText('not kept, over 1 MB');
    const mockThis = panelPage.getByTestId('mock-this');
    await expect(mockThis).toBeDisabled();
    await expect(mockThis).toHaveAttribute('title', /over 1 MB|truncated/i);
  } finally {
    await panelPage.close();
    await page.close();
  }
});
