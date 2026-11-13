import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsDark } from '../../ui/useIsDark';
import { exportProject, exportScenario, parseProjectFile, parseScenarioFile } from '../../core/exportFile';
import { logToHar } from '../../core/harExport';
import { detectHar, harSummaryText, importHar } from '../../core/harImport';
import { importMokku } from '../../core/mokkuImport';
import { detectOpenApi, importOpenApi, openApiSummaryText, parseSpecText } from '../../core/openapiImport';
import { ensureProject, mockFromLog, scenarioFromLogs } from '../../core/record';
import { SAMPLE_TIP, sampleProject } from '../../core/sample';
import { isValidStatus } from '../../core/statusText';
import { projectForOrigin } from '../../core/scenario';
import { addScenario, clearProject, deleteScenarios, duplicateMock, duplicateScenario, duplicateSocket, mergeProject, replaceProject } from '../../core/scenarioOps';
import { siteStatus } from '../../core/siteStatus';
import { socketFromLogs } from '../../core/socketRecord';
import { type HeaderRule, type LogEntry, type Mock, newProject, type Project, type Scenario, type SocketMock } from '../../core/types';
import { newId } from '../../shared/ids';
import { getInspectedTabId } from '../../shared/inspectedTab';
import { LogDetail } from '../../ui/LogDetail';
import { LogTable } from '../../ui/LogTable';
import { MockEditor } from '../../ui/MockEditor';
import { MockList } from '../../ui/MockList';
import { SocketEditor } from '../../ui/SocketEditor';
import { TestBar } from '../../ui/TestBar';
import { TopBar } from '../../ui/TopBar';
import { PanelErrorBoundary } from '../../ui/PanelErrorBoundary';
import { useTabLog, useWemockState } from '../../ui/useWemockState';

export function formatImportSummary(summary: {
  mocks: number;
  mocksSkipped?: number;
  codeMocks?: number;
  headerRulesSkipped?: number;
}): string {
  const parts: string[] = [];
  if (summary.mocks > 0) {
    parts.push(`${summary.mocks} mock${summary.mocks === 1 ? '' : 's'} imported`);
  }
  if (summary.mocksSkipped && summary.mocksSkipped > 0) {
    parts.push(`${summary.mocksSkipped} skipped`);
  }
  if (summary.codeMocks && summary.codeMocks > 0) {
    parts.push(`${summary.codeMocks} as code mock${summary.codeMocks === 1 ? '' : 's'}`);
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
  const [tabUrl, setTabUrl] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'log' | 'mocks'>('log');
  const [filter, setFilter] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<Set<'MOCK' | 'real' | 'LATE'>>(new Set());
  const [selectedMethods, setSelectedMethods] = useState<Set<string>>(new Set());
  const [selectedStatuses, setSelectedStatuses] = useState<Set<'2xx' | '3xx' | '4xx' | '5xx' | 'other'>>(new Set());
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [selectedLogIds, setSelectedLogIds] = useState<Set<string>>(new Set());
  const [isNamingScenario, setIsNamingScenario] = useState(false);
  const [scenarioName, setScenarioName] = useState('');

  // Mocks tab state
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('default');
  const [selectedMockId, setSelectedMockId] = useState<string | null>(null);
  const [selectedSocketId, setSelectedSocketId] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    fileName: string;
    kind: 'project' | 'scenario';
    importedProject?: Project;
    importedScenario?: Scenario;
    summaryText: string;
  } | null>(null);
  const [harSkippedNote, setHarSkippedNote] = useState<string | null>(null);
  const [undoInfo, setUndoInfo] = useState<{
    project: Project;
    message: string;
  } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sampleTip, setSampleTip] = useState<string | null>(null);
  const sampleTipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSampleTip = useCallback(() => {
    if (sampleTipTimerRef.current) {
      clearTimeout(sampleTipTimerRef.current);
      sampleTipTimerRef.current = null;
    }
    setSampleTip(null);
  }, []);

  const showSampleTip = useCallback(() => {
    if (sampleTipTimerRef.current) {
      clearTimeout(sampleTipTimerRef.current);
    }
    setSampleTip(SAMPLE_TIP);
    sampleTipTimerRef.current = setTimeout(() => {
      setSampleTip(null);
      sampleTipTimerRef.current = null;
    }, 10000);
  }, []);

  useEffect(() => {
    if (!sampleTip) return;

    const onAction = () => {
      clearSampleTip();
    };

    const attachTimer = setTimeout(() => {
      window.addEventListener('click', onAction, { capture: true, once: true });
      window.addEventListener('keydown', onAction, { capture: true, once: true });
    }, 50);

    return () => {
      clearTimeout(attachTimer);
      window.removeEventListener('click', onAction, { capture: true });
      window.removeEventListener('keydown', onAction, { capture: true });
    };
  }, [sampleTip, clearSampleTip]);

  const triggerUndo = (snapshot: Project, message: string) => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setUndoInfo({ project: snapshot, message });
    undoTimerRef.current = setTimeout(() => {
      setUndoInfo(null);
      undoTimerRef.current = null;
    }, 10000);
  };

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
      }
      if (sampleTipTimerRef.current) {
        clearTimeout(sampleTipTimerRef.current);
      }
    };
  }, []);
  // applyTheme() (panel/main.tsx) sets the class; this follows it.
  const isDark = useIsDark();

  useEffect(() => {
    if (tabId <= 0 || typeof browser === 'undefined' || !browser.tabs?.get) return;

    const fetchTab = async () => {
      try {
        const tab = await browser.tabs.get(tabId);
        if (tab?.url) {
          setTabUrl(tab.url);
          try {
            setTabOrigin(new URL(tab.url).origin);
          } catch {}
        }
      } catch {}
    };

    fetchTab();

    const onUpdated = (updatedTabId: number, changeInfo: { url?: string }) => {
      if (updatedTabId === tabId && changeInfo.url) {
        setTabUrl(changeInfo.url);
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

  let tabHost = '';
  try {
    if (tabUrl) {
      tabHost = new URL(tabUrl).host;
    }
  } catch {}

  const currentSiteStatus = siteStatus(tabUrl, state?.enabledOrigins ?? [], enabled);

  const availableMethods = useMemo(() => {
    const methodSet = new Set<string>();
    for (const entry of entries) {
      if (entry.method.startsWith('WS')) {
        methodSet.add('WS');
      } else if (entry.method) {
        methodSet.add(entry.method);
      }
    }
    const standard = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'WS'];
    const list = Array.from(methodSet);
    list.sort((a, b) => {
      const ia = standard.indexOf(a);
      const ib = standard.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
    return list;
  }, [entries]);

  useEffect(() => {
    setSelectedMethods((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const m of prev) {
        if (availableMethods.includes(m)) {
          next.add(m);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [availableMethods]);

  const toggleType = (type: 'MOCK' | 'real' | 'LATE') => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const toggleMethod = (method: string) => {
    setSelectedMethods((prev) => {
      const next = new Set(prev);
      if (next.has(method)) next.delete(method);
      else next.add(method);
      return next;
    });
  };

  const toggleStatus = (status: '2xx' | '3xx' | '4xx' | '5xx' | 'other') => {
    setSelectedStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const handleClearFilters = () => {
    setFilter('');
    setSelectedTypes(new Set());
    setSelectedMethods(new Set());
    setSelectedStatuses(new Set());
  };

  const isFiltering =
    Boolean(filter) ||
    selectedTypes.size > 0 ||
    selectedMethods.size > 0 ||
    selectedStatuses.size > 0;

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (filter && !entry.url.toLowerCase().includes(filter.toLowerCase())) {
        return false;
      }
      if (selectedTypes.size > 0 && !selectedTypes.has(entry.badge)) {
        return false;
      }
      if (selectedMethods.size > 0) {
        const entryMethod = entry.method.startsWith('WS') ? 'WS' : entry.method;
        if (!selectedMethods.has(entryMethod)) {
          return false;
        }
      }
      if (selectedStatuses.size > 0) {
        let matched = false;
        for (const st of selectedStatuses) {
          if (st === '2xx' && entry.status >= 200 && entry.status <= 299) {
            matched = true;
            break;
          }
          if (st === '3xx' && entry.status >= 300 && entry.status <= 399) {
            matched = true;
            break;
          }
          if (st === '4xx' && entry.status >= 400 && entry.status <= 499) {
            matched = true;
            break;
          }
          if (st === '5xx' && entry.status >= 500 && entry.status <= 599) {
            matched = true;
            break;
          }
          if (st === 'other' && (entry.status < 200 || entry.status >= 600)) {
            matched = true;
            break;
          }
        }
        if (!matched) {
          return false;
        }
      }
      return true;
    });
  }, [entries, filter, selectedTypes, selectedMethods, selectedStatuses]);

  const handleReloadTab = () => {
    if (tabId <= 0 || typeof browser === 'undefined' || !browser.tabs?.reload) return;
    try {
      browser.tabs.reload(tabId).catch?.(() => {});
    } catch {}
  };

  const handleTurnOn = () => {
    update((s) => ({
      ...s,
      settings: { ...s.settings, enabled: true },
    })).catch(() => {});
  };

  const selectedEntry = entries.find((e) => e.id === selectedEntryId) ?? null;

  let answeredBy: { label: string; scenarioName: string } | 'deleted' | null = null;
  let handleOpenMockFromLog: (() => void) | undefined = undefined;

  if (selectedEntry?.badge === 'MOCK') {
    let foundMock: Mock | null = null;
    let foundSocket: SocketMock | null = null;
    let foundScenario: Scenario | null = null;

    if (project && selectedEntry.mockId) {
      for (const sc of project.scenarios) {
        const m = sc.mocks.find((item) => item.id === selectedEntry.mockId);
        if (m) {
          foundMock = m;
          foundScenario = sc;
          break;
        }
      }
      if (!foundMock) {
        for (const sc of project.scenarios) {
          const s = (sc.sockets ?? []).find((item) => item.id === selectedEntry.mockId);
          if (s) {
            foundSocket = s;
            foundScenario = sc;
            break;
          }
        }
      }
    }

    if (foundScenario && (foundMock || foundSocket)) {
      const target = (foundMock ?? foundSocket)!;
      const label = target.name?.trim() ? target.name : target.urlPattern;
      answeredBy = {
        label,
        scenarioName: foundScenario.name,
      };
      const scId = foundScenario.id;
      const mId = foundMock?.id ?? null;
      const sId = foundSocket?.id ?? null;
      handleOpenMockFromLog = () => {
        setActiveTab('mocks');
        setSelectedScenarioId(scId);
        setSelectedMockId(mId);
        setSelectedSocketId(sId);
      };
    } else {
      answeredBy = 'deleted';
    }
  }

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
    const mockId = newId();
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
      const mock = mockFromLog(entry, mockId, Date.now(), originToUse);

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

  const handleToggleSelectLog = (id: string) => {
    setSelectedLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleMockSelected = () => {
    if (selectedLogIds.size === 0) return;

    let originToUse = tabOrigin || project?.origins[0] || '';
    if (!originToUse) {
      for (const entry of entries) {
        if (selectedLogIds.has(entry.id)) {
          try {
            originToUse = new URL(entry.url).origin;
            if (originToUse) break;
          } catch {}
        }
      }
    }
    if (!originToUse) return;

    let addedCount = 0;
    let skippedCount = 0;
    const now = Date.now();
    const mocksToAdd: Mock[] = [];

    for (const entry of entries) {
      if (!selectedLogIds.has(entry.id)) continue;

      if (
        entry.badge === 'MOCK' ||
        entry.truncated ||
        !isValidStatus(entry.status) ||
        entry.method.startsWith('WS')
      ) {
        skippedCount++;
        continue;
      }

      try {
        const mock = mockFromLog(entry, newId(), now, originToUse);
        mocksToAdd.push(mock);
        addedCount++;
      } catch {
        skippedCount++;
      }
    }

    const currentProject = project;
    if (currentProject) {
      const msg = `${addedCount} mock${addedCount === 1 ? '' : 's'} added${
        skippedCount > 0 ? ` (${skippedCount} skipped)` : ''
      }`;
      triggerUndo(structuredClone(currentProject), msg);
    }

    setSelectedLogIds(new Set());

    update((s) => {
      const { state: nextState, project: targetProject } = ensureProject(s, originToUse, newId);
      if (!currentProject) {
        const msg = `${addedCount} mock${addedCount === 1 ? '' : 's'} added${
          skippedCount > 0 ? ` (${skippedCount} skipped)` : ''
        }`;
        triggerUndo(structuredClone(targetProject), msg);
      }
      const activeScenarioId = targetProject.activeScenarioId || targetProject.scenarios[0]?.id;
      const updatedProjects = nextState.projects.map((p) => {
        if (p.id !== targetProject.id) return p;
        return {
          ...p,
          scenarios: p.scenarios.map((sc) => {
            if (sc.id !== activeScenarioId) return sc;
            return {
              ...sc,
              mocks: [...sc.mocks, ...mocksToAdd],
            };
          }),
        };
      });

      return {
        ...nextState,
        projects: updatedProjects,
      };
    }).catch(() => {});
  };

  const handleMockSocket = (entry: LogEntry) => {
    if (!entry.connectionId) return;
    const connectionId = entry.connectionId;
    update((s) => {
      let originToUse = tabOrigin;
      if (!originToUse) {
        try {
          originToUse = new URL(entry.url.replace(/^ws/, 'http')).origin;
        } catch {
          originToUse = '';
        }
      }
      if (!originToUse) return s;
      const socket = socketFromLogs(entries, connectionId, originToUse, newId, Date.now());
      if (!socket) return s;
      const { state: nextState, project: targetProject } = ensureProject(s, originToUse, newId);
      return {
        ...nextState,
        projects: nextState.projects.map((p) => {
          if (p.id !== targetProject.id) return p;
          const activeScenarioId = p.activeScenarioId || p.scenarios[0]?.id;
          return {
            ...p,
            scenarios: p.scenarios.map((sc) =>
              sc.id === activeScenarioId ? { ...sc, sockets: [...(sc.sockets ?? []), socket] } : sc,
            ),
          };
        }),
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
      const newScenario = scenarioFromLogs(filteredEntries, trimmed, newId, Date.now(), originToUse);

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

  const handleExportScenario = (scenarioId: string) => {
    if (!project) return;
    const sc = project.scenarios.find((s) => s.id === scenarioId);
    if (!sc) return;
    const jsonText = exportScenario(sc);
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wemock-${sc.name}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleDuplicateScenario = (scenarioId: string) => {
    if (!project) return;
    const snapshot = structuredClone(project);
    const result = duplicateScenario(project, scenarioId, newId);
    if (!result.newId) return;
    update((s) => ({
      ...s,
      projects: s.projects.map((p) => (p.id === project.id ? result.project : p)),
    })).catch(() => {});
    triggerUndo(snapshot, 'Scenario duplicated');
  };

  const handleDuplicateMock = (mockId: string) => {
    if (!project) return;
    const sc =
      project.scenarios.find((s) => s.mocks.some((m) => m.id === mockId)) ??
      project.scenarios.find((s) => s.id === selectedScenarioId);
    if (!sc) return;
    const result = duplicateMock(project, sc.id, mockId, newId);
    if (!result.newId) return;
    update((s) => ({
      ...s,
      projects: s.projects.map((p) => (p.id === project.id ? result.project : p)),
    })).catch(() => {});
    setSelectedScenarioId(sc.id);
    setSelectedMockId(result.newId);
    setSelectedSocketId(null);
  };

  const handleDuplicateSocket = (socketId: string) => {
    if (!project) return;
    const sc =
      project.scenarios.find((s) => s.sockets?.some((m) => m.id === socketId)) ??
      project.scenarios.find((s) => s.id === selectedScenarioId);
    if (!sc) return;
    const result = duplicateSocket(project, sc.id, socketId, newId);
    if (!result.newId) return;
    update((s) => ({
      ...s,
      projects: s.projects.map((p) => (p.id === project.id ? result.project : p)),
    })).catch(() => {});
    setSelectedScenarioId(sc.id);
    setSelectedSocketId(result.newId);
    setSelectedMockId(null);
  };

  const handleSaveHar = () => {
    const { har, skippedSockets } = logToHar(filteredEntries);
    let host = tabHost;
    if (!host && tabOrigin) {
      try {
        host = new URL(tabOrigin).host;
      } catch {}
    }
    if (!host && filteredEntries.length > 0) {
      try {
        host = new URL(filteredEntries[0]!.url).host;
      } catch {}
    }
    const fileName = host ? `wemock-${host}.har` : 'wemock-log.har';
    const jsonText = JSON.stringify(har, null, 2);
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    if (skippedSockets > 0) {
      setHarSkippedNote(`${skippedSockets} socket row${skippedSockets === 1 ? '' : 's'} left out`);
    } else {
      setHarSkippedNote(null);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportSummary(null);
    setImportError(null);

    try {
      const text = await file.text();

      // Check if it's a wemock scenario file
      const scenarioResult = parseScenarioFile(text);
      if (scenarioResult.ok) {
        const sc = scenarioResult.scenario;
        if (!project) {
          const originToClaim = tabOrigin;
          const newP = newProject(newId(), originToClaim || 'http://localhost');
          newP.scenarios = [{ ...sc, id: newId() }];
          newP.activeScenarioId = newP.scenarios[0]!.id;
          await update((s) => ({
            ...s,
            projects: [...s.projects, newP],
          }));
          setSelectedProjectId(newP.id);
          setSelectedScenarioId(newP.scenarios[0]!.id);
          setSelectedMockId(null);
          setSelectedSocketId(null);
          setImportSummary(`Scenario ${sc.name} added`);
          return;
        }

        setPendingImport({
          fileName: file.name,
          kind: 'scenario',
          importedScenario: sc,
          summaryText: `Scenario ${sc.name} added`,
        });
        return;
      }

      let importedProject: Project | null = null;
      let summaryText = '';

      // Try parseProjectFile
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
        const parsed = parseSpecText(text);
        if (!parsed || typeof parsed !== 'object') {
          setImportError(
            'Unrecognized file format: expected wemock, HAR, OpenAPI, or Mokku',
          );
          setPendingImport(null);
          e.target.value = '';
          return;
        }

        if ('wemock' in parsed) {
          const err =
            (parsed as { wemock?: unknown }).wemock === 'scenario'
              ? scenarioResult.error
              : wemockResult.error;
          setImportError(err);
          setPendingImport(null);
          e.target.value = '';
          return;
        }

        if (detectHar(parsed)) {
          const originToUse = tabOrigin || project?.origins[0] || '';
          const harResult = importHar(parsed, file.name, originToUse, newId, Date.now());
          if (harResult.ok) {
            importedProject = harResult.result.project;
            summaryText = harSummaryText(harResult.result.summary);
          } else {
            setImportError(harResult.error);
            setPendingImport(null);
            e.target.value = '';
            return;
          }
        } else if (detectOpenApi(parsed)) {
          const originToUse = tabOrigin || project?.origins[0] || '';
          const openApiResult = importOpenApi(parsed, originToUse, newId, Date.now());
          if (openApiResult.ok) {
            importedProject = openApiResult.result.project;
            summaryText = openApiSummaryText(openApiResult.result.summary);
          } else {
            setImportError(openApiResult.error);
            setPendingImport(null);
            e.target.value = '';
            return;
          }
        } else {
          const mokkuResult = importMokku(parsed, tabOrigin, newId, Date.now());
          if (mokkuResult.ok) {
            importedProject = mokkuResult.result.project;
            summaryText = formatImportSummary(mokkuResult.result.summary);
          } else {
            setImportError(
              'Unrecognized file format: expected wemock, HAR, OpenAPI, or Mokku',
            );
            setPendingImport(null);
            e.target.value = '';
            return;
          }
        }
      }

      if (!importedProject) {
        e.target.value = '';
        return;
      }

      if (!project) {
        // When there is no current project at all, keep today's behaviour (create one) without asking.
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
        setSelectedSocketId(null);
        setImportSummary(summaryText);
        return;
      }

      // Success with existing project: store nothing yet, show import-choice bar
      setPendingImport({
        fileName: file.name,
        kind: 'project',
        importedProject,
        summaryText,
      });
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
      setPendingImport(null);
    } finally {
      e.target.value = '';
    }
  };

  const handleImportAdd = async () => {
    if (!project || !pendingImport) return;
    const snapshot = structuredClone(project);

    if (pendingImport.kind === 'scenario' && pendingImport.importedScenario) {
      const updated = addScenario(project, pendingImport.importedScenario, newId);
      const added = updated.scenarios[updated.scenarios.length - 1];
      const addedName = added?.name ?? pendingImport.importedScenario.name;
      setPendingImport(null);

      await update((s) => ({
        ...s,
        projects: s.projects.map((p) => (p.id === project.id ? updated : p)),
      }));

      setImportSummary(`Scenario ${addedName} added`);
      triggerUndo(snapshot, 'Import added');
      return;
    }

    if (pendingImport.importedProject) {
      const merged = mergeProject(project, pendingImport.importedProject, newId);
      const summary = pendingImport.summaryText;
      setPendingImport(null);

      await update((s) => ({
        ...s,
        projects: s.projects.map((p) => (p.id === project.id ? merged : p)),
      }));

      setImportSummary(summary);
      triggerUndo(snapshot, 'Import added');
    }
  };

  const handleImportReplace = async () => {
    if (!project || !pendingImport || !pendingImport.importedProject) return;
    const snapshot = structuredClone(project);
    const replaced = replaceProject(project, pendingImport.importedProject);
    const summary = pendingImport.summaryText;
    setPendingImport(null);

    await update((s) => ({
      ...s,
      projects: s.projects.map((p) => (p.id === project.id ? replaced : p)),
    }));

    setSelectedScenarioId(replaced.activeScenarioId || replaced.scenarios[0]?.id || 'default');
    setSelectedMockId(null);
    setSelectedSocketId(null);
    setImportSummary(summary);
    triggerUndo(snapshot, 'Import replaced your mocks');
  };

  const handleImportCancel = () => {
    setPendingImport(null);
  };

  const handleUndo = async () => {
    if (!undoInfo) return;
    const projectToRestore = undoInfo.project;
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setUndoInfo(null);
    clearSampleTip();
    await update((s) => ({
      ...s,
      projects: s.projects.map((p) =>
        p.id === projectToRestore.id ? projectToRestore : p,
      ),
    }));
    setSelectedScenarioId(
      projectToRestore.activeScenarioId || projectToRestore.scenarios[0]?.id || 'default',
    );
    setSelectedMockId(null);
    setSelectedSocketId(null);
  };

  const handleLoadSample = async () => {
    let currentProj = project;
    let baseState = state;
    if (!currentProj) {
      if (!baseState) return;
      const originToClaim = tabOrigin || 'http://localhost';
      const res = ensureProject(baseState, originToClaim, newId);
      currentProj = res.project;
      baseState = res.state;
    }
    const snapshot = structuredClone(currentProj);
    const sample = sampleProject();
    const merged = mergeProject(currentProj, sample, newId);

    await update((s) => {
      const exists = s.projects.some((p) => p.id === currentProj!.id);
      return {
        ...s,
        projects: exists
          ? s.projects.map((p) => (p.id === currentProj!.id ? merged : p))
          : [...s.projects, merged],
      };
    });

    triggerUndo(snapshot, 'Sample added');
    showSampleTip();
  };

  const handleClearAll = () => {
    if (!project) return;
    const snapshot = structuredClone(project);
    const updatedProject = clearProject(project);
    update((s) => ({
      ...s,
      projects: s.projects.map((p) => (p.id === project.id ? updatedProject : p)),
    })).catch(() => {});

    setSelectedScenarioId(updatedProject.scenarios[0]?.id ?? 'default');
    setSelectedMockId(null);
    setSelectedSocketId(null);
    triggerUndo(snapshot, 'All scenarios cleared');
  };

  const handleDeleteScenarios = (ids: string[]) => {
    if (!project) return;
    const snapshot = structuredClone(project);
    const updatedProject = deleteScenarios(project, ids);
    update((s) => ({
      ...s,
      projects: s.projects.map((p) => (p.id === project.id ? updatedProject : p)),
    })).catch(() => {});

    if (!updatedProject.scenarios.some((sc) => sc.id === selectedScenarioId)) {
      setSelectedScenarioId(updatedProject.scenarios[0]?.id ?? 'default');
      setSelectedMockId(null);
      setSelectedSocketId(null);
    }
    const count = ids.filter((id) =>
      project.scenarios.some((sc) => sc.id === id && sc.id !== project.scenarios[0]?.id),
    ).length;
    triggerUndo(snapshot, `${count} scenario${count === 1 ? '' : 's'} deleted`);
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
    const snapshot = structuredClone(project);
    const updatedProject = deleteScenarios(project, [scenarioId]);
    if (updatedProject.scenarios.length !== project.scenarios.length) {
      triggerUndo(snapshot, `Scenario "${project.scenarios.find((sc) => sc.id === scenarioId)?.name ?? ''}" deleted`);
    }
    update((s) => ({
      ...s,
      projects: s.projects.map((p) => (p.id === project.id ? updatedProject : p)),
    })).catch(() => {});
    if (!updatedProject.scenarios.some((sc) => sc.id === selectedScenarioId)) {
      setSelectedScenarioId(updatedProject.scenarios[0]?.id ?? 'default');
      setSelectedMockId(null);
      setSelectedSocketId(null);
    }
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
    setSelectedSocketId(null);
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
            // The row checkbox owns `enabled`; an editor draft opened earlier must not undo it.
            mocks: sc.mocks.map((m) => (m.id === savedMock.id ? { ...savedMock, enabled: m.enabled } : m)),
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

  const handleAddSocket = (scenarioId: string, newSocket: SocketMock) => {
    if (!project) return;
    update((s) => ({
      ...s,
      projects: s.projects.map((p) => {
        if (p.id !== project.id) return p;
        return {
          ...p,
          scenarios: p.scenarios.map((sc) =>
            sc.id === scenarioId
              ? { ...sc, sockets: [...(sc.sockets ?? []), newSocket] }
              : sc,
          ),
        };
      }),
    })).catch(() => {});
    setSelectedSocketId(newSocket.id);
    setSelectedMockId(null);
  };

  const handleSaveSocket = (savedSocket: SocketMock) => {
    if (!project) return;
    update((s) => ({
      ...s,
      projects: s.projects.map((p) => {
        if (p.id !== project.id) return p;
        return {
          ...p,
          scenarios: p.scenarios.map((sc) => ({
            ...sc,
            // The row checkbox owns `enabled`; an editor draft opened earlier must not undo it.
            sockets: (sc.sockets ?? []).map((s) =>
              s.id === savedSocket.id ? { ...savedSocket, enabled: s.enabled } : s,
            ),
          })),
        };
      }),
    })).catch(() => {});
  };

  const handleDeleteSocket = (socketId: string) => {
    if (!project) return;
    update((s) => ({
      ...s,
      projects: s.projects.map((p) => {
        if (p.id !== project.id) return p;
        return {
          ...p,
          scenarios: p.scenarios.map((sc) => ({
            ...sc,
            sockets: (sc.sockets ?? []).filter((s) => s.id !== socketId),
          })),
        };
      }),
    })).catch(() => {});
    setSelectedSocketId(null);
  };

  const handleUpdateScenarioSockets = (scenarioId: string, nextSockets: SocketMock[]) => {
    if (!project) return;
    update((s) => ({
      ...s,
      projects: s.projects.map((p) => {
        if (p.id !== project.id) return p;
        return {
          ...p,
          scenarios: p.scenarios.map((sc) =>
            sc.id === scenarioId ? { ...sc, sockets: nextSockets } : sc,
          ),
        };
      }),
    })).catch(() => {});
  };

  const handleUpdateHeaderRules = (rules: HeaderRule[]) => {
    if (!project) return;
    update((s) => ({
      ...s,
      projects: s.projects.map((p) => (p.id === project.id ? { ...p, headerRules: rules } : p)),
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

  // Find currently selected socket across all scenarios in project
  let selectedSocket: SocketMock | null = null;
  if (project && selectedSocketId) {
    for (const sc of project.scenarios) {
      const found = sc.sockets?.find((s) => s.id === selectedSocketId);
      if (found) {
        selectedSocket = found;
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
            setSelectedSocketId(null);
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

      {undoInfo && (
        <div data-testid="undo-bar" className="undo-bar">
          <span className="undo-bar-text">{undoInfo.message}</span>
          <button
            type="button"
            data-testid="undo"
            className="btn-secondary btn-sm"
            onClick={handleUndo}
          >
            Undo
          </button>
        </div>
      )}

      <PanelErrorBoundary hidden={activeTab !== 'log'}>
        <div
          className="panel-main-content"
          hidden={activeTab !== 'log'}
          style={{ display: activeTab === 'log' ? undefined : 'none' }}
        >
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
              <div className="log-filter-chips">
                <div className="log-chip-group" role="group" aria-label="Filter by type">
                  <button
                    type="button"
                    data-testid="log-chip-type-MOCK"
                    className={`log-filter-chip ${selectedTypes.has('MOCK') ? 'active' : ''}`}
                    aria-pressed={selectedTypes.has('MOCK') ? 'true' : 'false'}
                    onClick={() => toggleType('MOCK')}
                  >
                    MOCK
                  </button>
                  <button
                    type="button"
                    data-testid="log-chip-type-real"
                    className={`log-filter-chip ${selectedTypes.has('real') ? 'active' : ''}`}
                    aria-pressed={selectedTypes.has('real') ? 'true' : 'false'}
                    onClick={() => toggleType('real')}
                  >
                    real
                  </button>
                  <button
                    type="button"
                    data-testid="log-chip-type-LATE"
                    className={`log-filter-chip ${selectedTypes.has('LATE') ? 'active' : ''}`}
                    aria-pressed={selectedTypes.has('LATE') ? 'true' : 'false'}
                    onClick={() => toggleType('LATE')}
                  >
                    LATE
                  </button>
                </div>

                {availableMethods.length > 0 && (
                  <div className="log-chip-group" role="group" aria-label="Filter by method">
                    {availableMethods.map((m) => (
                      <button
                        key={m}
                        type="button"
                        data-testid={`log-chip-method-${m}`}
                        className={`log-filter-chip ${selectedMethods.has(m) ? 'active' : ''}`}
                        aria-pressed={selectedMethods.has(m) ? 'true' : 'false'}
                        onClick={() => toggleMethod(m)}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}

                <div className="log-chip-group" role="group" aria-label="Filter by status">
                  {(['2xx', '3xx', '4xx', '5xx', 'other'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      data-testid={`log-chip-status-${s}`}
                      className={`log-filter-chip ${selectedStatuses.has(s) ? 'active' : ''}`}
                      aria-pressed={selectedStatuses.has(s) ? 'true' : 'false'}
                      onClick={() => toggleStatus(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>

                {isFiltering && (
                  <div className="log-filter-feedback">
                    <span data-testid="log-filter-count" className="log-filter-count">
                      {filteredEntries.length} of {entries.length}
                    </span>
                    <button
                      type="button"
                      data-testid="log-filter-clear"
                      className="log-filter-clear-btn"
                      onClick={handleClearFilters}
                    >
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="toolbar-right">
              {selectedLogIds.size > 0 && (
                <button
                  type="button"
                  data-testid="log-mock-selected"
                  className="save-scenario-btn"
                  onClick={handleMockSelected}
                >
                  Mock selected ({selectedLogIds.size})
                </button>
              )}
              <button
                type="button"
                data-testid="log-save-har"
                className="save-scenario-btn"
                onClick={handleSaveHar}
              >
                Save HAR
              </button>
              {harSkippedNote && (
                <span data-testid="log-save-har-note" className="save-har-note">
                  {harSkippedNote}
                </span>
              )}
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
                totalCount={entries.length}
                siteStatus={currentSiteStatus}
                host={tabHost}
                onReload={handleReloadTab}
                onTurnOn={handleTurnOn}
                selectedEntryId={selectedEntryId}
                onSelectEntry={(entry) => setSelectedEntryId(entry.id)}
                selectedLogIds={selectedLogIds}
                onToggleSelect={handleToggleSelectLog}
              />
            </div>
            <div className="panel-split-right">
              <LogDetail
                entry={selectedEntry}
                onMockThis={handleMockThis}
                onMockSocket={handleMockSocket}
                onClose={() => setSelectedEntryId(null)}
                answeredBy={answeredBy}
                onOpenMock={handleOpenMockFromLog}
              />
            </div>
          </div>
        </div>
      </PanelErrorBoundary>

      <PanelErrorBoundary hidden={activeTab !== 'mocks'}>
        <div
          className="panel-main-content"
          hidden={activeTab !== 'mocks'}
          style={{ display: activeTab === 'mocks' ? undefined : 'none' }}
        >
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
                  accept=".json,.har,.yaml,.yml"
                  data-testid="import"
                  className="overlay-file-input"
                  onChange={handleImportFile}
                />
              </div>
              <button
                type="button"
                data-testid="sample-load-toolbar"
                className="btn-secondary"
                onClick={handleLoadSample}
              >
                Sample
              </button>
              <button
                type="button"
                data-testid="clear-all"
                className="btn-secondary"
                disabled={!project}
                onClick={handleClearAll}
              >
                Clear all
              </button>
            </div>

            <div className="mocks-toolbar-feedback">
              {sampleTip && (
                <div data-testid="sample-tip" className="sample-tip-text">
                  {sampleTip}
                </div>
              )}
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

          {pendingImport && (
            <div data-testid="import-choice" className="import-choice-bar">
              <span className="import-choice-text">Import {pendingImport.fileName}:</span>
              <button
                type="button"
                data-testid="import-add"
                className="btn-secondary btn-sm"
                onClick={handleImportAdd}
              >
                {pendingImport.kind === 'scenario' ? 'Add as a new scenario' : 'Add to my mocks'}
              </button>
              {pendingImport.kind !== 'scenario' && (
                <button
                  type="button"
                  data-testid="import-replace"
                  className="btn-secondary btn-sm"
                  onClick={handleImportReplace}
                >
                  Replace all
                </button>
              )}
              <button
                type="button"
                data-testid="import-cancel"
                className="btn-secondary btn-sm"
                onClick={handleImportCancel}
              >
                Cancel
              </button>
            </div>
          )}

          <TestBar
            project={project}
            pageOrigin={tabOrigin || project?.origins[0] || ''}
            onOpenMock={(scenarioId, mockId) => {
              setSelectedScenarioId(scenarioId);
              setSelectedMockId(mockId);
              setSelectedSocketId(null);
            }}
          />

          {project ? (
            <div className="panel-split-view">
              <div className="panel-split-left">
                <MockList
                  project={project}
                  selectedScenarioId={selectedScenarioId}
                  selectedMockId={selectedMockId}
                  selectedSocketId={selectedSocketId}
                  onSelectScenario={(scId) => setSelectedScenarioId(scId)}
                  onSelectMock={(mockId) => {
                    setSelectedMockId(mockId);
                    if (mockId !== null) setSelectedSocketId(null);
                  }}
                  onSelectSocket={(socketId) => {
                    setSelectedSocketId(socketId);
                    if (socketId !== null) setSelectedMockId(null);
                  }}
                  onUpdateScenarioMocks={handleUpdateScenarioMocks}
                  onUpdateScenarioSockets={handleUpdateScenarioSockets}
                  onAddScenario={handleAddScenario}
                  onRenameScenario={handleRenameScenario}
                  onDeleteScenario={handleDeleteScenario}
                  onDeleteScenarios={handleDeleteScenarios}
                  onDeleteAll={handleClearAll}
                  onAddMock={handleAddMock}
                  onAddSocket={handleAddSocket}
                  onUpdateHeaderRules={handleUpdateHeaderRules}
                  onDuplicateScenario={handleDuplicateScenario}
                  onExportScenario={handleExportScenario}
                  onLoadSample={handleLoadSample}
                />
              </div>
              <div className="panel-split-right">
                {selectedSocketId ? (
                  <SocketEditor
                    socket={selectedSocket}
                    isDark={isDark}
                    onSave={handleSaveSocket}
                    onDelete={handleDeleteSocket}
                    onDuplicate={handleDuplicateSocket}
                  />
                ) : (
                  <MockEditor
                    mock={selectedMock}
                    isDark={isDark}
                    pageOrigin={tabOrigin || project?.origins[0] || ''}
                    projectId={project?.id}
                    onSave={handleSaveMock}
                    onDelete={handleDeleteMock}
                    onDuplicate={handleDuplicateMock}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="mock-editor-empty">
              <p>No project loaded for this site</p>
            </div>
          )}
        </div>
      </PanelErrorBoundary>
    </div>
  );
}
