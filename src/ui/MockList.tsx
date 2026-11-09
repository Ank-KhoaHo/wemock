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

  useEffect(() => {
    setScenarios(project.scenarios);
    setSelectedScenarioIds((prev) =>
      prev.filter((id) => project.scenarios.some((s) => s.id === id)),
    );
  }, [project.scenarios]);

  const selectedScenario =
    scenarios.find((s) => s.id === selectedScenarioId) ?? scenarios[0];

  const isDefault =
    !selectedScenario ||
    selectedScenario.id === 'default' ||
    selectedScenario.id === scenarios[0]?.id;

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
    e.dataTransfer.setData('text/plain', JSON.stringify({ scenarioId, index }));
  };

  const handleDrop = (e: React.DragEvent, toScenarioId: string, toIndex: number) => {
    e.preventDefault();
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

      {/* Scenarios list with their mocks */}
      <div className="scenarios-list">
        {scenarios.map((sc, idx) => {
          const isSelected = sc.id === (selectedScenario?.id ?? '');
          const isScDefault = idx === 0;
          return (
            <div
              key={sc.id}
              className={`scenario-group ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelectScenario(sc.id)}
            >
              <div className="scenario-group-header">
                <div className="scenario-header-left">
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

              <div className="mock-rows-container">
                {sc.mocks.map((mock, idx) => (
                  <div
                    key={mock.id}
                    data-testid="mock-row"
                    className={`mock-row ${mock.id === selectedMockId ? 'selected' : ''} ${!mock.enabled ? 'disabled' : ''}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, sc.id, idx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDrop(e, sc.id, idx)}
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
                          disabled={idx === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveMock(sc.id, idx, -1);
                          }}
                          title="Move up"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          data-testid="mock-down"
                          className="mock-down-btn"
                          disabled={idx === sc.mocks.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveMock(sc.id, idx, 1);
                          }}
                          title="Move down"
                        >
                          ▼
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {(sc.sockets ?? []).map((socket) => (
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
                {sc.mocks.length === 0 && (!sc.sockets || sc.sockets.length === 0) && (
                  <div className="scenario-empty-hint">No mocks</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default MockList;
