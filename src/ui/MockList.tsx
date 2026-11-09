import { useEffect, useState } from 'react';
import type { Mock, Project } from '../core/types';
import { newId } from '../shared/ids';

export interface MockListProps {
  project: Project;
  selectedScenarioId: string;
  selectedMockId: string | null;
  onSelectScenario: (scenarioId: string) => void;
  onSelectMock: (mockId: string | null) => void;
  onUpdateScenarioMocks: (scenarioId: string, mocks: Mock[]) => void;
  onAddScenario: (name: string) => void;
  onRenameScenario: (scenarioId: string, newName: string) => void;
  onDeleteScenario: (scenarioId: string) => void;
  onAddMock: (scenarioId: string, mock: Mock) => void;
}

export function MockList({
  project,
  selectedScenarioId,
  selectedMockId,
  onSelectScenario,
  onSelectMock,
  onUpdateScenarioMocks,
  onAddScenario,
  onRenameScenario,
  onDeleteScenario,
  onAddMock,
}: MockListProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameText, setRenameText] = useState('');
  const [scenarios, setScenarios] = useState(project.scenarios);

  useEffect(() => {
    setScenarios(project.scenarios);
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
        </div>

        <button
          type="button"
          data-testid="mock-new"
          className="btn-primary"
          onClick={handleNewMockClick}
        >
          + New mock
        </button>
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
        {scenarios.map((sc) => {
          const isSelected = sc.id === (selectedScenario?.id ?? '');
          return (
            <div
              key={sc.id}
              className={`scenario-group ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelectScenario(sc.id)}
            >
              <div className="scenario-group-header">
                <span className="scenario-name-badge">{sc.name}</span>
                <span className="scenario-count">({sc.mocks.length})</span>
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
                {sc.mocks.length === 0 && (
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
