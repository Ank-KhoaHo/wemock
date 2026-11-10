import { defineConfig } from '@playwright/test';

// A25: the load check. Run after `npm run build`.
export default defineConfig({
  testDir: '.',
  testMatch: 'perf.spec.ts',
  workers: 1,
  timeout: 180_000,
  reporter: [['list']],
});
