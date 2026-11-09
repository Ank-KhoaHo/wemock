import { useEffect, useState } from 'react';
import { useIsDark } from '../../ui/useIsDark';
import { exportProject, parseProjectFile } from '../../core/exportFile';
import { importMokku } from '../../core/mokkuImport';
import { ensureProject, mockFromLog, scenarioFromLogs } from '../../core/record';
import { projectForOrigin } from '../../core/scenario';
import type { LogEntry, Mock, Project, Scenario } from '../../core/types';
import { newId } from '../../shared/ids';
import { getInspectedTabId } from '../../shared/inspectedTab';
import { LogDetail } from '../../ui/LogDetail';
import { LogTable } from '../../ui/LogTable';
import { MockEditor } from '../../ui/MockEditor';
import { MockList } from '../../ui/MockList';
import { TopBar } from '../../ui/TopBar';
import { useTabLog, useWemockState } from '../../ui/useWemockState';

export function formatImportSummary(summary: {
  mocks: number;
  mocksSkipped?: number;
  functionMocksDisabled?: number;
  headerRulesSkipped?: number;
}): string {
  const parts: string[] = [];
  if (summary.mocks > 0) {
    parts.push(`${summary.mocks} mock${summary.mocks === 1 ? '' : 's'} imported`);
  }
  if (summary.mocksSkipped && summary.mocksSkipped > 0) {
    parts.push(`${summary.mocksSkipped} skipped`);
  }
  if (summary.functionMocksDisabled && summary.functionMocksDisabled > 0) {
    parts.push(
      `${summary.functionMocksDisabled} function mock${summary.functionMocksDisabled === 1 ? '' : 's'} disabled`,
    );
  }
  if (summary.headerRulesSkipped && summary.headerRulesSkipped > 0) {
    parts.push(
      `${summary.headerRulesSkipped} header rule${summary.headerRulesSkipped === 1 ? '' : 's'} not imported`,
    );
  }
  if (parts.length === 0) {
    return '0 mocks imported';
  }
  return parts.join(', ');
}

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

  // Mocks tab state
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('default');
  const [selectedMockId, setSelectedMockId] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  // applyTheme() (panel/main.tsx) sets the class; this follows it.
  const isDark = useIsDark();

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

  const originProject = state && tabOrigin ? projectForOrigin(state, tabOrigin) : null;
  const project: Project | null =
    (selectedProjectId && state?.projects.find((p) => p.id === selectedProjectId)) ||
    originProject ||
    state?.projects[0] ||
    null;

  // Auto-ensure project for origin if mocks tab is open and no project exists
  useEffect(() => {
    if (activeTab === 'mocks' && tabOrigin && !originProject && state) {
      update((s) => {
        const { state: nextState } = ensureProject(s, tabOrigin, newId);
        return nextState;
      }).catch(() => {});
    }
  }, [activeTab, tabOrigin, originProject, state, update]);

  // Keep selectedScenarioId valid for the current project
  useEffect(() => {
    if (project) {
      const exists = project.scenarios.some((s) => s.id === selectedScenarioId);
      if (!exists && project.scenarios.length > 0) {
        setSelectedScenarioId(project.scenarios[0]!.id);
      }
    }
  }, [project, selectedScenarioId]);

  const recording = state?.settings.recording ?? true;
  const enabled = state?.settings.enabled ?? true;
  const consoleLog = state?.settings.consoleLog !== false;

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

  const handleToggleConsoleLog = () => {
    update((s) => ({
      ...s,
      settings: { ...s.settings, consoleLog: s.settings.consoleLog === false },
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
    setSelectedScenarioId(scenarioId);
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

  // Mocks tab handlers
  const handleExport = () => {
    if (!project) return;
    const jsonText = exportProject(project);
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wemock-${project.name}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportSummary(null);
    setImportError(null);

    try {
      const text = await file.text();
      let importedProject: Project | null = null;
      let summaryText = '';

      // Try parseProjectFile first
      const wemockResult = parseProjectFile(text);
      if (wemockResult.ok) {
        const p = wemockResult.project;
        const totalMocks = p.scenarios.reduce((acc, sc) => acc + sc.mocks.length, 0);
        importedProject = {
          ...p,
          id: newId(),
        };
        summaryText = formatImportSummary({ mocks: totalMocks });
      } else {
        // Try Mokku import
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(text);
        } catch {
          setImportError(wemockResult.error);
          e.target.value = '';
          return;
        }

        const mokkuResult = importMokku(parsedJson, tabOrigin, newId, Date.now());
        if (mokkuResult.ok) {
          importedProject = mokkuResult.result.project;
          summaryText = formatImportSummary(mokkuResult.result.summary);
        } else {
          setImportError(mokkuResult.error || wemockResult.error);
          e.target.value = '';
          return;
        }
      }

      if (!importedProject) {
        e.target.value = '';
        return;
      }

      // When a Mokku or wemock import brings a project for an origin that already has one,
      // the imported project replaces the origin on the old project: the old one stays in the list
      // but loses this origin.
      const originToClaim = tabOrigin;
      const projectToInsert: Project = {
        ...importedProject,
        origins: originToClaim ? [originToClaim] : importedProject.origins,
      };

      await update((s) => {
        const updatedExisting = s.projects.map((p) => {
          if (!originToClaim) return p;
          return {
            ...p,
            origins: p.origins.filter((o) => o !== originToClaim),
          };
        });
        return {
          ...s,
          projects: [...updatedExisting, projectToInsert],
        };
      });

      setSelectedProjectId(projectToInsert.id);
      setSelectedScenarioId(projectToInsert.scenarios[0]?.id ?? 'default');
      setSelectedMockId(null);
      setImportSummary(summaryText);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      e.target.value = '';
    }
  };

  const handleAddScenario = (name: string) => {
    if (!project) return;
    const newScenario: Scenario = {
      id: newId(),
      name,
      mocks: [],
    };
    update((s) => ({
      ...s,
      projects: s.projects.map((p) =>
        p.id === project.id ? { ...p, scenarios: [...p.scenarios, newScenario] } : p,
      ),
    })).catch(() => {});
    setSelectedScenarioId(newScenario.id);
  };

  const handleRenameScenario = (scenarioId: string, newName: string) => {
    if (!project) return;
    update((s) => ({
      ...s,
      projects: s.projects.map((p) => {
        if (p.id !== project.id) return p;
        return {
          ...p,
          scenarios: p.scenarios.map((sc) =>
            sc.id === scenarioId ? { ...sc, name: newName } : sc,
          ),
        };
      }),
    })).catch(() => {});
  };

  const handleDeleteScenario = (scenarioId: string) => {
    if (!project) return;
    update((s) => ({
      ...s,
      projects: s.projects.map((p) => {
        if (p.id !== project.id) return p;
        const remaining = p.scenarios.filter((sc) => sc.id !== scenarioId);
        const nextActive =
          p.activeScenarioId === scenarioId
            ? remaining[0]?.id ?? 'default'
            : p.activeScenarioId;
        return {
          ...p,
          scenarios: remaining,
          activeScenarioId: nextActive,
        };
      }),
    })).catch(() => {});
    setSelectedScenarioId(project.scenarios[0]?.id ?? 'default');
    setSelectedMockId(null);
  };

  const handleAddMock = (scenarioId: string, newMock: Mock) => {
    if (!project) return;
    update((s) => ({
      ...s,
      projects: s.projects.map((p) => {
        if (p.id !== project.id) return p;
        return {
          ...p,
          scenarios: p.scenarios.map((sc) =>
            sc.id === scenarioId ? { ...sc, mocks: [...sc.mocks, newMock] } : sc,
          ),
        };
      }),
    })).catch(() => {});
    setSelectedMockId(newMock.id);
  };

  const handleSaveMock = (savedMock: Mock) => {
    if (!project) return;
    update((s) => ({
      ...s,
      projects: s.projects.map((p) => {
        if (p.id !== project.id) return p;
        return {
          ...p,
          scenarios: p.scenarios.map((sc) => ({
            ...sc,
            mocks: sc.mocks.map((m) => (m.id === savedMock.id ? savedMock : m)),
          })),
        };
      }),
    })).catch(() => {});
  };

  const handleDeleteMock = (mockId: string) => {
    if (!project) return;
    update((s) => ({
      ...s,
      projects: s.projects.map((p) => {
        if (p.id !== project.id) return p;
        return {
          ...p,
          scenarios: p.scenarios.map((sc) => ({
            ...sc,
            mocks: sc.mocks.filter((m) => m.id !== mockId),
          })),
        };
      }),
    })).catch(() => {});
    setSelectedMockId(null);
  };

  const handleUpdateScenarioMocks = (scenarioId: string, nextMocks: Mock[]) => {
    if (!project) return;
    update((s) => ({
      ...s,
      projects: s.projects.map((p) => {
        if (p.id !== project.id) return p;
        return {
          ...p,
          scenarios: p.scenarios.map((sc) =>
            sc.id === scenarioId ? { ...sc, mocks: nextMocks } : sc,
          ),
        };
      }),
    })).catch(() => {});
  };

  // Find currently selected mock across all scenarios in project
  let selectedMock: Mock | null = null;
  if (project && selectedMockId) {
    for (const sc of project.scenarios) {
      const found = sc.mocks.find((m) => m.id === selectedMockId);
      if (found) {
        selectedMock = found;
        break;
      }
    }
  }

  return (
    <div className="panel-container">
      <TopBar
        project={project}
        projects={state?.projects ?? []}
        selectedProjectId={project?.id}
        onSelectProject={(projId) => {
          setSelectedProjectId(projId);
          const p = state?.projects.find((proj) => proj.id === projId);
          if (p && p.scenarios.length > 0) {
            setSelectedScenarioId(p.scenarios[0]!.id);
            setSelectedMockId(null);
          }
        }}
        onPickScenario={handlePickScenario}
        recording={recording}
        onToggleRecording={handleToggleRecording}
        enabled={enabled}
        onToggleEnabled={handleToggleEnabled}
        consoleLog={consoleLog}
        onToggleConsoleLog={handleToggleConsoleLog}
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
        <div className="panel-main-content">
          {/* Top area: import/export toolbar */}
          <div className="mocks-toolbar">
            <div className="mocks-toolbar-actions">
              <button
                type="button"
                data-testid="export"
                className="btn-secondary"
                disabled={!project}
                onClick={handleExport}
              >
                Export
              </button>
              <div className="file-input-wrapper">
                <button type="button" className="btn-secondary">
                  Import
                </button>
                <input
                  type="file"
                  data-testid="import"
                  className="overlay-file-input"
                  onChange={handleImportFile}
                />
              </div>
            </div>

            <div className="mocks-toolbar-feedback">
              {importSummary && (
                <div data-testid="import-summary" className="import-summary-text">
                  {importSummary}
                </div>
              )}
              {importError && (
                <div data-testid="import-error" className="import-error-text">
                  {importError}
                </div>
              )}
            </div>
          </div>

          {project ? (
            <div className="panel-split-view">
              <div className="panel-split-left">
                <MockList
                  project={project}
                  selectedScenarioId={selectedScenarioId}
                  selectedMockId={selectedMockId}
                  onSelectScenario={(scId) => setSelectedScenarioId(scId)}
                  onSelectMock={(mockId) => setSelectedMockId(mockId)}
                  onUpdateScenarioMocks={handleUpdateScenarioMocks}
                  onAddScenario={handleAddScenario}
                  onRenameScenario={handleRenameScenario}
                  onDeleteScenario={handleDeleteScenario}
                  onAddMock={handleAddMock}
                />
              </div>
              <div className="panel-split-right">
                <MockEditor
                  mock={selectedMock}
                  isDark={isDark}
                  onSave={handleSaveMock}
                  onDelete={handleDeleteMock}
                />
              </div>
            </div>
          ) : (
            <div className="mock-editor-empty">
              <p>No project loaded for this site</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
