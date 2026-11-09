import type { Mock, Project, WemockState } from './types';
import { DEFAULT_SCENARIO_ID } from './types';

export function projectForOrigin(state: WemockState, origin: string): Project | null {
  for (const project of state.projects) {
    if (project.origins.includes(origin)) {
      return project;
    }
  }
  return null;
}

export function activeMocks(project: Project): Mock[] {
  const defaultScenario =
    project.scenarios.find((s) => s.id === DEFAULT_SCENARIO_ID) ?? project.scenarios[0];
  const defaultMocks = defaultScenario ? defaultScenario.mocks : [];

  if (
    project.activeScenarioId === DEFAULT_SCENARIO_ID ||
    (defaultScenario && project.activeScenarioId === defaultScenario.id)
  ) {
    return [...defaultMocks];
  }

  const activeScenario = project.scenarios.find((s) => s.id === project.activeScenarioId);
  if (!activeScenario) {
    return [...defaultMocks];
  }

  return [...activeScenario.mocks, ...defaultMocks.map((m) => ({ ...m, fromDefault: true as const }))];
}
