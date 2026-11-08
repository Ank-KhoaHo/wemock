import { useEffect, useState } from 'react';
import { originToMatch } from '../../background/sites';
import { ensureProject } from '../../core/record';
import { projectForOrigin } from '../../core/scenario';
import type { WemockState } from '../../core/types';
import { newId } from '../../shared/ids';
import { loadState, onStateChange, updateState } from '../../shared/store';
import { ScenarioChips } from '../../ui/ScenarioChips';

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
    <div className="popup-container">
      <header className="popup-header">
        <h1 className="popup-title">wemock</h1>
      </header>
      <div className="popup-content">
        {isUnsupported ? (
          <p className="unsupported-message">wemock cannot run on this page</p>
        ) : (
          <>
            <div className="origin-row">
              <span className="origin-label">{origin}</span>
            </div>
            {isLocalhost ? (
              <div className="switch-section">
                <span className="always-on">Always on</span>
              </div>
            ) : (
              <div className="switch-section">
                <span className="switch-status">{isEnabled ? 'On' : 'Off'}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isEnabled}
                  aria-label={`Enable wemock on ${origin}`}
                  className={`switch ${isEnabled ? 'on' : 'off'}`}
                  onClick={handleToggle}
                >
                  <span className="switch-thumb" />
                </button>
              </div>
            )}
            {needsReload && tabId !== null && (
              <div className="reload-hint" data-testid="reload-hint">
                <span>Reload this page to start mocking.</span>
                <button
                  type="button"
                  onClick={() => {
                    browser.tabs.reload(tabId).catch(() => {});
                    setNeedsReload(false);
                  }}
                >
                  Reload
                </button>
              </div>
            )}
            {project && (
              <div className="scenarios-section">
                <span className="scenarios-heading">Scenarios</span>
                <ScenarioChips project={project} onPick={handlePickScenario} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
