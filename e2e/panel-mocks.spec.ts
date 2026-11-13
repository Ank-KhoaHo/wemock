import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { ensureProject } from '../src/core/record';
import { emptyState, type WemockState } from '../src/core/types';
import { newId } from '../src/shared/ids';
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
  const { state: initState } = ensureProject(
    {
      ...emptyState(),
      enabledOrigins: [fixture.origin],
    },
    fixture.origin,
    newId,
  );
  await session.setState(initState);
});

test('a new manual mock is served after save', async () => {
  const page = await session.context.newPage();
  const panelPage = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panelPage.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);

    await panelPage.getByTestId('tab-mocks').click();
    await panelPage.getByTestId('mock-new').click();
    // The editor switches to the new mock once storage reports it; typing before that is lost.
    await expect(panelPage.getByTestId('field-pattern')).toHaveValue('/');

    await panelPage.getByTestId('field-pattern').fill('/api/goals');
    await panelPage.locator('.cm-content').fill('{"source":"mock"}');
    await panelPage.getByTestId('mock-save').click();

    await page.click('#btn-fetch');
    await expect(page.locator('#out')).toHaveText('{"source":"mock"}');
  } finally {
    await panelPage.close();
    await page.close();
  }
});

test('a JSON body shows over lines in the editor but is saved and served without spacing', async () => {
  const page = await session.context.newPage();
  const panelPage = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    const panelUrl = `chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`;
    await panelPage.goto(panelUrl);

    await panelPage.getByTestId('tab-mocks').click();
    await panelPage.getByTestId('mock-new').click();
    await expect(panelPage.getByTestId('field-pattern')).toHaveValue('/');
    await panelPage.getByTestId('field-pattern').fill('/api/goals');
    await panelPage.locator('.cm-content').fill('{ "source": "mock", "n": 12345678901234567890 }');
    await panelPage.getByTestId('mock-save').click();

    await page.click('#btn-fetch');
    await expect(page.locator('#out')).toHaveText('{"source":"mock","n":12345678901234567890}');

    await panelPage.goto(panelUrl);
    await panelPage.getByTestId('tab-mocks').click();
    await panelPage.getByTestId('mock-row').first().click();
    await expect(panelPage.locator('.cm-line')).toHaveText(['{', '  "source": "mock",', '  "n": 12345678901234567890', '}']);

    await panelPage.getByTestId('mock-save').click();
    await page.reload();
    await page.click('#btn-fetch');
    await expect(page.locator('#out')).toHaveText('{"source":"mock","n":12345678901234567890}');
  } finally {
    await panelPage.close();
    await page.close();
  }
});

test('Format spreads one-line JSON over lines, then stays disabled until there is more to format', async () => {
  const page = await session.context.newPage();
  const panelPage = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panelPage.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);

    await panelPage.getByTestId('tab-mocks').click();
    await panelPage.getByTestId('mock-new').click();
    await expect(panelPage.getByTestId('field-pattern')).toHaveValue('/');

    await panelPage.locator('.cm-content').fill('{"source":"mock","n":12345678901234567890}');
    await panelPage.getByTestId('body-format').click();

    await expect(panelPage.locator('.cm-line')).toHaveText(['{', '  "source": "mock",', '  "n": 12345678901234567890', '}']);
    await expect(panelPage.getByTestId('body-format')).toBeDisabled();

    await panelPage.locator('.cm-content').fill('{"updated":true2}');
    await expect(panelPage.getByTestId('body-format')).toBeDisabled();

    await panelPage.locator('.cm-content').fill('{"updated":true}');
    await expect(panelPage.getByTestId('body-format')).toBeEnabled();
  } finally {
    await panelPage.close();
    await page.close();
  }
});

test('an invalid pattern shows pattern-error and the call stays real', async () => {
  const page = await session.context.newPage();
  const panelPage = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panelPage.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);

    await panelPage.getByTestId('tab-mocks').click();
    await panelPage.getByTestId('mock-new').click();
    // The editor switches to the new mock once storage reports it; typing before that is lost.
    await expect(panelPage.getByTestId('field-pattern')).toHaveValue('/');

    await panelPage.getByTestId('field-pattern').fill('/api/(');
    await expect(panelPage.getByTestId('pattern-error')).toBeVisible();
    await expect(panelPage.getByTestId('mock-save')).toBeDisabled();

    await page.click('#btn-fetch');
    await expect(page.locator('#out')).toHaveText('{"source":"server"}');
  } finally {
    await panelPage.close();
    await page.close();
  }
});

test('invalid JSON shows json-warning and is still served as text', async () => {
  const page = await session.context.newPage();
  const panelPage = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panelPage.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);

    await panelPage.getByTestId('tab-mocks').click();
    await panelPage.getByTestId('mock-new').click();
    // The editor switches to the new mock once storage reports it; typing before that is lost.
    await expect(panelPage.getByTestId('field-pattern')).toHaveValue('/');

    await panelPage.getByTestId('field-pattern').fill('/api/goals');

    // Add content-type: application/json header
    await panelPage.getByTestId('header-add').click();
    const rows = panelPage.getByTestId('header-row');
    const lastRow = rows.last();
    await lastRow.getByTestId('header-name').fill('content-type');
    await lastRow.getByTestId('header-value').fill('application/json');

    // Fill invalid JSON
    await panelPage.locator('.cm-content').fill('{ invalid json');
    await expect(panelPage.getByTestId('json-warning')).toBeVisible();

    // Save should still be enabled
    await expect(panelPage.getByTestId('mock-save')).toBeEnabled();
    await panelPage.getByTestId('mock-save').click();

    await page.click('#btn-fetch');
    await expect(page.locator('#out')).toHaveText('{ invalid json');
  } finally {
    await panelPage.close();
    await page.close();
  }
});

test('mock-up reorders and the first match wins', async () => {
  const page = await session.context.newPage();
  const panelPage = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panelPage.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);

    await panelPage.getByTestId('tab-mocks').click();

    // First mock: body "first"
    await panelPage.getByTestId('mock-new').click();
    // The editor switches to the new mock once storage reports it; typing before that is lost.
    await expect(panelPage.getByTestId('field-pattern')).toHaveValue('/');
    await panelPage.getByTestId('field-pattern').fill('/api/goals');
    await panelPage.locator('.cm-content').fill('first');
    await panelPage.getByTestId('mock-save').click();

    // Second mock: body "second"
    await panelPage.getByTestId('mock-new').click();
    // The editor switches to the new mock once storage reports it; typing before that is lost.
    await expect(panelPage.getByTestId('field-pattern')).toHaveValue('/');
    await panelPage.getByTestId('field-pattern').fill('/api/goals');
    await panelPage.locator('.cm-content').fill('second');
    await panelPage.getByTestId('mock-save').click();

    // Initially first mock wins
    await page.click('#btn-fetch');
    await expect(page.locator('#out')).toHaveText('first');

    // Reorder: click mock-up on second row
    const mockRows = panelPage.getByTestId('mock-row');
    await expect(mockRows).toHaveCount(2);
    await mockRows.nth(1).getByTestId('mock-up').click();

    // The reorder is saved asynchronously; reload only once storage has it.
    await expect
      .poll(() =>
        session.worker.evaluate(async () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const s = (await (globalThis as any).chrome.storage.local.get('wemock.state'))['wemock.state'];
          return s.projects[0].scenarios[0].mocks[0].response.body;
        }),
      )
      .toBe('second');

    // Now second mock wins
    await page.reload();
    await page.click('#btn-fetch');
    await expect(page.locator('#out')).toHaveText('second');
  } finally {
    await panelPage.close();
    await page.close();
  }
});

test('a disabled mock is not served', async () => {
  const page = await session.context.newPage();
  const panelPage = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panelPage.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);

    await panelPage.getByTestId('tab-mocks').click();
    await panelPage.getByTestId('mock-new').click();
    // The editor switches to the new mock once storage reports it; typing before that is lost.
    await expect(panelPage.getByTestId('field-pattern')).toHaveValue('/');
    await panelPage.getByTestId('field-pattern').fill('/api/goals');
    await panelPage.locator('.cm-content').fill('mocked');
    await panelPage.getByTestId('mock-save').click();

    await page.click('#btn-fetch');
    await expect(page.locator('#out')).toHaveText('mocked');

    // Disable the mock
    const row = panelPage.getByTestId('mock-row').first();
    await row.getByTestId('mock-enabled').uncheck();

    // Reload and call again -> reaches real server
    await page.reload();
    await page.click('#btn-fetch');
    await expect(page.locator('#out')).toHaveText('{"source":"server"}');
  } finally {
    await panelPage.close();
    await page.close();
  }
});

// A8: Import asks Add or Replace and keeps one project per site.
test('export then import, Add to my mocks: one project with the mock twice', async () => {
  const page = await session.context.newPage();
  const panelPage = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panelPage.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);

    await panelPage.getByTestId('tab-mocks').click();
    await panelPage.getByTestId('mock-new').click();
    // The editor switches to the new mock once storage reports it; typing before that is lost.
    await expect(panelPage.getByTestId('field-pattern')).toHaveValue('/');
    await panelPage.getByTestId('field-pattern').fill('/api/goals');
    await panelPage.locator('.cm-content').fill('exported-body');
    await panelPage.getByTestId('mock-save').click();

    // Export
    const downloadPromise = panelPage.waitForEvent('download');
    await panelPage.getByTestId('export').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const buffer = await fs.promises.readFile(downloadPath!);

    // Import exported file
    await panelPage.getByTestId('import').setInputFiles({
      name: 'exported.json',
      mimeType: 'application/json',
      buffer,
    });
    await panelPage.getByTestId('import-add').click();

    await expect(panelPage.getByTestId('import-summary')).toBeVisible();
    await expect(panelPage.getByTestId('import-summary')).toContainText('1 mock imported');

    // Still one project, with the mock added next to the one that was there.
    const options = panelPage.getByTestId('project-picker').locator('option');
    await expect(options).toHaveCount(1);
    await expect(panelPage.getByTestId('mock-row')).toHaveCount(2);
  } finally {
    await panelPage.close();
    await page.close();
  }
});

test('importing a malformed file shows import-error and changes nothing', async () => {
  const page = await session.context.newPage();
  const panelPage = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panelPage.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);

    await panelPage.getByTestId('tab-mocks').click();

    // Initial project count is 1
    await expect(panelPage.getByTestId('project-picker').locator('option')).toHaveCount(1);

    const buffer = Buffer.from('{"not":"a valid wemock or mock file"}');
    await panelPage.getByTestId('import').setInputFiles({
      name: 'malformed.json',
      mimeType: 'application/json',
      buffer,
    });

    await expect(panelPage.getByTestId('import-error')).toBeVisible();
    await expect(panelPage.getByTestId('project-picker').locator('option')).toHaveCount(1);
  } finally {
    await panelPage.close();
    await page.close();
  }
});

test('importing the v2 mock file fixture makes a project for this site and serves its mock', async () => {
  const page = await session.context.newPage();
  const panelPage = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panelPage.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);

    await panelPage.getByTestId('tab-mocks').click();

    // Read the v2 fixture and modify in memory (do not edit fixture file)
    const fixturePath = path.resolve('src/core/fixtures/mock-file-v2-export.json');
    const raw = await fs.promises.readFile(fixturePath, 'utf-8');
    const fileData = JSON.parse(raw);
    // Point static mock url to /api/goals
    fileData.mocks[0].url = '/api/goals';

    const buffer = Buffer.from(JSON.stringify(fileData));
    await panelPage.getByTestId('import').setInputFiles({
      name: 'mocks-v2.json',
      mimeType: 'application/json',
      buffer,
    });
    await panelPage.getByTestId('import-replace').click();

    await expect(panelPage.getByTestId('import-summary')).toBeVisible();

    // Reload page and check mock is served
    await page.reload();
    await page.click('#btn-fetch');
    await expect(page.locator('#out')).toHaveText('{"items":[]}');
  } finally {
    await panelPage.close();
    await page.close();
  }
});

test('a mock file import shows import-summary with the code mock count', async () => {
  const page = await session.context.newPage();
  const panelPage = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panelPage.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);

    await panelPage.getByTestId('tab-mocks').click();

    const fixturePath = path.resolve('src/core/fixtures/mock-file-v2-export.json');
    const raw = await fs.promises.readFile(fixturePath, 'utf-8');
    const buffer = Buffer.from(raw);

    await panelPage.getByTestId('import').setInputFiles({
      name: 'mocks-v2.json',
      mimeType: 'application/json',
      buffer,
    });
    await panelPage.getByTestId('import-replace').click();

    const summary = panelPage.getByTestId('import-summary');
    await expect(summary).toBeVisible();
    await expect(summary).toHaveText('6 mocks imported, 1 skipped, 1 as code mock, 2 header rules not imported');
    await expect(summary).toContainText('1 as code mock');
  } finally {
    await panelPage.close();
    await page.close();
  }
});

test('Default cannot be deleted or renamed', async () => {
  const page = await session.context.newPage();
  const panelPage = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panelPage.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);

    await panelPage.getByTestId('tab-mocks').click();

    await expect(panelPage.getByTestId('scenario-rename')).toBeDisabled();
    await expect(panelPage.getByTestId('scenario-delete')).toBeDisabled();
  } finally {
    await panelPage.close();
    await page.close();
  }
});

test('status 418 typed by hand is served; 150 and 600 show status-error', async () => {
  const page = await session.context.newPage();
  const panelPage = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panelPage.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);

    await panelPage.getByTestId('tab-mocks').click();
    await panelPage.getByTestId('mock-new').click();
    // The editor switches to the new mock once storage reports it; typing before that is lost.
    await expect(panelPage.getByTestId('field-pattern')).toHaveValue('/');
    await panelPage.getByTestId('field-pattern').fill('/api/goals');

    // Test 150 -> status-error, save disabled
    await panelPage.getByTestId('field-status').fill('150');
    await expect(panelPage.getByTestId('status-error')).toBeVisible();
    await expect(panelPage.getByTestId('mock-save')).toBeDisabled();

    // Test 600 -> status-error, save disabled
    await panelPage.getByTestId('field-status').fill('600');
    await expect(panelPage.getByTestId('status-error')).toBeVisible();
    await expect(panelPage.getByTestId('mock-save')).toBeDisabled();

    // Test 418 -> valid status, save enabled
    await panelPage.getByTestId('field-status').fill('418');
    await expect(panelPage.getByTestId('status-error')).not.toBeVisible();
    await expect(panelPage.getByTestId('mock-save')).toBeEnabled();

    await panelPage.getByTestId('mock-save').click();

    // Verify response status in page
    const status = await page.evaluate(async () => {
      const res = await fetch('/api/goals');
      return res.status;
    });
    expect(status).toBe(418);
  } finally {
    await panelPage.close();
    await page.close();
  }
});

test('Load file with a PNG makes a base64 mock with content-type image/png, served exactly', async () => {
  const page = await session.context.newPage();
  const panelPage = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panelPage.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);

    await panelPage.getByTestId('tab-mocks').click();
    await panelPage.getByTestId('mock-new').click();
    // The editor switches to the new mock once storage reports it; typing before that is lost.
    await expect(panelPage.getByTestId('field-pattern')).toHaveValue('/');
    await panelPage.getByTestId('field-pattern').fill('/api/logo.png');

    // Create 16-byte dummy PNG buffer
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
    await panelPage.getByTestId('load-file').setInputFiles({
      name: 'test-logo.png',
      mimeType: 'image/png',
      buffer: pngBuffer,
    });

    await panelPage.getByTestId('mock-save').click();

    // Check served bytes and content-type from page
    const info = await page.evaluate(async () => {
      const res = await fetch('/api/logo.png');
      const ab = await res.arrayBuffer();
      return {
        type: res.headers.get('content-type'),
        bytes: Array.from(new Uint8Array(ab)),
      };
    });

    expect(info.type).toBe('image/png');
    expect(info.bytes).toEqual(Array.from(pngBuffer));
  } finally {
    await panelPage.close();
    await page.close();
  }
});

test('a binary body shows body-size, body-preview for images, and body-download', async () => {
  const page = await session.context.newPage();
  const panelPage = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panelPage.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);

    await panelPage.getByTestId('tab-mocks').click();
    await panelPage.getByTestId('mock-new').click();
    // The editor switches to the new mock once storage reports it; typing before that is lost.
    await expect(panelPage.getByTestId('field-pattern')).toHaveValue('/');

    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    await panelPage.getByTestId('load-file').setInputFiles({
      name: 'preview-logo.png',
      mimeType: 'image/png',
      buffer: pngBuffer,
    });

    await expect(panelPage.getByTestId('body-size')).toBeVisible();
    await expect(panelPage.getByTestId('body-size')).toContainText(`${pngBuffer.length} bytes, image/png`);
    await expect(panelPage.getByTestId('body-preview')).toBeVisible();
    await expect(panelPage.getByTestId('body-download')).toBeVisible();

    // Test download
    const downloadPromise = panelPage.waitForEvent('download');
    await panelPage.getByTestId('body-download').click();
    const download = await downloadPromise;
    expect(download).toBeTruthy();

    // Test body-to-text switch
    await panelPage.getByTestId('body-to-text').click();
    await expect(panelPage.locator('.cm-content')).toBeVisible();
  } finally {
    await panelPage.close();
    await page.close();
  }
});
