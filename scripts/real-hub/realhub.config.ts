import { defineConfig } from '@playwright/test';

// A27: run through scripts/real-hub/run.sh, which starts the hub in Docker first.
export default defineConfig({
  testDir: '.',
  testMatch: 'realhub.spec.ts',
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
});
