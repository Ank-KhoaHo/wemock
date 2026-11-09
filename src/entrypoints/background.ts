import { initHandlerRunner } from '../background/handlerRunner';
import { initLogRouter } from '../background/logRouter';
import { syncRegistrations } from '../background/sites';
import { loadState, onStateChange } from '../shared/store';

function originsChanged(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return true;
  }
  return false;
}

export default defineBackground(() => {
  initLogRouter();
  initHandlerRunner(loadState);

  let currentOrigins: string[] = [];

  const sync = async (): Promise<void> => {
    try {
      const state = await loadState();
      currentOrigins = state.enabledOrigins ?? [];
      await syncRegistrations(currentOrigins);
    } catch {
      // Ignore background sync errors
    }
  };

  browser.runtime.onInstalled.addListener(() => {
    sync().catch(() => {});
  });

  if (browser.runtime.onStartup) {
    browser.runtime.onStartup.addListener(() => {
      sync().catch(() => {});
    });
  }

  sync().catch(() => {});

  onStateChange((state) => {
    const nextOrigins = state.enabledOrigins ?? [];
    if (originsChanged(currentOrigins, nextOrigins)) {
      currentOrigins = nextOrigins;
      syncRegistrations(nextOrigins).catch(() => {});
    }
  });
});
