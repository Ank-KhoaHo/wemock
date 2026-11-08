import { defineConfig } from '@playwright/test';

// Extensions need one persistent Chromium context per test file, so files run
// one at a time. e2e/helpers.ts launches it.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  reporter: [['list']],
});
