import type { Project } from '../core/types';
import { ScenarioChips } from './ScenarioChips';

export interface TopBarProps {
  project: Project | null;
  projects: Project[];
  selectedProjectId?: string;
  onSelectProject?: (projectId: string) => void;
  onPickScenario: (scenarioId: string) => void;
  recording: boolean;
  onToggleRecording: () => void;
  enabled: boolean;
  onToggleEnabled: () => void;
  consoleLog: boolean;
  onToggleConsoleLog: () => void;
  activeTab: 'log' | 'mocks';
  onTabChange: (tab: 'log' | 'mocks') => void;
}

export function TopBar({
  project,
  projects,
  selectedProjectId,
  onSelectProject,
  onPickScenario,
  recording,
  onToggleRecording,
  enabled,
  onToggleEnabled,
  consoleLog,
  onToggleConsoleLog,
  activeTab,
  onTabChange,
}: TopBarProps) {
  const allProjects =
    project && !projects.some((p) => p.id === project.id)
      ? [project, ...projects]
      : projects;

  const currentValue = project ? project.id : (selectedProjectId ?? '');

  return (
    <div className="panel-topbar">
      <div className="topbar-row">
        <div className="topbar-left">
          <h1 className="brand-title">wemock</h1>
          <select
            data-testid="project-picker"
            className="project-picker"
            value={currentValue}
            onChange={(e) => onSelectProject?.(e.target.value)}
          >
            {!project && <option value="">No project yet</option>}
            {allProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {project && (
            <ScenarioChips project={project} onPick={onPickScenario} />
          )}
        </div>
        <div className="topbar-right">
          <button
            type="button"
            data-testid="rec-toggle"
            className={`rec-toggle ${recording ? 'active' : ''}`}
            aria-pressed={recording ? 'true' : 'false'}
            onClick={onToggleRecording}
            title={recording ? 'Pause recording' : 'Start recording'}
          >
            <span className="rec-dot" /> Rec
          </button>
          <button
            type="button"
            data-testid="console-toggle"
            className={`console-toggle ${consoleLog ? 'active' : ''}`}
            aria-pressed={consoleLog ? 'true' : 'false'}
            onClick={onToggleConsoleLog}
            title={consoleLog ? 'Stop writing mocked calls to the Console' : 'Write each mocked call to the Console'}
          >
            Console
          </button>
          <button
            type="button"
            data-testid="power-toggle"
            className={`power-toggle ${enabled ? 'active' : ''}`}
            aria-pressed={enabled ? 'true' : 'false'}
            onClick={onToggleEnabled}
            title={enabled ? 'Disable mocks' : 'Enable mocks'}
          >
            ⏻
          </button>
        </div>
      </div>
      <div className="panel-tab-bar">
        <button
          type="button"
          data-testid="tab-log"
          className={`tab-btn ${activeTab === 'log' ? 'active' : ''}`}
          onClick={() => onTabChange('log')}
        >
          Log
        </button>
        <button
          type="button"
          data-testid="tab-mocks"
          className={`tab-btn ${activeTab === 'mocks' ? 'active' : ''}`}
          onClick={() => onTabChange('mocks')}
        >
          Mocks
        </button>
      </div>
    </div>
  );
}

export default TopBar;
