import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// A26: builds the React test app into e2e/fixture/apps/react, served by the e2e fixture at /apps/react/.
// Rebuild: npx vite build --config scripts/apps/react/vite.config.ts
export default defineConfig({
  root: import.meta.dirname,
  base: '/apps/react/',
  plugins: [react()],
  logLevel: 'warn',
  build: {
    outDir: path.resolve(import.meta.dirname, '../../../e2e/fixture/apps/react'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
