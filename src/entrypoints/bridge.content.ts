import { errorReply } from '../core/handler';
import {
  BRIDGE_SOURCE,
  isHandlerReply,
  isPageRunHandler,
  isPageToBridge,
  RUN_HANDLER,
  type BridgeHandlerResult,
  type BridgeToPage,
} from '../core/messages';
import { activeMocks, projectForOrigin } from '../core/scenario';
import { activeSockets } from '../core/sockets';
import type { Settings, WemockState } from '../core/types';
import { loadState, onStateChange } from '../shared/store';

// Runs in the ISOLATED world: relays page <-> extension. Registered at runtime.
export default defineContentScript({
  matches: [],
  registration: 'runtime',
  runAt: 'document_start',
  main() {
    let currentSettings: Settings = { enabled: true, recording: true };

    function sendConfig(state: WemockState) {
      currentSettings = state.settings;
      try {
        const project = projectForOrigin(state, window.location.origin);
        const mocks = project ? activeMocks(project) : [];
        const sockets = project ? activeSockets(project) : [];
        const headerRules = project?.headerRules;
        const msg: BridgeToPage = {
          source: BRIDGE_SOURCE,
          type: 'config',
          mocks,
          sockets,
          headerRules,
          settings: state.settings,
        };
        window.postMessage(msg, '*');
      } catch {
        // Best effort
      }
    }

    loadState()
      .then((state) => {
        sendConfig(state);
      })
      .catch(() => {
        // Extension context error
      });

    onStateChange((state) => {
      sendConfig(state);
    });

    window.addEventListener('message', (event) => {
      try {
        if (event.source !== window) return;
        if (isPageRunHandler(event.data)) {
          const { callId, mockId, request } = event.data;
          const answer = (reply: BridgeHandlerResult['reply']) => {
            const msg: BridgeHandlerResult = { source: BRIDGE_SOURCE, type: 'handler-result', callId, reply };
            window.postMessage(msg, '*');
          };
          browser.runtime
            .sendMessage({ type: RUN_HANDLER, mockId, request })
            .then((reply: unknown) => answer(isHandlerReply(reply) ? reply : errorReply('wemock sent a bad answer')))
            .catch(() => answer(errorReply('wemock is not reachable; reload the page')));
          return;
        }
        if (!isPageToBridge(event.data)) return;
        if (!currentSettings.recording) return;

        browser.runtime
          .sendMessage({
            type: 'log',
            entry: event.data.entry,
          })
          .catch(() => {
            // Extension reloaded or receiver missing
          });
      } catch {
        // Any chrome.runtime error (extension reloaded) is caught and ignored
      }
    });
  },
});
