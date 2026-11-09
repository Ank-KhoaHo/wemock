import { findMock } from './match';
import { activeMocks } from './scenario';
import type { Mock, Project } from './types';
import { DEFAULT_SCENARIO_ID } from './types';

export interface TestCallInput {
  method: string;
  url: string;
  body?: string;
  headers?: Record<string, string>;
}

export type TestCallResult =
  | { ok: false; error: string }
  | { ok: true; url: string; mock: Mock | null; scenarioName: string | null };

export function testCall(
  project: Project,
  input: TestCallInput,
  pageOrigin: string,
): TestCallResult {
  if (!input.url.trim()) {
    return { ok: false, error: 'Type a URL' };
  }

  let resolvedUrl: URL;
  try {
    resolvedUrl = new URL(input.url, pageOrigin);
  } catch {
    return { ok: false, error: 'Not a valid URL' };
  }

  const mocks = activeMocks(project);
  const matched = findMock(mocks, {
    method: input.method.toUpperCase(),
    url: resolvedUrl.href,
    body: input.body,
    headers: input.headers,
  });

  if (!matched) {
    return {
      ok: true,
      url: resolvedUrl.href,
      mock: null,
      scenarioName: null,
    };
  }

  const activeScenario = project.scenarios.find((s) => s.id === project.activeScenarioId);
  const defaultScenario =
    project.scenarios.find((s) => s.id === DEFAULT_SCENARIO_ID) ?? project.scenarios[0];

  let scenarioName: string | null = null;
  if (activeScenario && activeScenario.mocks.some((m) => m.id === matched.id)) {
    scenarioName = activeScenario.name;
  } else if (defaultScenario && defaultScenario.mocks.some((m) => m.id === matched.id)) {
    scenarioName = defaultScenario.name;
  } else {
    const holding = project.scenarios.find((sc) => sc.mocks.some((m) => m.id === matched.id));
    scenarioName = holding ? holding.name : null;
  }

  return {
    ok: true,
    url: resolvedUrl.href,
    mock: matched,
    scenarioName,
  };
}
