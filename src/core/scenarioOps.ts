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

/** A43: a socket copy whose pushes and reply rules get new ids too. */
function cloneSocketWithNewIds(socket: SocketMock, newId: () => string): SocketMock {
  return {
    ...socket,
    id: newId(),
    onConnect: socket.onConnect.map((p) => ({ ...p, id: newId() })),
    replies: socket.replies.map((r) => ({
      ...r,
      id: newId(),
      pushes: r.pushes.map((p) => ({ ...p, id: newId() })),
    })),
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
    ? incomingDefault.sockets.map((s) => cloneSocketWithNewIds(s, newId))
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
    const sockets = sc.sockets?.map((s) => cloneSocketWithNewIds(s, newId));
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

/**
 * Duplicates a mock in scenarioId, placing the copy immediately after the original.
 * Named "<name> (copy)" or "<urlPattern> (copy)".
 * Returns updated project and the new mock id, or unchanged project and null if not found.
 * Pure function: does not modify inputs.
 */
export function duplicateMock(
  project: Project,
  scenarioId: string,
  mockId: string,
  newId: () => string,
): { project: Project; newId: string | null } {
  const scIndex = project.scenarios.findIndex((s) => s.id === scenarioId);
  if (scIndex === -1) {
    return { project, newId: null };
  }
  const targetScenario = project.scenarios[scIndex]!;
  const mockIndex = targetScenario.mocks.findIndex((m) => m.id === mockId);
  if (mockIndex === -1) {
    return { project, newId: null };
  }

  const origMock = targetScenario.mocks[mockIndex]!;
  const copyId = newId();
  const copyName =
    (origMock.name && origMock.name.trim() ? origMock.name : origMock.urlPattern) + ' (copy)';

  const copiedMock: Mock = {
    ...origMock,
    id: copyId,
    name: copyName,
  };

  const nextMocks = [
    ...targetScenario.mocks.slice(0, mockIndex + 1),
    copiedMock,
    ...targetScenario.mocks.slice(mockIndex + 1),
  ];

  const updatedScenarios = project.scenarios.map((s, idx) =>
    idx === scIndex
      ? { ...s, mocks: nextMocks, sockets: s.sockets ? [...s.sockets] : undefined }
      : { ...s, mocks: [...s.mocks], sockets: s.sockets ? [...s.sockets] : undefined },
  );

  return {
    project: {
      ...project,
      origins: [...project.origins],
      scenarios: updatedScenarios,
    },
    newId: copyId,
  };
}

/**
 * Duplicates a socket mock in scenarioId, placing the copy immediately after the original.
 * Named "<name> (copy)" or "<urlPattern> (copy)".
 * Every push and reply (and their pushes) gets a new id.
 * Returns updated project and the new socket id, or unchanged project and null if not found.
 * Pure function: does not modify inputs.
 */
export function duplicateSocket(
  project: Project,
  scenarioId: string,
  socketId: string,
  newId: () => string,
): { project: Project; newId: string | null } {
  const scIndex = project.scenarios.findIndex((s) => s.id === scenarioId);
  if (scIndex === -1) {
    return { project, newId: null };
  }
  const targetScenario = project.scenarios[scIndex]!;
  const sockets = targetScenario.sockets ?? [];
  const socketIndex = sockets.findIndex((s) => s.id === socketId);
  if (socketIndex === -1) {
    return { project, newId: null };
  }

  const origSocket = sockets[socketIndex]!;
  const copyId = newId();
  const copyName =
    (origSocket.name && origSocket.name.trim() ? origSocket.name : origSocket.urlPattern) + ' (copy)';

  const copiedSocket: SocketMock = {
    ...origSocket,
    id: copyId,
    name: copyName,
    onConnect: origSocket.onConnect.map((p) => ({ ...p, id: newId() })),
    replies: origSocket.replies.map((r) => ({
      ...r,
      id: newId(),
      pushes: r.pushes.map((p) => ({ ...p, id: newId() })),
    })),
  };

  const nextSockets = [
    ...sockets.slice(0, socketIndex + 1),
    copiedSocket,
    ...sockets.slice(socketIndex + 1),
  ];

  const updatedScenarios = project.scenarios.map((s, idx) =>
    idx === scIndex
      ? { ...s, mocks: [...s.mocks], sockets: nextSockets }
      : { ...s, mocks: [...s.mocks], sockets: s.sockets ? [...s.sockets] : undefined },
  );

  return {
    project: {
      ...project,
      origins: [...project.origins],
      scenarios: updatedScenarios,
    },
    newId: copyId,
  };
}

/**
 * Duplicates a scenario, placing the copy immediately after the original.
 * Named with uniqueName. Every mock and socket (and pushes and replies) gets a new id.
 * Default can be duplicated; the copy is an ordinary scenario. Active scenario does not change.
 * Pure function: does not modify inputs.
 */
export function duplicateScenario(
  project: Project,
  scenarioId: string,
  newId: () => string,
): { project: Project; newId: string | null } {
  const scIndex = project.scenarios.findIndex((s) => s.id === scenarioId);
  if (scIndex === -1) {
    return { project, newId: null };
  }

  const origScenario = project.scenarios[scIndex]!;
  const allNames = project.scenarios.map((s) => s.name);
  const copyName = uniqueName(origScenario.name, allNames);
  const copyScenarioId = newId();

  const copyMocks = origScenario.mocks.map((m) => ({ ...m, id: newId() }));
  const copySockets = origScenario.sockets?.map((socket) => ({
    ...socket,
    id: newId(),
    onConnect: socket.onConnect.map((p) => ({ ...p, id: newId() })),
    replies: socket.replies.map((r) => ({
      ...r,
      id: newId(),
      pushes: r.pushes.map((p) => ({ ...p, id: newId() })),
    })),
  }));

  const copiedScenario: Scenario = {
    ...origScenario,
    id: copyScenarioId,
    name: copyName,
    mocks: copyMocks,
    ...(copySockets !== undefined ? { sockets: copySockets } : {}),
  };

  const updatedScenarios = [
    ...project.scenarios.slice(0, scIndex + 1).map((s) => ({
      ...s,
      mocks: [...s.mocks],
      sockets: s.sockets ? [...s.sockets] : undefined,
    })),
    copiedScenario,
    ...project.scenarios.slice(scIndex + 1).map((s) => ({
      ...s,
      mocks: [...s.mocks],
      sockets: s.sockets ? [...s.sockets] : undefined,
    })),
  ];

  return {
    project: {
      ...project,
      origins: [...project.origins],
      scenarios: updatedScenarios,
      activeScenarioId: project.activeScenarioId,
    },
    newId: copyScenarioId,
  };
}

/**
 * Appends a scenario at the end with uniqueName and new ids everywhere.
 * A scenario named "Default" becomes "Default (2)" and never goes into Default.
 * Active scenario does not change.
 * Pure function: does not modify inputs.
 */
export function addScenario(
  project: Project,
  scenario: Scenario,
  newId: () => string,
): Project {
  const allNames = project.scenarios.map((s) => s.name);
  let name = scenario.name;
  if (name === 'Default') {
    name = uniqueName('Default', ['Default', ...allNames]);
  } else {
    name = uniqueName(name, allNames);
  }

  const copyScenarioId = newId();
  const copyMocks = scenario.mocks.map((m) => ({ ...m, id: newId() }));
  const copySockets = scenario.sockets?.map((socket) => ({
    ...socket,
    id: newId(),
    onConnect: socket.onConnect.map((p) => ({ ...p, id: newId() })),
    replies: socket.replies.map((r) => ({
      ...r,
      id: newId(),
      pushes: r.pushes.map((p) => ({ ...p, id: newId() })),
    })),
  }));

  const addedScenario: Scenario = {
    ...scenario,
    id: copyScenarioId,
    name,
    mocks: copyMocks,
    ...(copySockets !== undefined ? { sockets: copySockets } : {}),
  };

  return {
    ...project,
    origins: [...project.origins],
    scenarios: [
      ...project.scenarios.map((s) => ({
        ...s,
        mocks: [...s.mocks],
        sockets: s.sockets ? [...s.sockets] : undefined,
      })),
      addedScenario,
    ],
    activeScenarioId: project.activeScenarioId,
  };
}
