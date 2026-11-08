import { useEffect, useState } from 'react';
import { ensureProject, mockFromLog, scenarioFromLogs } from '../../core/record';
import { projectForOrigin } from '../../core/scenario';
import type { LogEntry } from '../../core/types';
import { newId } from '../../shared/ids';
import { getInspectedTabId } from '../../shared/inspectedTab';
import { LogDetail } from '../../ui/LogDetail';
import { LogTable } from '../../ui/LogTable';
import { TopBar } from '../../ui/TopBar';
import { useTabLog, useWemockState } from '../../ui/useWemockState';

export default function App() {
  const tabId = getInspectedTabId();
  const { state, update } = useWemockState();
  const { entries, clear } = useTabLog(tabId);

  const [tabOrigin, setTabOrigin] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'log' | 'mocks'>('log');
  const [filter, setFilter] = useState('');
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [isNamingScenario, setIsNamingScenario] = useState(false);
  const [scenarioName, setScenarioName] = useState('');

  useEffect(() => {
    // Apply devtools theme if dark
    if (typeof browser !== 'undefined' && browser.devtools?.panels?.themeName === 'dark') {
      document.documentElement.classList.add('dark');
    }
  }, []);

  useEffect(() => {
    if (tabId <= 0 || typeof browser === 'undefined' || !browser.tabs?.get) return;

    const fetchTab = async () => {
      try {
        const tab = await browser.tabs.get(tabId);
        if (tab?.url) {
          try {
            setTabOrigin(new URL(tab.url).origin);
          } catch {}
        }
      } catch {}
    };

    fetchTab();

    const onUpdated = (updatedTabId: number, changeInfo: { url?: string }) => {
      if (updatedTabId === tabId && changeInfo.url) {
        try {
          setTabOrigin(new URL(changeInfo.url).origin);
        } catch {}
      }
    };

    browser.tabs.onUpdated?.addListener(onUpdated);
    return () => {
      browser.tabs?.onUpdated?.removeListener(onUpdated);
    };
  }, [tabId]);

  const project = state && tabOrigin ? projectForOrigin(state, tabOrigin) : null;
  const recording = state?.settings.recording ?? true;
  const enabled = state?.settings.enabled ?? true;

  const filteredEntries = filter
    ? entries.filter((e) => e.url.toLowerCase().includes(filter.toLowerCase()))
    : entries;

  const selectedEntry = entries.find((e) => e.id === selectedEntryId) ?? null;

  const handleToggleRecording = () => {
    update((s) => ({
      ...s,
      settings: { ...s.settings, recording: !s.settings.recording },
    })).catch(() => {});
  };

  const handleToggleEnabled = () => {
    update((s) => ({
      ...s,
      settings: { ...s.settings, enabled: !s.settings.enabled },
    })).catch(() => {});
  };

  const handlePickScenario = (scenarioId: string) => {
    if (!project) return;
    update((s) => ({
      ...s,
      projects: s.projects.map((p) =>
        p.id === project.id ? { ...p, activeScenarioId: scenarioId } : p,
      ),
    })).catch(() => {});
  };

  const handleMockThis = (entry: LogEntry) => {
    update((s) => {
      let originToUse = tabOrigin;
      if (!originToUse) {
        try {
          originToUse = new URL(entry.url).origin;
        } catch {
          originToUse = '';
        }
      }
      if (!originToUse) return s;

      const { state: nextState, project: targetProject } = ensureProject(s, originToUse, newId);
      const mock = mockFromLog(entry, newId(), Date.now());

      const updatedProjects = nextState.projects.map((p) => {
        if (p.id !== targetProject.id) return p;
        const activeScenarioId = p.activeScenarioId || p.scenarios[0]?.id;
        const updatedScenarios = p.scenarios.map((sc) => {
          if (sc.id !== activeScenarioId) return sc;
          return {
            ...sc,
            mocks: [...sc.mocks, mock],
          };
        });
        return {
          ...p,
          scenarios: updatedScenarios,
        };
      });

      return {
        ...nextState,
        projects: updatedProjects,
      };
    }).catch(() => {});
  };

  const handleSaveScenarioSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = scenarioName.trim();
    if (!trimmed) return;

    update((s) => {
      let originToUse = tabOrigin;
      if (!originToUse && filteredEntries.length > 0) {
        try {
          originToUse = new URL(filteredEntries[0]!.url).origin;
        } catch {
          originToUse = '';
        }
      }
      if (!originToUse) return s;

      const { state: nextState, project: targetProject } = ensureProject(s, originToUse, newId);
      const newScenario = scenarioFromLogs(filteredEntries, trimmed, newId, Date.now());

      const updatedProjects = nextState.projects.map((p) => {
        if (p.id !== targetProject.id) return p;
        return {
          ...p,
          scenarios: [...p.scenarios, newScenario],
          activeScenarioId: newScenario.id,
        };
      });

      return {
        ...nextState,
        projects: updatedProjects,
      };
    }).catch(() => {});

    setIsNamingScenario(false);
    setScenarioName('');
  };

  return (
    <div className="panel-container">
      <TopBar
        project={project}
        projects={state?.projects ?? []}
        onPickScenario={handlePickScenario}
        recording={recording}
        onToggleRecording={handleToggleRecording}
        enabled={enabled}
        onToggleEnabled={handleToggleEnabled}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {activeTab === 'log' ? (
        <div className="panel-main-content">
          <div className="panel-toolbar">
            <div className="toolbar-left">
              <input
                type="text"
                data-testid="log-filter"
                className="log-filter-input"
                placeholder="Filter by URL..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <button
                type="button"
                className="clear-log-btn"
                onClick={clear}
                title="Clear log"
              >
                Clear
              </button>
            </div>
            <div className="toolbar-right">
              {!isNamingScenario ? (
                <button
                  type="button"
                  data-testid="save-scenario"
                  className="save-scenario-btn"
                  onClick={() => setIsNamingScenario(true)}
                  disabled={filteredEntries.length === 0}
                >
                  Save as scenario
                </button>
              ) : (
                <form onSubmit={handleSaveScenarioSubmit} className="save-scenario-form">
                  <input
                    type="text"
                    data-testid="save-scenario-name"
                    className="save-scenario-name-input"
                    placeholder="Scenario name"
                    value={scenarioName}
                    onChange={(e) => setScenarioName(e.target.value)}
                    autoFocus
                  />
                  <button
                    type="submit"
                    data-testid="save-scenario-submit"
                    className="save-scenario-confirm-btn"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="save-scenario-cancel-btn"
                    onClick={() => {
                      setIsNamingScenario(false);
                      setScenarioName('');
                    }}
                  >
                    Cancel
                  </button>
                </form>
              )}
            </div>
          </div>

          <div className="panel-split-view">
            <div className="panel-split-left">
              <LogTable
                entries={filteredEntries}
                selectedEntryId={selectedEntryId}
                onSelectEntry={(entry) => setSelectedEntryId(entry.id)}
              />
            </div>
            <div className="panel-split-right">
              <LogDetail
                entry={selectedEntry}
                onMockThis={handleMockThis}
                onClose={() => setSelectedEntryId(null)}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="panel-mocks-placeholder" data-testid="mocks-placeholder">
          <p>Mocks management coming in Task 9</p>
        </div>
      )}
    </div>
  );
}
