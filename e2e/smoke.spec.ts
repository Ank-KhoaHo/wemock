import { expect, test } from '@playwright/test';
import { launchExtension } from './helpers';

test('the unpacked build loads and its panel page renders', async () => {
  const { context, extensionId } = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/panel.html`);
    await expect(page.locator('h1')).toHaveText('wemock');
  } finally {
    await context.close();
  }
});
