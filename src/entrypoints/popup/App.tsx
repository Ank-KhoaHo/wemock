import { useEffect, useState } from 'react';
import './popup.css';
import { originToMatch } from '../../background/sites';
import { ensureProject } from '../../core/record';
import { projectForOrigin } from '../../core/scenario';
import type { WemockState } from '../../core/types';
import { newId } from '../../shared/ids';
import { loadState, onStateChange, updateState } from '../../shared/store';

function parseOriginInfo(urlStr: string | null): {
  isUnsupported: boolean;
  isLocalhost: boolean;
  origin: string;
} {
  if (!urlStr) {
    return { isUnsupported: true, isLocalhost: false, origin: '' };
  }
  try {
    const url = new URL(urlStr);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { isUnsupported: true, isLocalhost: false, origin: urlStr };
    }
    if (
      url.hostname === 'chromewebstore.google.com' ||
      (url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore'))
    ) {
      return { isUnsupported: true, isLocalhost: false, origin: url.origin };
    }
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return { isUnsupported: false, isLocalhost, origin: url.origin };
  } catch {
    return { isUnsupported: true, isLocalhost: false, origin: urlStr };
  }
}

export default function App() {
  // The shortcut differs on a Mac; DevTools uses Option, Command and I there.
  const isMac = /mac/i.test(navigator.platform);
  const [tabUrl, setTabUrl] = useState<string | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  // Scripts reach a page only when it loads, so a just-enabled site needs one reload.
  const [needsReload, setNeedsReload] = useState(false);
  const [state, setState] = useState<WemockState | null>(null);

  useEffect(() => {
    browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.url) {
        setTabUrl(tab.url);
      }
      if (typeof tab?.id === 'number') {
        setTabId(tab.id);
      }
    }).catch(() => {});

    loadState().then(setState).catch(() => {});
    const unsubscribe = onStateChange((next) => {
      setState(next);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const { isUnsupported, isLocalhost, origin } = parseOriginInfo(tabUrl);
  const project = state && origin ? projectForOrigin(state, origin) : null;
  const isEnabled = state && origin ? state.enabledOrigins.includes(origin) : false;

  const handleToggle = async () => {
    if (!origin) return;

    if (!isEnabled) {
      const match = originToMatch(origin);
      // browser.permissions.request must be called FIRST, before any await (user gesture)
      const requestPromise = browser.permissions.request({ origins: [match] });
      const granted = await requestPromise;
      if (!granted) return;

      await updateState((s) => {
        const nextOrigins = s.enabledOrigins.includes(origin)
          ? s.enabledOrigins
          : [...s.enabledOrigins, origin];
        const withOrigin: WemockState = { ...s, enabledOrigins: nextOrigins };
        const { state: nextState } = ensureProject(withOrigin, origin, newId);
        return nextState;
      });
      setNeedsReload(true);
    } else {
      const match = originToMatch(origin);
      await updateState((s) => ({
        ...s,
        enabledOrigins: s.enabledOrigins.filter((o) => o !== origin),
      }));
      try {
        await browser.permissions.remove({ origins: [match] });
      } catch {
        // ignore
      }
    }
  };

  const handlePickScenario = async (scenarioId: string) => {
    if (!project) return;
    await updateState((s) => ({
      ...s,
      projects: s.projects.map((p) =>
        p.id === project.id ? { ...p, activeScenarioId: scenarioId } : p
      ),
    }));
  };

  return (
    <div className="pop">
      <header className="pop-head">
        <img src="/icon/32.png" alt="" width={22} height={22} />
        wemock
      </header>
      {isUnsupported ? (
        <p className="pop-unsupported">wemock cannot run on this page.</p>
      ) : (
        <>
          <div className="pop-site" data-testid="popup-site">
            <div className="pop-origin">
              <span className="pop-mono">{origin.replace(/^https?:\/\//, '')}</span>
              <small>
                {isLocalhost
                  ? 'wemock is always on for localhost.'
                  : isEnabled
                    ? 'wemock mocks calls on this site.'
                    : 'wemock leaves this site alone.'}
              </small>
            </div>
            {!isLocalhost && (
              <button
                type="button"
                role="switch"
                data-testid="popup-switch"
                aria-checked={isEnabled}
                aria-label={`Mock calls on ${origin}`}
                className={`pop-switch ${isEnabled ? 'on' : ''}`}
                onClick={handleToggle}
              >
                <span className="pop-thumb" />
              </button>
            )}
          </div>
          {project && (isEnabled || isLocalhost) && (
            <div className="pop-scenario">
              <label htmlFor="popup-scenario">Active scenario</label>
              <select
                id="popup-scenario"
                data-testid="popup-scenario"
                value={project.activeScenarioId}
                onChange={(e) => {
                  handlePickScenario(e.target.value).catch(() => {});
                }}
              >
                {project.scenarios.map((sc, i) => (
                  <option key={sc.id} value={sc.id}>
                    {i === 0 ? `${sc.name} only` : sc.name}
                  </option>
                ))}
              </select>
              <small>Default answers whatever the active scenario has no mock for.</small>
            </div>
          )}
          {needsReload && tabId !== null && (
            <div className="pop-reload" data-testid="reload-hint">
              <span>Reload the page so wemock can start.</span>
              <button
                type="button"
                data-testid="popup-reload"
                onClick={() => {
                  browser.tabs.reload(tabId).catch(() => {});
                  setNeedsReload(false);
                }}
              >
                Reload
              </button>
            </div>
          )}
        </>
      )}
      <section className="pop-how" data-testid="devtools-steps" aria-label="How to open wemock">
        <h2>wemock lives in DevTools</h2>
        <div className="pop-step">
          <span className="pop-num" aria-hidden="true">1</span>
          <div>
            Press <kbd>F12</kbd> <span className="pop-or">or</span>{' '}
            {isMac ? (
              <>
                <kbd>⌥</kbd> <kbd>⌘</kbd> <kbd>I</kbd>
              </>
            ) : (
              <>
                <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>I</kbd>
              </>
            )}
          </div>
        </div>
        <div className="pop-step">
          <span className="pop-num" aria-hidden="true">2</span>
          <div>
            Click the <b>wemock tab</b>
            <div className="pop-tabs" aria-hidden="true">
              <span>Elements</span>
              <span>Console</span>
              <span>Network</span>
              <span className="us">wemock</span>
              <span className="more">»</span>
            </div>
            <div className="pop-small">Not there? It hides under » when DevTools is narrow.</div>
          </div>
        </div>
      </section>
    </div>
  );
}
