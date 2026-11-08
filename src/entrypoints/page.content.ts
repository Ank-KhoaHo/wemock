import { isBridgeToPage, PAGE_SOURCE, type PageToBridge } from '../core/messages';
import type { LogDraft } from '../core/types';
import { installFetchPatch } from '../patch/fetchPatch';
import { createGate } from '../patch/gate';

// Runs in the page's MAIN world at document_start. Registered at runtime by
// the background worker for enabled sites only, never through the manifest.
export default defineContentScript({
  matches: [],
  registration: 'runtime',
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    try {
      const gate = createGate();

      installFetchPatch(window, {
        gate,
        report(entry: LogDraft) {
          try {
            const msg: PageToBridge = {
              source: PAGE_SOURCE,
              type: 'log',
              entry,
            };
            window.postMessage(msg, '*');
          } catch {
            // Log reporting is best effort
          }
        },
        now: () => Date.now(),
      });

      window.addEventListener('message', (event) => {
        try {
          if (event.source !== window) return;
          if (isBridgeToPage(event.data)) {
            gate.open({
              mocks: event.data.mocks,
              settings: event.data.settings,
            });
          }
        } catch {
          // Never break the page
        }
      });
    } catch {
      // Never break the page
    }
  },
});
