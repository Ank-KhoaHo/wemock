import type { Project } from '../core/types';

export interface ScenarioChipsProps {
  project: Project;
  onPick: (scenarioId: string) => void;
}

export function ScenarioChips({ project, onPick }: ScenarioChipsProps) {
  return (
    <div className="scenario-chips" role="group" aria-label="Scenarios">
      {project.scenarios.map((scenario) => {
        const isActive = scenario.id === project.activeScenarioId;
        return (
          <button
            key={scenario.id}
            type="button"
            className={`scenario-chip ${isActive ? 'active' : ''}`}
            data-testid="scenario-chip"
            aria-pressed={isActive ? 'true' : 'false'}
            onClick={() => onPick(scenario.id)}
          >
            {scenario.name}
          </button>
        );
      })}
    </div>
  );
}

export default ScenarioChips;
