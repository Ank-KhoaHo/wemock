import { defineConfig } from '@playwright/test';

// A19: remakes the Chrome Web Store images. Run `npm run build` first, then
// `npx playwright test --config scripts/store/store.config.ts`. Output: docs/store/images/.
export default defineConfig({
  testDir: '.',
  testMatch: 'store.spec.ts',
  workers: 1,
  timeout: 120_000,
  reporter: [['list']],
});
