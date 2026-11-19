import { defineConfig } from '@playwright/test';

// The lab's tests. Run them with `bash lab/run.sh test` (it starts the lab in Docker first), after
// `npm run build`. Not part of CI: the lab needs Docker.
export default defineConfig({
  testDir: '.',
  testMatch: ['features.spec.ts', 'perf.spec.ts'],
  workers: 1,
  timeout: 180_000,
  reporter: [['list']],
});
