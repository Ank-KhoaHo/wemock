import { initLogRouter } from '../background/logRouter';

async function registerDefaultScripts(): Promise<void> {
  const ids = ['wemock-page', 'wemock-bridge'];
  try {
    await browser.scripting.unregisterContentScripts({ ids });
  } catch {
    // Ignore if not previously registered
  }

  await browser.scripting.registerContentScripts([
    {
      id: 'wemock-page',
      matches: ['http://localhost/*', 'http://127.0.0.1/*'],
      runAt: 'document_start',
      world: 'MAIN',
      js: ['content-scripts/page.js'],
    },
    {
      id: 'wemock-bridge',
      matches: ['http://localhost/*', 'http://127.0.0.1/*'],
      runAt: 'document_start',
      world: 'ISOLATED',
      js: ['content-scripts/bridge.js'],
    },
  ]);
}

export default defineBackground(() => {
  initLogRouter();

  browser.runtime.onInstalled.addListener(() => {
    registerDefaultScripts().catch(() => {});
  });

  registerDefaultScripts().catch(() => {});
});
