import { useEffect, useRef, useState } from 'react';
import type { Project } from '../core/types';
import { ExportIcon, ImportIcon, PowerIcon, SampleIcon, ScenarioIcon, TerminalIcon } from './icons';

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
  onImportOpen: () => void;
  onExportProject: () => void;
  onExportActiveScenario: () => void;
  onLoadSample: () => void;
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
  onImportOpen,
  onExportProject,
  onExportActiveScenario,
  onLoadSample,
}: TopBarProps) {
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const exportWrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isExportMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsExportMenuOpen(false);
      }
    };
    const onClickOutside = (e: MouseEvent) => {
      if (
        exportWrapperRef.current &&
        !exportWrapperRef.current.contains(e.target as Node)
      ) {
        setIsExportMenuOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onClickOutside);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onClickOutside);
    };
  }, [isExportMenuOpen]);

  const allProjects =
    project && !projects.some((p) => p.id === project.id)
      ? [project, ...projects]
      : projects;

  const currentValue = project ? project.id : (selectedProjectId ?? '');

  const totalMocks = project
    ? project.scenarios.reduce(
        (sum, s) => sum + s.mocks.length + (s.sockets?.length ?? 0),
        0,
      )
    : 0;

  const activeScenario = project
    ? project.scenarios.find((s) => s.id === project.activeScenarioId) ||
      project.scenarios[0]
    : null;

  return (
    <header className="hdr">
      <h1 className="brand">
        <img src="/icon/32.png" alt="" width={22} height={22} />
        wemock
      </h1>
      <select
        data-testid="project-picker"
        className="proj project-picker"
        aria-label="Project"
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

      <button
        type="button"
        data-testid="import-open"
        aria-label="Import a file"
        title="Import a file"
        className="btn blue"
        onClick={onImportOpen}
      >
        <ImportIcon size={16} />
        <span className="lbl">Import</span>
      </button>

      <div ref={exportWrapperRef} style={{ position: 'relative', display: 'inline-block' }}>
        <button
          type="button"
          data-testid="export-open"
          aria-label="Export to a file"
          title="Export to a file"
          className="btn blue"
          aria-haspopup="menu"
          aria-expanded={isExportMenuOpen}
          onClick={(e) => {
            e.stopPropagation();
            setIsExportMenuOpen((prev) => !prev);
          }}
        >
          <ExportIcon size={16} />
          <span className="lbl">Export</span>
        </button>

        {isExportMenuOpen && (
          <div
            data-testid="export-menu"
            className="menu export-menu"
            role="menu"
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              zIndex: 50,
            }}
          >
            <button
              type="button"
              role="menuitem"
              data-testid="export-project"
              onClick={() => {
                setIsExportMenuOpen(false);
                onExportProject();
              }}
            >
              <ExportIcon size={16} />
              <span>
                Whole project
                <span className="hint">
                  {project
                    ? `${project.scenarios.length} scenarios, ${totalMocks} mocks`
                    : ''}
                </span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="export-active"
              onClick={() => {
                setIsExportMenuOpen(false);
                onExportActiveScenario();
              }}
            >
              <ScenarioIcon size={16} />
              <span>
                Only {activeScenario ? activeScenario.name : 'Default'}
              </span>
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        data-testid="sample-load-toolbar"
        aria-label="Load the sample shop"
        title="Load the sample shop"
        className="btn beak"
        onClick={onLoadSample}
      >
        <SampleIcon size={16} />
        <span className="lbl">Sample</span>
      </button>

      <div className="grow" style={{ flex: 1 }} />

      <div className="grp rtoggles" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          type="button"
          data-testid="rec-toggle"
          className={`toggle rec ${recording ? 'active' : ''}`}
          aria-pressed={recording ? 'true' : 'false'}
          onClick={onToggleRecording}
          title={recording ? 'Pause recording' : 'Start recording'}
        >
          <span className="dot" />
          <span className="lbl">Rec</span>
        </button>

        <button
          type="button"
          data-testid="console-toggle"
          className={`toggle con ${consoleLog ? 'active' : ''}`}
          aria-pressed={consoleLog ? 'true' : 'false'}
          onClick={onToggleConsoleLog}
          title={
            consoleLog
              ? 'Stop writing mocked calls to the Console'
              : 'Write each mocked call to the Console'
          }
        >
          <TerminalIcon size={16} className="ico" />
          <span className="lbl">Console</span>
        </button>

        <button
          type="button"
          data-testid="power-toggle"
          className={`power-toggle ibtn boxed power ${enabled ? 'active' : ''}`}
          aria-pressed={enabled ? 'true' : 'false'}
          aria-label={enabled ? 'Turn mocking off' : 'Turn mocking on'}
          onClick={onToggleEnabled}
          title={enabled ? 'Disable mocks' : 'Enable mocks'}
        >
          <PowerIcon size={16} className="ico" />
        </button>
      </div>
    </header>
  );
}

export default TopBar;
