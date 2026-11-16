import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsDark } from '../../ui/useIsDark';
import { exportProject, exportScenario, parseProjectFile, parseScenarioFile } from '../../core/exportFile';
import { logToHar } from '../../core/harExport';
import { detectHar, harSummaryText, importHar } from '../../core/harImport';
import { importMockFile } from '../../core/mockFileImport';
import { detectOpenApi, importOpenApi, openApiSummaryText, parseSpecText } from '../../core/openapiImport';
import { ensureProject, mockFromLog, scenarioFromLogs } from '../../core/record';
import { sampleProject } from '../../core/sample';
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
import { TopBar } from '../../ui/TopBar';
import { ImportDialog, type PendingImport } from '../../ui/ImportDialog';
import { notify, ToastContainer } from '../../ui/Toasts';
import { LogIcon, MocksIcon } from '../../ui/icons';
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
  // The note under Save as HAR in the Log: what the saved file left out.
  const [harSkippedNote, setHarSkippedNote] = useState<string | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);

  const triggerUndo = (snapshot: Project, message: string, testId?: string) => {
    notify(message, {
      undo: () => {
        update((s) => ({
          ...s,
          projects: s.projects.map((p) => (p.id === snapshot.id ? snapshot : p)),
        })).catch(() => {});
        setSelectedScenarioId(
          snapshot.activeScenarioId || snapshot.scenarios[0]?.id || 'default',
        );
        setSelectedMockId(null);
        setSelectedSocketId(null);
      },
      testId,
    });
  };
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
    notify(state?.settings.recording ? 'Recording paused' : 'Recording calls');
    update((s) => ({
      ...s,
      settings: { ...s.settings, recording: !s.settings.recording },
    })).catch(() => {});
  };

  const handleToggleEnabled = () => {
    notify(state?.settings.enabled ? 'Mocking off: every call goes to the server' : 'Mocking on: mocks answer again');
    update((s) => ({
      ...s,
      settings: { ...s.settings, enabled: !s.settings.enabled },
    })).catch(() => {});
  };

  const handleToggleConsoleLog = () => {
    notify(state?.settings.consoleLog === false ? 'Mocked calls now show in the Console' : 'Console lines off');
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
    const into = project?.scenarios.find((s) => s.id === project.activeScenarioId) ?? project?.scenarios[0];
    notify(`Mock added to ${into?.name ?? 'Default'}`);
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
    const fileName = `wemock-${project.name}.json`;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(`Saved ${fileName}`);
  };

  const handleExportScenario = (scenarioId: string) => {
    if (!project) return;
    const sc = project.scenarios.find((s) => s.id === scenarioId) || project.scenarios[0];
    if (!sc) return;
    const jsonText = exportScenario(sc);
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fileName = `wemock-${sc.name}.json`;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(`Saved ${fileName}`);
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
    const copy = result.project.scenarios.flatMap((s) => s.mocks).find((m) => m.id === result.newId);
    notify(`Mock duplicated: ${copy?.name || copy?.urlPattern || 'copy'}`);
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
    const copy = result.project.scenarios.flatMap((s) => s.sockets ?? []).find((x) => x.id === result.newId);
    notify(`Socket mock duplicated: ${copy?.name || copy?.urlPattern || 'copy'}`);
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

  const handleImportAdd = async (pending: PendingImport) => {
    if (!project) return;
    const snapshot = structuredClone(project);

    if (pending.kind === 'scenario' && pending.importedScenario) {
      const updated = addScenario(project, pending.importedScenario, newId);
      const added = updated.scenarios[updated.scenarios.length - 1];
      const addedName = added?.name ?? pending.importedScenario.name;

      await update((s) => ({
        ...s,
        projects: s.projects.map((p) => (p.id === project.id ? updated : p)),
      }));

      triggerUndo(snapshot, `Scenario ${addedName} added`, 'import-summary');
      return;
    }

    if (pending.importedProject) {
      const merged = mergeProject(project, pending.importedProject, newId);
      const summary = pending.summaryText;

      await update((s) => ({
        ...s,
        projects: s.projects.map((p) => (p.id === project.id ? merged : p)),
      }));

      triggerUndo(snapshot, summary, 'import-summary');
    }
  };

  const handleImportReplace = async (pending: PendingImport) => {
    if (!project || !pending.importedProject) return;
    const snapshot = structuredClone(project);
    const replaced = replaceProject(project, pending.importedProject);
    const summary = pending.summaryText;

    await update((s) => ({
      ...s,
      projects: s.projects.map((p) => (p.id === project.id ? replaced : p)),
    }));

    setSelectedScenarioId(replaced.activeScenarioId || replaced.scenarios[0]?.id || 'default');
    setSelectedMockId(null);
    setSelectedSocketId(null);
    triggerUndo(snapshot, summary, 'import-summary');
  };

  const handleCreateProjectFromImport = async (pending: PendingImport) => {
    const originToClaim = tabOrigin;
    if (pending.kind === 'scenario' && pending.importedScenario) {
      const newP = newProject(newId(), originToClaim || 'http://localhost');
      newP.scenarios = [{ ...pending.importedScenario, id: newId() }];
      newP.activeScenarioId = newP.scenarios[0]!.id;
      await update((s) => ({
        ...s,
        projects: [...s.projects, newP],
      }));
      setSelectedProjectId(newP.id);
      setSelectedScenarioId(newP.scenarios[0]!.id);
      setSelectedMockId(null);
      setSelectedSocketId(null);
      notify(`Scenario ${pending.importedScenario.name} added`);
      return;
    }

    if (pending.importedProject) {
      const projectToInsert: Project = {
        ...pending.importedProject,
        origins: originToClaim ? [originToClaim] : pending.importedProject.origins,
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
      notify(pending.summaryText);
    }
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

    triggerUndo(snapshot, `Sample loaded: a small shop with ${sample.scenarios.length} scenarios`);
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
    triggerUndo(snapshot, 'Deleted all scenarios and mocks');
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
    notify(`Renamed to ${newName}`);
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
    freshIdsRef.current.add(newMock.id);
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
    notifySaved(savedMock.id, savedMock.name || savedMock.urlPattern, 'Mock');
    update((s) => ({
      ...s,
      projects: s.projects.map((p) => {
        if (p.id !== project.id) return p;
        return {
          ...p,
          scenarios: p.scenarios.map((sc) => ({
            ...sc,
            // The editor's switch saves `enabled` at once; an older draft must not undo it.
            mocks: sc.mocks.map((m) => (m.id === savedMock.id ? { ...savedMock, enabled: m.enabled } : m)),
          })),
        };
      }),
    })).catch(() => {});
  };

  // Mocks made with + New mock in this panel and not yet saved: their first Save says where they went.
  const freshIdsRef = useRef<Set<string>>(new Set());
  const notifySaved = (id: string, name: string, noun: string) => {
    if (freshIdsRef.current.delete(id)) {
      const into = project?.scenarios.find((s) => s.mocks.some((m) => m.id === id) || (s.sockets ?? []).some((x) => x.id === id));
      notify(`${noun} added to ${into?.name ?? 'Default'}`);
    } else {
      notify(`Saved ${name}`);
    }
  };

  /** Makes a scenario the one that answers, over Default, and says so. */
  const handleActivateScenario = (scenarioId: string) => {
    const sc = project?.scenarios.find((s) => s.id === scenarioId);
    if (!sc) return;
    handlePickScenario(scenarioId);
    notify(`${sc.name} is active`);
  };

  /** Default's bin: every mock and socket mock in the scenario goes; the scenario stays. */
  const handleClearScenario = (scenarioId: string) => {
    if (!project) return;
    const sc = project.scenarios.find((s) => s.id === scenarioId);
    if (!sc) return;
    const count = sc.mocks.length + (sc.sockets?.length ?? 0);
    const snapshot = structuredClone(project);
    update((s) => ({
      ...s,
      projects: s.projects.map((p) =>
        p.id !== project.id
          ? p
          : { ...p, scenarios: p.scenarios.map((x) => (x.id === scenarioId ? { ...x, mocks: [], sockets: [] } : x)) },
      ),
    })).catch(() => {});
    if (selectedScenarioId === scenarioId) {
      setSelectedMockId(null);
      setSelectedSocketId(null);
    }
    triggerUndo(snapshot, `Deleted ${count} ${count === 1 ? 'mock' : 'mocks'} from ${sc.name}`);
  };

  /** The editor's switch: saved at once, as the row checkbox used to be. */
  const handleSetMockEnabled = (mockId: string, enabled: boolean) => {
    if (!project) return;
    const mock = project.scenarios.flatMap((s) => s.mocks).find((m) => m.id === mockId);
    update((s) => ({
      ...s,
      projects: s.projects.map((p) =>
        p.id !== project.id
          ? p
          : { ...p, scenarios: p.scenarios.map((sc) => ({ ...sc, mocks: sc.mocks.map((m) => (m.id === mockId ? { ...m, enabled } : m)) })) },
      ),
    })).catch(() => {});
    const name = mock?.name || mock?.urlPattern || 'The mock';
    notify(enabled ? `${name} is on` : `${name} is off: calls skip it`);
  };

  const handleSetSocketEnabled = (socketId: string, enabled: boolean) => {
    if (!project) return;
    const socket = project.scenarios.flatMap((s) => s.sockets ?? []).find((x) => x.id === socketId);
    update((s) => ({
      ...s,
      projects: s.projects.map((p) =>
        p.id !== project.id
          ? p
          : {
              ...p,
              scenarios: p.scenarios.map((sc) => ({
                ...sc,
                sockets: (sc.sockets ?? []).map((x) => (x.id === socketId ? { ...x, enabled } : x)),
              })),
            },
      ),
    })).catch(() => {});
    const name = socket?.name || socket?.urlPattern || 'The socket mock';
    notify(enabled ? `${name} is on` : `${name} is off: the page gets the real socket`);
  };

  const handleDeleteMock = (mockId: string) => {
    if (!project) return;
    const deleted = project.scenarios.flatMap((s) => s.mocks).find((m) => m.id === mockId);
    if (deleted) triggerUndo(structuredClone(project), `Deleted mock ${deleted.name || deleted.urlPattern}`);
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
    freshIdsRef.current.add(newSocket.id);
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
    notifySaved(savedSocket.id, savedSocket.name || savedSocket.urlPattern, 'Socket mock');
    update((s) => ({
      ...s,
      projects: s.projects.map((p) => {
        if (p.id !== project.id) return p;
        return {
          ...p,
          scenarios: p.scenarios.map((sc) => ({
            ...sc,
            // The editor's switch saves `enabled` at once; an older draft must not undo it.
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
    const deleted = project.scenarios.flatMap((s) => s.sockets ?? []).find((x) => x.id === socketId);
    if (deleted) triggerUndo(structuredClone(project), `Deleted socket mock ${deleted.name || deleted.urlPattern}`);
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

  const totalMocks = project
    ? project.scenarios.reduce(
        (sum, s) => sum + s.mocks.length + (s.sockets?.length ?? 0),
        0,
      )
    : 0;

  return (
    <div className="panel-container wm">
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
        onImportOpen={() => setIsImportOpen(true)}
        onExportProject={handleExport}
        onExportActiveScenario={() => {
          const scId = project?.activeScenarioId || project?.scenarios[0]?.id || 'default';
          handleExportScenario(scId);
        }}
        onLoadSample={handleLoadSample}
      />

      <div className="body panel-body">
        <nav className="rail" aria-label="Views">
          <button
            type="button"
            data-testid="tab-log"
            className={`rail-btn tab-btn ${activeTab === 'log' ? 'active' : ''}`}
            aria-current={activeTab === 'log' ? 'page' : undefined}
            onClick={() => setActiveTab('log')}
          >
            <LogIcon size={20} className="ico" />
            <span className="txt">Log</span>
            <span className="count" data-testid="tab-log-count">{entries.length}</span>
          </button>
          <button
            type="button"
            data-testid="tab-mocks"
            className={`rail-btn tab-btn ${activeTab === 'mocks' ? 'active' : ''}`}
            aria-current={activeTab === 'mocks' ? 'page' : undefined}
            onClick={() => setActiveTab('mocks')}
          >
            <MocksIcon size={20} className="ico" />
            <span className="txt">Mocks</span>
            <span className="count" data-testid="tab-mocks-count">{totalMocks}</span>
          </button>
        </nav>

        <main className="main panel-main-area">
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
          {project ? (
            <div className="panel-split-view">
              <div className="panel-split-left">
                <MockList
                  project={project}
                  selectedScenarioId={selectedScenarioId}
                  selectedMockId={selectedMockId}
                  selectedSocketId={selectedSocketId}
                  onSelectScenario={(scId) => setSelectedScenarioId(scId)}
                  onActivateScenario={handleActivateScenario}
                  onClearScenario={handleClearScenario}
                  onDeleteMock={handleDeleteMock}
                  onDeleteSocket={handleDeleteSocket}
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
                    onBack={() => setSelectedSocketId(null)}
                    onToggleEnabled={(enabled) => selectedSocket && handleSetSocketEnabled(selectedSocket.id, enabled)}
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
                    onBack={() => setSelectedMockId(null)}
                    onToggleEnabled={(enabled) => selectedMock && handleSetMockEnabled(selectedMock.id, enabled)}
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
        </main>
      </div>

      <ToastContainer />

      <ImportDialog
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        project={project}
        tabOrigin={tabOrigin}
        onImportAdd={handleImportAdd}
        onImportReplace={handleImportReplace}
        onCreateProjectFromImport={handleCreateProjectFromImport}
      />
    </div>
  );
}
