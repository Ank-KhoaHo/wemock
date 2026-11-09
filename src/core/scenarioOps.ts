import type { Mock, Project, Scenario, SocketMock } from './types';

/**
 * Removes scenarios by id from project, preserving the others in order.
 * The first scenario (Default) is never removed.
 * If the active scenario was deleted, sets activeScenarioId to the first scenario (Default).
 * Pure function: does not modify input project.
 */
export function deleteScenarios(project: Project, ids: string[]): Project {
  const defaultScenario = project.scenarios[0];
  const idsToDelete = new Set(ids);
  if (defaultScenario) {
    idsToDelete.delete(defaultScenario.id);
  }

  const remainingScenarios = project.scenarios.filter(
    (s, idx) => idx === 0 || !idsToDelete.has(s.id),
  );

  const activeDeleted = idsToDelete.has(project.activeScenarioId);
  const activeExists = remainingScenarios.some((s) => s.id === project.activeScenarioId);
  const activeScenarioId =
    activeDeleted || !activeExists
      ? (remainingScenarios[0]?.id ?? 'default')
      : project.activeScenarioId;

  return {
    ...project,
    origins: [...project.origins],
    scenarios: remainingScenarios.map((s) => ({
      ...s,
      mocks: [...s.mocks],
      sockets: s.sockets ? [...s.sockets] : undefined,
    })),
    activeScenarioId,
  };
}

/**
 * Empties all mocks and sockets from Default, removes all other scenarios,
 * and sets activeScenarioId to Default. Keeps id, name, origins.
 * Pure function: does not modify input project.
 */
export function clearProject(project: Project): Project {
  const defaultScenario = project.scenarios[0];
  const clearedDefault: Scenario = {
    id: defaultScenario?.id ?? 'default',
    name: defaultScenario?.name ?? 'Default',
    mocks: [],
    sockets: [],
  };

  return {
    ...project,
    origins: [...project.origins],
    scenarios: [clearedDefault],
    activeScenarioId: clearedDefault.id,
  };
}

/**
 * Returns a name that is not present in `taken`.
 * If `name` is already taken, tries `${name} (2)`, `${name} (3)`, etc.
 */
export function uniqueName(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name;
  let counter = 2;
  while (taken.includes(`${name} (${counter})`)) {
    counter++;
  }
  return `${name} (${counter})`;
}

/**
 * Appends incoming project's mocks and scenarios into target project.
 * Incoming Default mocks and sockets are appended to target Default.
 * Other incoming scenarios are appended with unique names.
 * Every added scenario, mock, and socket gets a new id from `newId`.
 * Target's id, name, origins, and activeScenarioId are preserved.
 * Pure function: does not modify inputs.
 */
export function mergeProject(
  target: Project,
  incoming: Project,
  newId: () => string,
): Project {
  const incomingDefault = incoming.scenarios[0];
  const addedDefaultMocks: Mock[] = incomingDefault
    ? incomingDefault.mocks.map((m) => ({
        ...m,
        id: newId(),
      }))
    : [];
  const addedDefaultSockets: SocketMock[] = incomingDefault?.sockets
    ? incomingDefault.sockets.map((s) => ({
        ...s,
        id: newId(),
      }))
    : [];

  const targetDefault = target.scenarios[0] ?? {
    id: 'default',
    name: 'Default',
    mocks: [],
    sockets: [],
  };

  const newDefault: Scenario = {
    ...targetDefault,
    mocks: [...targetDefault.mocks, ...addedDefaultMocks],
    sockets: [...(targetDefault.sockets ?? []), ...addedDefaultSockets],
  };

  const currentNames = target.scenarios.map((s) => s.name);
  const newScenarios: Scenario[] = [];

  for (const sc of incoming.scenarios.slice(1)) {
    const name = uniqueName(sc.name, currentNames);
    currentNames.push(name);
    const id = newId();
    const mocks = sc.mocks.map((m) => ({ ...m, id: newId() }));
    const sockets = sc.sockets?.map((s) => ({ ...s, id: newId() }));
    newScenarios.push({
      ...sc,
      id,
      name,
      mocks,
      ...(sockets !== undefined ? { sockets } : {}),
    });
  }

  const otherTargetScenarios = target.scenarios.slice(1).map((s) => ({
    ...s,
    mocks: [...s.mocks],
    sockets: s.sockets ? [...s.sockets] : undefined,
  }));

  return {
    ...target,
    origins: [...target.origins],
    scenarios: [newDefault, ...otherTargetScenarios, ...newScenarios],
    activeScenarioId: target.activeScenarioId,
  };
}

/**
 * Replaces target's scenarios with incoming's scenarios, preserving target's id, name, origins.
 * Takes incoming's activeScenarioId if it exists in incoming scenarios, otherwise incoming's first scenario id.
 * If incoming has no scenarios, leaves one empty Default scenario.
 * Pure function: does not modify inputs.
 */
export function replaceProject(target: Project, incoming: Project): Project {
  if (incoming.scenarios.length === 0) {
    const defaultScenario: Scenario = {
      id: 'default',
      name: 'Default',
      mocks: [],
      sockets: [],
    };
    return {
      ...target,
      origins: [...target.origins],
      activeScenarioId: 'default',
      scenarios: [defaultScenario],
    };
  }

  const activeExists = incoming.scenarios.some((s) => s.id === incoming.activeScenarioId);
  const activeScenarioId = activeExists
    ? incoming.activeScenarioId
    : incoming.scenarios[0]!.id;

  return {
    ...target,
    origins: [...target.origins],
    activeScenarioId,
    scenarios: incoming.scenarios.map((s) => ({
      ...s,
      mocks: [...s.mocks],
      sockets: s.sockets ? [...s.sockets] : undefined,
    })),
  };
}
