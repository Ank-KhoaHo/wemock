import { useEffect, useState } from 'react';
import type { Mock, Project, SocketMock } from '../core/types';
import { newId } from '../shared/ids';

export interface MockListProps {
  project: Project;
  selectedScenarioId: string;
  selectedMockId: string | null;
  selectedSocketId: string | null;
  onSelectScenario: (scenarioId: string) => void;
  onSelectMock: (mockId: string | null) => void;
  onSelectSocket: (socketId: string | null) => void;
  onUpdateScenarioMocks: (scenarioId: string, mocks: Mock[]) => void;
  onUpdateScenarioSockets: (scenarioId: string, sockets: SocketMock[]) => void;
  onAddScenario: (name: string) => void;
  onRenameScenario: (scenarioId: string, newName: string) => void;
  onDeleteScenario: (scenarioId: string) => void;
  onDeleteScenarios: (ids: string[]) => void;
  onDeleteAll: () => void;
  onAddMock: (scenarioId: string, mock: Mock) => void;
  onAddSocket: (scenarioId: string, socket: SocketMock) => void;
}

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

export function MockList({
  project,
  selectedScenarioId,
  selectedMockId,
  selectedSocketId,
  onSelectScenario,
  onSelectMock,
  onSelectSocket,
  onUpdateScenarioMocks,
  onUpdateScenarioSockets,
  onAddScenario,
  onRenameScenario,
  onDeleteScenario,
  onDeleteScenarios,
  onDeleteAll,
  onAddMock,
  onAddSocket,
}: MockListProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameText, setRenameText] = useState('');
  const [scenarios, setScenarios] = useState(project.scenarios);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>([]);
  const [filterText, setFilterText] = useState('');
  const [foldedIds, setFoldedIds] = useState<string[]>(() => loadFoldedIds(project.id));

  useEffect(() => {
    setScenarios(project.scenarios);
    setSelectedScenarioIds((prev) =>
      prev.filter((id) => project.scenarios.some((s) => s.id === id)),
    );
  }, [project.scenarios]);

  useEffect(() => {
    setFoldedIds(loadFoldedIds(project.id));
    setFilterText('');
  }, [project.id]);

  const handleToggleFold = (scenarioId: string) => {
    setFoldedIds((prev) => {
      const next = prev.includes(scenarioId)
        ? prev.filter((id) => id !== scenarioId)
        : [...prev, scenarioId];
      saveFoldedIds(project.id, next);
      return next;
    });
  };

  const selectedScenario =
    scenarios.find((s) => s.id === selectedScenarioId) ?? scenarios[0];

  const isDefault =
    !selectedScenario ||
    selectedScenario.id === 'default' ||
    selectedScenario.id === scenarios[0]?.id;

  const trimmedFilter = filterText.trim().toLowerCase();
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

  const handleStartRename = () => {
    if (isDefault || !selectedScenario) return;
    setRenameText(selectedScenario.name);
    setIsRenaming(true);
  };

  const handleSaveRename = () => {
    const trimmed = renameText.trim();
    if (trimmed && selectedScenario) {
      onRenameScenario(selectedScenario.id, trimmed);
    }
    setIsRenaming(false);
    setRenameText('');
  };

  const handleNewScenarioClick = () => {
    const name = `Scenario ${project.scenarios.length + 1}`;
    onAddScenario(name);
  };

  const handleDeleteScenarioClick = () => {
    if (isDefault || !selectedScenario) return;
    onDeleteScenario(selectedScenario.id);
  };

  const handleDeleteSelected = () => {
    if (selectedScenarioIds.length === 0) return;
    onDeleteScenarios(selectedScenarioIds);
    setSelectedScenarioIds([]);
  };

  const handleDeleteAll = () => {
    onDeleteAll();
    setSelectedScenarioIds([]);
  };

  const handleNewMockClick = () => {
    if (!selectedScenario) return;
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
      source: 'manual',
      createdAt: Date.now(),
    };
    onAddMock(selectedScenario.id, manualMock);
  };

  const handleNewSocketClick = () => {
    if (!selectedScenario) return;
    const socket: SocketMock = {
      id: newId(),
      enabled: true,
      kind: 'signalr',
      urlPattern: '/hub',
      onConnect: [],
      replies: [],
      createdAt: Date.now(),
    };
    onAddSocket(selectedScenario.id, socket);
  };

  const handleToggleSocketEnabled = (scenarioId: string, socketId: string, enabled?: boolean) => {
    const sc = scenarios.find((s) => s.id === scenarioId);
    if (!sc) return;
    const nextSockets = (sc.sockets ?? []).map((s) =>
      s.id === socketId ? { ...s, enabled: enabled !== undefined ? enabled : !s.enabled } : s,
    );
    setScenarios((prev) =>
      prev.map((s) => (s.id === scenarioId ? { ...s, sockets: nextSockets } : s)),
    );
    onUpdateScenarioSockets(scenarioId, nextSockets);
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

  const handleToggleMockEnabled = (scenarioId: string, mockId: string) => {
    const sc = scenarios.find((s) => s.id === scenarioId);
    if (!sc) return;
    const nextMocks = sc.mocks.map((m) =>
      m.id === mockId ? { ...m, enabled: !m.enabled } : m,
    );
    setScenarios((prev) =>
      prev.map((s) => (s.id === scenarioId ? { ...s, mocks: nextMocks } : s)),
    );
    onUpdateScenarioMocks(scenarioId, nextMocks);
  };

  return (
    <div className="mock-list-container">
      {/* Scenario controls */}
      <div className="scenario-controls">
        <div className="scenario-btn-group">
          <button
            type="button"
            data-testid="scenario-new"
            className="btn-secondary"
            onClick={handleNewScenarioClick}
          >
            New scenario
          </button>
          <button
            type="button"
            data-testid="scenario-rename"
            className="btn-secondary"
            disabled={isDefault}
            onClick={handleStartRename}
          >
            Rename
          </button>
          <button
            type="button"
            data-testid="scenario-delete"
            className="btn-secondary"
            disabled={isDefault}
            onClick={handleDeleteScenarioClick}
          >
            Delete
          </button>
          {selectedScenarioIds.length >= 1 && (
            <button
              type="button"
              data-testid="scenarios-delete-selected"
              className="btn-secondary"
              onClick={handleDeleteSelected}
            >
              Delete selected ({selectedScenarioIds.length})
            </button>
          )}
          <button
            type="button"
            data-testid="scenarios-delete-all"
            className="btn-secondary"
            onClick={handleDeleteAll}
          >
            Delete all
          </button>
        </div>

        <div className="mock-btn-group">
          <button
            type="button"
            data-testid="mock-new"
            className="btn-primary"
            onClick={handleNewMockClick}
          >
            + New mock
          </button>
          <button
            type="button"
            data-testid="socket-new"
            className="btn-primary"
            onClick={handleNewSocketClick}
          >
            + New socket
          </button>
        </div>
      </div>

      {isRenaming && (
        <div className="scenario-rename-form">
          <input
            type="text"
            data-testid="scenario-rename-input"
            className="text-input"
            value={renameText}
            autoFocus
            onChange={(e) => setRenameText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveRename();
              if (e.key === 'Escape') setIsRenaming(false);
            }}
          />
          <button
            type="button"
            data-testid="scenario-rename-save"
            className="btn-primary"
            onClick={handleSaveRename}
          >
            Save
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setIsRenaming(false)}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Filter box */}
      <div className="mocks-filter-bar">
        <input
          type="text"
          data-testid="mocks-filter"
          className="mocks-filter-input"
          placeholder="Filter mocks"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
        {isFilterActive && (
          <span data-testid="mocks-filter-count" className="mocks-filter-count">
            {matchingCount} of {totalItems}
          </span>
        )}
      </div>

      {/* Scenarios list with their mocks */}
      <div className="scenarios-list">
        {scenarios.map((sc) => {
          const isSelected = sc.id === (selectedScenario?.id ?? '');
          const isScDefault = sc.id === scenarios[0]?.id;
          const isFolded = foldedIds.includes(sc.id);

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

          return (
            <div
              key={sc.id}
              className={`scenario-group ${isSelected ? 'selected' : ''} ${!showRows ? 'folded' : ''}`}
              onClick={() => onSelectScenario(sc.id)}
            >
              <div className="scenario-group-header">
                <div className="scenario-header-left">
                  <button
                    type="button"
                    data-testid="scenario-fold"
                    className="scenario-fold-btn"
                    aria-expanded={isFolded ? 'false' : 'true'}
                    aria-label={isFolded ? `Unfold ${sc.name}` : `Fold ${sc.name}`}
                    title={isFolded ? `Unfold ${sc.name}` : `Fold ${sc.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleFold(sc.id);
                    }}
                  >
                    <svg
                      className="scenario-fold-icon"
                      width="12"
                      height="12"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d={isFolded ? 'M6 4l4 4-4 4' : 'M4 6l4 4 4-4'} />
                    </svg>
                  </button>
                  {!isScDefault && (
                    <input
                      type="checkbox"
                      data-testid="scenario-select"
                      className="scenario-select-checkbox"
                      checked={selectedScenarioIds.includes(sc.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation();
                        const checked = e.target.checked;
                        setSelectedScenarioIds((prev) =>
                          checked ? [...prev, sc.id] : prev.filter((id) => id !== sc.id),
                        );
                      }}
                    />
                  )}
                  <span className="scenario-name-badge">{sc.name}</span>
                </div>
                <span className="scenario-count">({sc.mocks.length + (sc.sockets?.length ?? 0)})</span>
              </div>

              {showRows && (
                <div className="mock-rows-container">
                  {displayMocks.map(({ mock, originalIndex }) => (
                    <div
                      key={mock.id}
                      data-testid="mock-row"
                      className={`mock-row ${mock.id === selectedMockId ? 'selected' : ''} ${!mock.enabled ? 'disabled' : ''}`}
                      draggable={!isFilterActive}
                      onDragStart={(e) => {
                        if (isFilterActive) return;
                        handleDragStart(e, sc.id, originalIndex);
                      }}
                      onDragOver={(e) => {
                        if (isFilterActive) return;
                        e.preventDefault();
                      }}
                      onDrop={(e) => {
                        if (isFilterActive) return;
                        handleDrop(e, sc.id, originalIndex);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectScenario(sc.id);
                        onSelectMock(mock.id);
                        onSelectSocket(null);
                      }}
                    >
                      <div className="mock-row-main">
                        <input
                          type="checkbox"
                          data-testid="mock-enabled"
                          className="mock-enabled-checkbox"
                          checked={mock.enabled}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleToggleMockEnabled(sc.id, mock.id);
                          }}
                        />
                        <span className={`method-tag method-${mock.method.toLowerCase()}`}>
                          {mock.method}
                        </span>
                        <span className="mock-name-or-pattern" title={mock.urlPattern}>
                          {mock.name || mock.urlPattern}
                          {mock.reply === 'code' && (
                            <span className="code-chip" data-testid="code-chip" title="Answers with code">
                              code
                            </span>
                          )}
                        </span>
                      </div>

                      <div className="mock-row-side">
                        <span className={`mock-status ${mock.response.status >= 400 ? 'status-error' : ''}`}>
                          {mock.response.status}
                        </span>
                        <div className="mock-reorder-buttons">
                          <button
                            type="button"
                            data-testid="mock-up"
                            className="mock-up-btn"
                            disabled={isFilterActive || originalIndex === 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isFilterActive) return;
                              handleMoveMock(sc.id, originalIndex, -1);
                            }}
                            title="Move up"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            data-testid="mock-down"
                            className="mock-down-btn"
                            disabled={isFilterActive || originalIndex === sc.mocks.length - 1}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isFilterActive) return;
                              handleMoveMock(sc.id, originalIndex, 1);
                            }}
                            title="Move down"
                          >
                            ▼
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {displaySockets.map((socket) => (
                    <div
                      key={socket.id}
                      data-testid="socket-row"
                      className={`mock-row socket-row ${socket.id === selectedSocketId ? 'selected' : ''} ${!socket.enabled ? 'disabled' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectScenario(sc.id);
                        onSelectSocket(socket.id);
                        onSelectMock(null);
                      }}
                    >
                      <div className="mock-row-main">
                        <input
                          type="checkbox"
                          data-testid="socket-enabled"
                          className="mock-enabled-checkbox"
                          checked={socket.enabled}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleToggleSocketEnabled(sc.id, socket.id, e.target.checked);
                          }}
                        />
                        <span className={`method-tag method-${socket.kind === 'signalr' ? 'signalr' : 'ws'}`}>
                          {socket.kind === 'signalr' ? 'SignalR' : 'WS'}
                        </span>
                        <span className="mock-name-or-pattern" title={socket.urlPattern}>
                          {socket.name || socket.urlPattern}
                        </span>
                      </div>
                    </div>
                  ))}
                  {!isFilterActive && sc.mocks.length === 0 && (!sc.sockets || sc.sockets.length === 0) && (
                    <div className="scenario-empty-hint">No mocks</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default MockList;
