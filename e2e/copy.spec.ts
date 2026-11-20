import { expect, test, type Page } from '@playwright/test';
import { ensureProject } from '../src/core/record';
import { emptyState } from '../src/core/types';
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
  const { state } = ensureProject({ ...emptyState(), enabledOrigins: [fixture.origin] }, fixture.origin, newId);
  await session.setState(state);
});

/** Opens the panel with the clipboard replaced, so what a copy wrote can be read back. */
async function openPanel(clipboard: 'works' | 'blocked'): Promise<{ page: Page; panel: Page }> {
  const page = await session.context.newPage();
  const panel = await session.context.newPage();
  await panel.addInitScript((mode) => {
    const record = (text: string) => {
      (globalThis as unknown as { copied: string }).copied = text;
    };
    navigator.clipboard.writeText =
      mode === 'works'
        ? async (text: string) => record(text)
        : () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
  }, clipboard);
  await page.goto(`${fixture.url}/index.html`);
  const tabId = await session.tabIdOf(page);
  await panel.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);
  return { page, panel };
}

function copied(panel: Page): Promise<string | undefined> {
  return panel.evaluate(() => (globalThis as unknown as { copied?: string }).copied);
}

test('the Log detail copies the response body and headers', async () => {
  const { page, panel } = await openPanel('works');
  try {
    await page.click('#btn-fetch');
    await panel.getByTestId('log-row').click();

    await panel.getByRole('button', { name: 'Copy response body' }).click();
    expect(await copied(panel)).toBe('{\n  "source": "server"\n}');
    const bodyBlock = panel.locator('.copyable', { has: panel.getByTestId('response-body') });
    await expect(bodyBlock.getByRole('button')).toHaveAttribute('aria-label', 'Copied');

    await panel.getByRole('button', { name: 'Copy response headers' }).click();
    expect(await copied(panel)).toContain('content-type: application/json');
    await expect(panel.getByRole('button', { name: 'Copy request headers' })).toHaveCount(0);
  } finally {
    await panel.close();
    await page.close();
  }
});

test('a refused copy says so instead of failing silently', async () => {
  const { page, panel } = await openPanel('blocked');
  try {
    await page.click('#btn-fetch');
    await panel.getByTestId('log-row').click();

    await panel.getByRole('button', { name: 'Copy response body' }).click();
    await expect(panel.getByText('Could not copy')).toBeVisible();
    expect(await copied(panel)).toBeUndefined();
  } finally {
    await panel.close();
    await page.close();
  }
});

test('the mock editor copies the response body it shows', async () => {
  const { page, panel } = await openPanel('works');
  try {
    await panel.getByTestId('tab-mocks').click();
    await panel.getByTestId('add-menu-open').click();
    await panel.getByTestId('mock-new').click();
    await expect(panel.getByTestId('field-pattern')).toHaveValue('/');
    await panel.locator('.cm-content').fill('{"a":1}');

    await panel.getByRole('button', { name: 'Copy response body' }).click();
    expect(await copied(panel)).toBe('{"a":1}');
  } finally {
    await panel.close();
    await page.close();
  }
});
