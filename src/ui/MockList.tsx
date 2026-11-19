import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { forbiddenHeaderReason } from '../core/headerRules';
import { compilePattern } from '../core/match';
import { unreachableMocks } from '../core/reachability';
import type { HeaderRule, HttpMethod, Mock, Project, SocketMock } from '../core/types';
import { newId } from '../shared/ids';
import { ConfirmDialog } from './ConfirmDialog';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  ExportIcon,
  PencilIcon,
  PlusIcon,
  ScenarioIcon,
  SocketIcon,
  TrashIcon,
} from './icons';

export interface MockListProps {
  project: Project;
  selectedScenarioId: string;
  selectedMockId: string | null;
  selectedSocketId: string | null;
  onSelectScenario: (scenarioId: string) => void;
  /** Makes the scenario the one that answers, over Default. */
  onActivateScenario: (scenarioId: string) => void;
  onSelectMock: (mockId: string | null) => void;
  onSelectSocket: (socketId: string | null) => void;
  onUpdateScenarioMocks: (scenarioId: string, mocks: Mock[]) => void;
  onUpdateScenarioSockets: (scenarioId: string, sockets: SocketMock[]) => void;
  onUpdateHeaderRules?: (rules: HeaderRule[]) => void;
  onAddScenario: (name: string) => void;
  onRenameScenario: (scenarioId: string, newName: string) => void;
  onDeleteScenario: (scenarioId: string) => void;
  /** Empties a scenario and keeps it: Default's bin. */
  onClearScenario: (scenarioId: string) => void;
  onDeleteAll: () => void;
  onAddMock: (scenarioId: string, mock: Mock) => void;
  onAddSocket: (scenarioId: string, socket: SocketMock) => void;
  onDeleteMock: (mockId: string) => void;
  onDeleteSocket: (socketId: string) => void;
  onDuplicateScenario?: (scenarioId: string) => void;
  onExportScenario?: (scenarioId: string) => void;
  onLoadSample?: () => void;
  /** Bumped to bring the selected row into view again, even when the selection did not change. */
  revealRequest?: number;
}

const STICKY_HEADER_PX = 40;

function loadFoldedIds(projectId: string): string[] {
  try {
    const raw = localStorage.getItem(`wemock.folded.${projectId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((id): id is string => typeof id === 'string');
      }
    }
  } catch {
    // ignore
  }
  return [];
}

function saveFoldedIds(projectId: string, foldedIds: string[]): void {
  try {
    localStorage.setItem(`wemock.folded.${projectId}`, JSON.stringify(foldedIds));
  } catch {
    // ignore
  }
}

function mockMatches(mock: Mock, query: string): boolean {
  if (!query) return true;
  return Boolean(
    (mock.name && mock.name.toLowerCase().includes(query)) ||
    (mock.urlPattern && mock.urlPattern.toLowerCase().includes(query)) ||
    (mock.method && mock.method.toLowerCase().includes(query)),
  );
}

function socketMatches(socket: SocketMock, query: string): boolean {
  if (!query) return true;
  return Boolean(
    (socket.name && socket.name.toLowerCase().includes(query)) ||
    (socket.urlPattern && socket.urlPattern.toLowerCase().includes(query)),
  );
}

function getRuleError(rule: HeaderRule): string | null {
  const forbidden = forbiddenHeaderReason(rule.name);
  if (forbidden !== null) return forbidden;
  const compiled = compilePattern(rule.urlPattern);
  if (!compiled.ok) return compiled.error;
  return null;
}

/** Keys and clicks on these never make a header active or open a row: they do their own job. */
function isControl(target: EventTarget | null): boolean {
  return (target as HTMLElement | null)?.closest('button, input, select, textarea') != null;
}


/** What a row can do. One object for the whole list, so a row never re-renders for a new handler. */
interface RowActions {
  open: (scenarioId: string, mockId: string) => void;
  remove: (mockId: string) => void;
  move: (scenarioId: string, fromIndex: number, delta: number) => void;
  dragStart: (e: React.DragEvent, scenarioId: string, index: number) => void;
  drop: (e: React.DragEvent, scenarioId: string, index: number) => void;
}

interface MockRowProps {
  mock: Mock;
  scenarioId: string;
  index: number;
  isLast: boolean;
  isSelected: boolean;
  isFlash: boolean;
  unreachableReason: string | undefined;
  isFilterActive: boolean;
  actions: RowActions;
}

/**
 * One mock row. Memoized: with hundreds of mocks, a key typed anywhere in the panel re-renders the
 * list, and a row redraws only when its own mock or state changed.
 */
const MockRow = memo(function MockRow({
  mock,
  scenarioId,
  index,
  isLast,
  isSelected,
  isFlash,
  unreachableReason,
  isFilterActive,
  actions,
}: Readonly<MockRowProps>) {
  const status = mock.response.status;
  const label = mock.name || mock.urlPattern;
  return (
    <div
      data-row-id={mock.id}
      data-testid="mock-row"
      tabIndex={0}
      aria-selected={isSelected ? 'true' : undefined}
      className={`mock-row ${isSelected ? 'selected' : ''} ${!mock.enabled ? 'disabled off' : ''} ${isFlash ? 'flash' : ''}`}
      draggable={!isFilterActive}
      onDragStart={(e) => actions.dragStart(e, scenarioId, index)}
      onDragOver={(e) => {
        if (isFilterActive) return;
        e.preventDefault();
      }}
      onDrop={(e) => actions.drop(e, scenarioId, index)}
      onClick={(e) => {
        if (isControl(e.target)) return;
        actions.open(scenarioId, mock.id);
      }}
      onKeyDown={(e) => {
        if (isControl(e.target)) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          actions.open(scenarioId, mock.id);
        }
      }}
    >
      <span className={`method-tag meth method-${mock.method.toLowerCase()}`}>{mock.method}</span>
      <span className="mock-name-or-pattern" title={mock.urlPattern}>
        {mock.urlPattern}
        {mock.name && <span className="nm">{mock.name}</span>}
      </span>
      {mock.reply === 'code' && (
        <span className="code-chip" data-testid="code-chip" title="Answers with code">
          code
        </span>
      )}
      {unreachableReason && (
        <span data-testid="mock-unreachable" className="mock-unreachable" title={unreachableReason}>
          Never answers
        </span>
      )}
      {!mock.enabled && <span className="offtag">off</span>}
      <button
        type="button"
        data-testid="mock-row-delete"
        className="ibtn sm red row-del"
        aria-label={`Delete ${label}`}
        title="Delete mock"
        onClick={() => actions.remove(mock.id)}
      >
        <TrashIcon size={14} />
      </button>
      <span data-testid="mock-status" className={`mock-status st${String(status)[0]}`}>
        {status}
      </span>
      <span className="updown">
        <button
          type="button"
          data-testid="mock-up"
          className="ibtn mock-up-btn"
          disabled={isFilterActive || index === 0}
          onClick={() => actions.move(scenarioId, index, -1)}
          title="Move up"
          aria-label={`Move ${label} up`}
        >
          <ChevronUpIcon size={12} />
        </button>
        <button
          type="button"
          data-testid="mock-down"
          className="ibtn mock-down-btn"
          disabled={isFilterActive || isLast}
          onClick={() => actions.move(scenarioId, index, 1)}
          title="Move down"
          aria-label={`Move ${label} down`}
        >
          <ChevronDownIcon size={12} />
        </button>
      </span>
    </div>
  );
});

export function MockList({
  project,
  selectedMockId,
  selectedSocketId,
  onSelectScenario,
  onActivateScenario,
  onSelectMock,
  onSelectSocket,
  onUpdateScenarioMocks,
  onUpdateHeaderRules,
  onAddScenario,
  onRenameScenario,
  onDeleteScenario,
  onClearScenario,
  onDeleteAll,
  onAddMock,
  onAddSocket,
  onDeleteMock,
  onDeleteSocket,
  onDuplicateScenario,
  onExportScenario,
  onLoadSample,
  revealRequest,
}: MockListProps) {
  const [scenarios, setScenarios] = useState(project.scenarios);
  const [filterText, setFilterText] = useState('');
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  // The row just moved up or down flashes once, in place of a message.
  const [flashId, setFlashId] = useState<string | null>(null);
  const [foldedIds, setFoldedIds] = useState<string[]>(() => loadFoldedIds(project.id));
  const [revealId, setRevealId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [headerRules, setHeaderRules] = useState<HeaderRule[]>(() => project.headerRules ?? []);
  // The rule lists this panel saved and has not yet seen come back. A typed rule saves on every key;
  // if the echo of an older save arrived after a newer key and reset the list, the next key would
  // save on top of the older list and lose what was typed in between.
  const sentRulesRef = useRef<{ pending: Set<string>; last: string | null }>({ pending: new Set(), last: null });
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  // Set when New scenario is chosen: the next scenario to appear opens for naming.
  const knownIdsRef = useRef<string[] | null>(null);

  useEffect(() => {
    setScenarios(project.scenarios);
    const incoming = project.headerRules ?? [];
    const key = JSON.stringify(incoming);
    const sent = sentRulesRef.current;
    if (sent.pending.has(key)) {
      // This panel's own save coming back: the list on screen is already as new, or newer.
      if (key === sent.last) {
        sent.pending.clear();
        sent.last = null;
      }
    } else {
      // A change from elsewhere (Import, Undo, another panel): show it.
      sent.pending.clear();
      sent.last = null;
      setHeaderRules(incoming);
    }
    const known = knownIdsRef.current;
    if (known) {
      const added = project.scenarios.find((s) => !known.includes(s.id));
      if (added) {
        knownIdsRef.current = null;
        setRenamingId(added.id);
        setRenameText(added.name);
      }
    }
  }, [project.scenarios, project.headerRules]);

  useEffect(() => {
    setFoldedIds(loadFoldedIds(project.id));
    setFilterText('');
  }, [project.id]);

  useEffect(() => {
    if (!isAddMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsAddMenuOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) setIsAddMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onClick);
    };
  }, [isAddMenuOpen]);

  const flashRow = (rowId: string) => {
    setFlashId(rowId);
    setTimeout(() => setFlashId((id) => (id === rowId ? null : id)), 700);
  };

  const selectedId = selectedMockId ?? selectedSocketId;

  useEffect(() => {
    if (!selectedId) return;
    const owner = scenarios.find(
      (s) => s.mocks.some((m) => m.id === selectedId) || (s.sockets ?? []).some((so) => so.id === selectedId),
    );
    if (!owner) return;
    if (foldedIds.includes(owner.id)) {
      const next = foldedIds.filter((id) => id !== owner.id);
      setFoldedIds(next);
      saveFoldedIds(project.id, next);
    }
    setRevealId(selectedId);
  }, [selectedId, revealRequest]);

  useEffect(() => {
    const list = listRef.current;
    if (!revealId || !list) return;
    setRevealId(null);
    const row = list.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(revealId)}"]`);
    if (!row) return;
    const rowBox = row.getBoundingClientRect();
    const listBox = list.getBoundingClientRect();
    if (rowBox.top >= listBox.top + STICKY_HEADER_PX && rowBox.bottom <= listBox.bottom) return;
    row.scrollIntoView({ block: 'center' });
    flashRow(revealId);
  }, [revealId, foldedIds]);

  const handleToggleFold = (scenarioId: string) => {
    setFoldedIds((prev) => {
      const next = prev.includes(scenarioId)
        ? prev.filter((id) => id !== scenarioId)
        : [...prev, scenarioId];
      saveFoldedIds(project.id, next);
      return next;
    });
  };

  // The "never answers" check compares every pair of mocks. Work it out only when a scenario's mocks
  // change, not on every render: the panel renders on each key typed anywhere in it.
  const unreachableByScenario = useMemo(
    () => new Map(scenarios.map((sc) => [sc.id, unreachableMocks(sc.mocks)])),
    [scenarios],
  );

  const activeScenario =
    scenarios.find((s) => s.id === project.activeScenarioId) ?? scenarios[0];

  const deferredFilter = useDeferredValue(filterText);
  const trimmedFilter = deferredFilter.trim().toLowerCase();
  const isFilterActive = trimmedFilter.length > 0;

  const totalItems = scenarios.reduce(
    (sum, sc) => sum + sc.mocks.length + (sc.sockets?.length ?? 0),
    0,
  );

  const matchingCount = isFilterActive
    ? scenarios.reduce((sum, sc) => {
        const matchMocks = sc.mocks.filter((m) => mockMatches(m, trimmedFilter)).length;
        const matchSockets = (sc.sockets ?? []).filter((s) => socketMatches(s, trimmedFilter)).length;
        return sum + matchMocks + matchSockets;
      }, 0)
    : totalItems;

  const startRename = (scenarioId: string, name: string) => {
    setRenamingId(scenarioId);
    setRenameText(name);
  };

  const finishRename = (save: boolean) => {
    const trimmed = renameText.trim();
    const before = scenarios.find((s) => s.id === renamingId)?.name;
    if (save && renamingId && trimmed && trimmed !== before) onRenameScenario(renamingId, trimmed);
    setRenamingId(null);
    setRenameText('');
  };

  const handleNewScenario = () => {
    knownIdsRef.current = scenarios.map((s) => s.id);
    onAddScenario(`Scenario ${scenarios.length + 1}`);
  };

  const handleNewMock = () => {
    if (!activeScenario) return;
    const manualMock: Mock = {
      id: newId(),
      enabled: true,
      method: 'GET',
      urlPattern: '/',
      response: {
        status: 200,
        headers: {},
        body: '',
        bodyEncoding: 'text',
        delayMs: 0,
      },
      templates: true,
      source: 'manual',
      createdAt: Date.now(),
    };
    onSelectScenario(activeScenario.id);
    onAddMock(activeScenario.id, manualMock);
  };

  const handleNewSocket = () => {
    if (!activeScenario) return;
    const socket: SocketMock = {
      id: newId(),
      enabled: true,
      kind: 'signalr',
      urlPattern: '/hub',
      onConnect: [],
      replies: [],
      createdAt: Date.now(),
    };
    onSelectScenario(activeScenario.id);
    onAddSocket(activeScenario.id, socket);
  };

  const handleMoveMock = (scenarioId: string, fromIndex: number, delta: number) => {
    if (isFilterActive) return;
    const sc = scenarios.find((s) => s.id === scenarioId);
    if (!sc) return;
    const toIndex = fromIndex + delta;
    if (toIndex < 0 || toIndex >= sc.mocks.length) return;

    const nextMocks = [...sc.mocks];
    const [moved] = nextMocks.splice(fromIndex, 1);
    if (!moved) return;
    nextMocks.splice(toIndex, 0, moved);

    setScenarios((prev) =>
      prev.map((s) => (s.id === scenarioId ? { ...s, mocks: nextMocks } : s)),
    );
    onUpdateScenarioMocks(scenarioId, nextMocks);
    flashRow(moved.id);
  };

  const handleDragStart = (e: React.DragEvent, scenarioId: string, index: number) => {
    if (isFilterActive) return;
    e.dataTransfer.setData('text/plain', JSON.stringify({ scenarioId, index }));
  };

  const handleDrop = (e: React.DragEvent, toScenarioId: string, toIndex: number) => {
    e.preventDefault();
    if (isFilterActive) return;
    try {
      const raw = e.dataTransfer.getData('text/plain');
      const { scenarioId: fromScenarioId, index: fromIndex } = JSON.parse(raw);
      if (fromScenarioId !== toScenarioId || fromIndex === toIndex) return;

      const sc = scenarios.find((s) => s.id === toScenarioId);
      if (!sc) return;

      const nextMocks = [...sc.mocks];
      const [moved] = nextMocks.splice(fromIndex, 1);
      if (!moved) return;
      nextMocks.splice(toIndex, 0, moved);

      setScenarios((prev) =>
        prev.map((s) => (s.id === toScenarioId ? { ...s, mocks: nextMocks } : s)),
      );
      onUpdateScenarioMocks(toScenarioId, nextMocks);
    } catch {}
  };

  const saveRules = (nextRules: HeaderRule[]) => {
    const key = JSON.stringify(nextRules);
    sentRulesRef.current.pending.add(key);
    sentRulesRef.current.last = key;
    setHeaderRules(nextRules);
    onUpdateHeaderRules?.(nextRules);
  };

  const handleAddRule = () => {
    const newRule: HeaderRule = {
      id: newId(),
      enabled: true,
      method: 'ANY',
      urlPattern: '',
      name: '',
      value: '',
    };
    const nextRules = [...headerRules, newRule];
    saveRules(nextRules);
  };

  const handleUpdateRule = (ruleId: string, patch: Partial<HeaderRule>) => {
    const nextRules = headerRules.map((r) =>
      r.id === ruleId ? { ...r, ...patch } : r,
    );
    saveRules(nextRules);
  };

  const handleRemoveRule = (ruleId: string) => {
    const nextRules = headerRules.filter((r) => r.id !== ruleId);
    saveRules(nextRules);
  };

  const latest = useRef({ handleMoveMock, handleDragStart, handleDrop, onSelectScenario, onSelectMock, onSelectSocket, onDeleteMock });
  latest.current = { handleMoveMock, handleDragStart, handleDrop, onSelectScenario, onSelectMock, onSelectSocket, onDeleteMock };
  const rowActions = useMemo<RowActions>(
    () => ({
      open: (scenarioId, mockId) => {
        const l = latest.current;
        l.onSelectScenario(scenarioId);
        l.onSelectMock(mockId);
        l.onSelectSocket(null);
      },
      remove: (mockId) => latest.current.onDeleteMock(mockId),
      move: (scenarioId, fromIndex, delta) => latest.current.handleMoveMock(scenarioId, fromIndex, delta),
      dragStart: (e, scenarioId, index) => latest.current.handleDragStart(e, scenarioId, index),
      drop: (e, scenarioId, index) => latest.current.handleDrop(e, scenarioId, index),
    }),
    [],
  );

  return (
    <div className="mock-list-container">
      <div className="list-bar">
        <div className="add-menu-wrap" ref={addMenuRef}>
          <button
            type="button"
            data-testid="add-menu-open"
            className="plus-btn"
            aria-haspopup="menu"
            aria-expanded={isAddMenuOpen}
            aria-label="Add a mock, a socket mock or a scenario"
            title="Add a mock, a socket mock or a scenario"
            onClick={() => setIsAddMenuOpen((v) => !v)}
          >
            <PlusIcon size={16} />
            <ChevronDownIcon size={14} />
          </button>
          {isAddMenuOpen && (
            <div className="menu add-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                data-testid="mock-new"
                autoFocus
                onClick={() => {
                  setIsAddMenuOpen(false);
                  handleNewMock();
                }}
              >
                <PlusIcon size={16} />
                <span>
                  New mock
                  <span className="hint">In {activeScenario?.name ?? 'Default'}</span>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="socket-new"
                onClick={() => {
                  setIsAddMenuOpen(false);
                  handleNewSocket();
                }}
              >
                <SocketIcon size={16} />
                <span>
                  New socket mock
                  <span className="hint">WebSocket or SignalR</span>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="scenario-new"
                onClick={() => {
                  setIsAddMenuOpen(false);
                  handleNewScenario();
                }}
              >
                <ScenarioIcon size={16} />
                <span>New scenario</span>
              </button>
            </div>
          )}
        </div>
        <input
          type="text"
          data-testid="mocks-filter"
          className="mocks-filter-input"
          placeholder="Filter mocks"
          aria-label="Filter mocks"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
        {isFilterActive && (
          <span data-testid="mocks-filter-count" className="mocks-filter-count">
            {matchingCount} of {totalItems}
          </span>
        )}
        <button
          type="button"
          data-testid="delete-all"
          className="ibtn boxed red delete-all-btn"
          aria-label="Delete all mocks"
          title="Delete all mocks and scenarios"
          onClick={() => setIsConfirmOpen(true)}
        >
          <TrashIcon size={16} />
        </button>
      </div>

      <ConfirmDialog
        isOpen={isConfirmOpen}
        siteName={project.name || 'this site'}
        onConfirm={() => {
          setIsConfirmOpen(false);
          onDeleteAll();
        }}
        onCancel={() => setIsConfirmOpen(false)}
      />

      <div className="scenarios-list" ref={listRef}>
        {totalItems === 0 && (
          <div data-testid="mocks-empty" className="mocks-empty">
            No mocks yet. Click a call in the Log, then Mock this, or import a file.
            {onLoadSample && (
              <button
                type="button"
                data-testid="sample-load"
                className="btn-secondary"
                style={{ display: 'block', margin: '8px auto 0' }}
                onClick={onLoadSample}
              >
                Load the sample
              </button>
            )}
          </div>
        )}

        {scenarios.map((sc, scIndex) => {
          const isActive = sc.id === activeScenario?.id;
          const isScDefault = scIndex === 0;
          const isFolded = foldedIds.includes(sc.id);
          const unreachable = unreachableByScenario.get(sc.id) ?? new Map();
          const count = sc.mocks.length + (sc.sockets?.length ?? 0);

          const displayMocks = isFilterActive
            ? sc.mocks
                .map((m, originalIndex) => ({ mock: m, originalIndex }))
                .filter(({ mock }) => mockMatches(mock, trimmedFilter))
            : sc.mocks.map((m, originalIndex) => ({ mock: m, originalIndex }));

          const displaySockets = isFilterActive
            ? (sc.sockets ?? []).filter((s) => socketMatches(s, trimmedFilter))
            : (sc.sockets ?? []);

          if (isFilterActive && displayMocks.length === 0 && displaySockets.length === 0) {
            return null;
          }

          const showRows = !isFolded || isFilterActive;
          const activate = () => {
            if (!isActive) onActivateScenario(sc.id);
            else onSelectScenario(sc.id);
          };

          return (
            <div
              key={sc.id}
              className={`scenario-group ${isActive ? 'selected active' : ''} ${!showRows ? 'folded' : ''}`}
            >
              <div
                className="scenario-group-header"
                data-testid="scenario-header"
                tabIndex={0}
                aria-label={isActive ? `${sc.name}, active` : `Make ${sc.name} active`}
                title={
                  isScDefault
                    ? 'Default answers whatever the active scenario has no mock for'
                    : `Click to make ${sc.name} active`
                }
                onClick={(e) => {
                  if (isControl(e.target)) return;
                  activate();
                }}
                onKeyDown={(e) => {
                  if (isControl(e.target)) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activate();
                  }
                }}
              >
                <button
                  type="button"
                  data-testid="scenario-fold"
                  className="ibtn sm scenario-fold-btn"
                  aria-expanded={isFolded ? 'false' : 'true'}
                  aria-label={isFolded ? `Unfold ${sc.name}` : `Fold ${sc.name}`}
                  title={isFolded ? `Unfold ${sc.name}` : `Fold ${sc.name}`}
                  onClick={() => handleToggleFold(sc.id)}
                >
                  <ChevronDownIcon size={14} className={isFolded ? 'chev folded' : 'chev'} />
                </button>
                <div className="sc-title">
                  {renamingId === sc.id ? (
                    <input
                      type="text"
                      data-testid="scenario-rename-input"
                      className="sc-name-input"
                      aria-label="Scenario name"
                      autoFocus
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      onFocus={(e) => e.currentTarget.select()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          finishRename(true);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          e.stopPropagation();
                          finishRename(false);
                        }
                      }}
                      onBlur={() => {
                        if (renamingId === sc.id) finishRename(true);
                      }}
                    />
                  ) : (
                    <>
                      <span className="scenario-name-badge" data-testid="scenario-name">
                        {sc.name}
                      </span>
                      {!isScDefault && (
                        <button
                          type="button"
                          data-testid="scenario-rename"
                          className="ibtn sm"
                          aria-label={`Rename ${sc.name}`}
                          title="Rename"
                          onClick={() => startRename(sc.id, sc.name)}
                        >
                          <PencilIcon size={14} />
                        </button>
                      )}
                    </>
                  )}
                </div>
                {isActive && (
                  <span className="pill" data-testid="scenario-active">
                    Active
                  </span>
                )}
                {!isActive && isScDefault && <span className="pill base">Always on</span>}
                <div className="sc-actions">
                  {onDuplicateScenario && (
                    <button
                      type="button"
                      data-testid="scenario-duplicate"
                      className="ibtn sm"
                      aria-label={`Duplicate ${sc.name}`}
                      title="Duplicate scenario"
                      onClick={() => onDuplicateScenario(sc.id)}
                    >
                      <CopyIcon size={14} />
                    </button>
                  )}
                  {onExportScenario && (
                    <button
                      type="button"
                      data-testid="scenario-export"
                      className="ibtn sm"
                      aria-label={`Export ${sc.name}`}
                      title="Export scenario"
                      onClick={() => onExportScenario(sc.id)}
                    >
                      <ExportIcon size={14} />
                    </button>
                  )}
                  {isScDefault ? (
                    <button
                      type="button"
                      data-testid="scenario-clear"
                      className="ibtn sm red"
                      aria-label={`Delete every mock in ${sc.name}`}
                      title={`Delete every mock in ${sc.name}`}
                      disabled={count === 0}
                      onClick={() => onClearScenario(sc.id)}
                    >
                      <TrashIcon size={14} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-testid="scenario-delete"
                      className="ibtn sm red"
                      aria-label={`Delete ${sc.name}`}
                      title="Delete scenario"
                      onClick={() => onDeleteScenario(sc.id)}
                    >
                      <TrashIcon size={14} />
                    </button>
                  )}
                </div>
                <span className="scenario-count" data-testid="scenario-count" aria-label={`${count} mocks`}>
                  {count}
                </span>
              </div>

              {showRows && (
                <div className="mock-rows-container">
                  {displayMocks.map(({ mock, originalIndex }) => (
                    <MockRow
                      key={mock.id}
                      mock={mock}
                      scenarioId={sc.id}
                      index={originalIndex}
                      isLast={originalIndex === sc.mocks.length - 1}
                      isSelected={mock.id === selectedMockId}
                      isFlash={flashId === mock.id}
                      unreachableReason={unreachable.get(mock.id)?.reason}
                      isFilterActive={isFilterActive}
                      actions={rowActions}
                    />
                  ))}
                  {displaySockets.map((socket) => {
                    const isSelected = socket.id === selectedSocketId;
                    return (
                      <div
                        key={socket.id}
                        data-row-id={socket.id}
                        data-testid="socket-row"
                        tabIndex={0}
                        aria-selected={isSelected ? 'true' : undefined}
                        className={`mock-row socket-row ${isSelected ? 'selected' : ''} ${!socket.enabled ? 'disabled off' : ''}`}
                        onClick={(e) => {
                          if (isControl(e.target)) return;
                          onSelectScenario(sc.id);
                          onSelectSocket(socket.id);
                          onSelectMock(null);
                        }}
                        onKeyDown={(e) => {
                          if (isControl(e.target)) return;
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelectScenario(sc.id);
                            onSelectSocket(socket.id);
                            onSelectMock(null);
                          }
                        }}
                      >
                        <span className={`method-tag meth method-${socket.kind === 'signalr' ? 'signalr' : 'ws'}`}>
                          {socket.kind === 'signalr' ? 'SignalR' : 'WS'}
                        </span>
                        <span className="mock-name-or-pattern" title={socket.urlPattern}>
                          {socket.urlPattern}
                          {socket.name && <span className="nm">{socket.name}</span>}
                        </span>
                        {!socket.enabled && <span className="offtag">off</span>}
                        <button
                          type="button"
                          data-testid="socket-row-delete"
                          className="ibtn sm red row-del"
                          aria-label={`Delete ${socket.name || socket.urlPattern}`}
                          title="Delete socket mock"
                          onClick={() => onDeleteSocket(socket.id)}
                        >
                          <TrashIcon size={14} />
                        </button>
                      </div>
                    );
                  })}
                  {!isFilterActive && count === 0 && <div className="scenario-empty-hint">No mocks</div>}
                </div>
              )}
            </div>
          );
        })}

        {/* Header rules, last in the same scroll area. */}
        <div className="header-rules-section">
          <div className="header-rules-header">
            <div className="header-rules-title-group">
              <h3 className="header-rules-title">Header rules</h3>
              <span className="header-rules-help">
                Header rules change real calls only; mocks are not affected.
              </span>
            </div>
            <button
              type="button"
              data-testid="hrule-add"
              className="btn-secondary hrule-add-btn"
              onClick={handleAddRule}
            >
              + Add rule
            </button>
          </div>

          <div className="header-rules-list">
            {headerRules.map((rule) => {
              const error = getRuleError(rule);
              return (
                <div key={rule.id} data-testid="hrule-row" className="hrule-row">
                  <div className="hrule-row-inputs">
                    <input
                      type="checkbox"
                      data-testid="hrule-enabled"
                      aria-label="Rule on"
                      className="hrule-enabled-checkbox"
                      checked={rule.enabled}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleUpdateRule(rule.id, { enabled: e.target.checked });
                      }}
                    />
                    <select
                      data-testid="hrule-method"
                      aria-label="Method"
                      className="hrule-method-select select-input"
                      value={rule.method}
                      onChange={(e) => handleUpdateRule(rule.id, { method: e.target.value as HttpMethod })}
                    >
                      <option value="ANY">ANY</option>
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                      <option value="PUT">PUT</option>
                      <option value="PATCH">PATCH</option>
                      <option value="DELETE">DELETE</option>
                      <option value="HEAD">HEAD</option>
                      <option value="OPTIONS">OPTIONS</option>
                    </select>
                    <input
                      type="text"
                      data-testid="hrule-pattern"
                      className="hrule-pattern-input text-input monospace"
                      placeholder="/api/*rest"
                      aria-label="URL pattern"
                      value={rule.urlPattern}
                      onChange={(e) => handleUpdateRule(rule.id, { urlPattern: e.target.value })}
                    />
                    <input
                      type="text"
                      data-testid="hrule-name"
                      className="hrule-name-input text-input monospace"
                      placeholder="Header name"
                      aria-label="Header name"
                      value={rule.name}
                      onChange={(e) => handleUpdateRule(rule.id, { name: e.target.value })}
                    />
                    <input
                      type="text"
                      data-testid="hrule-value"
                      className="hrule-value-input text-input monospace"
                      placeholder="empty = remove"
                      aria-label="Header value (empty removes it)"
                      value={rule.value}
                      onChange={(e) => handleUpdateRule(rule.id, { value: e.target.value })}
                    />
                    <button
                      type="button"
                      data-testid="hrule-remove"
                      className="hrule-remove-btn"
                      title="Remove rule"
                      aria-label="Remove rule"
                      onClick={() => handleRemoveRule(rule.id)}
                    >
                      ×
                    </button>
                  </div>
                  {error && (
                    <div data-testid="hrule-error" className="hrule-error">
                      {error}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default MockList;
