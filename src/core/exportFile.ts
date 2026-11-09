import { isValidStatus } from './statusText';
import type { HttpMethod, Mock, MockResponse, Project, Scenario, WemockState } from './types';

const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ANY']);

function validateMockResponse(
  res: unknown,
): { ok: true; response: MockResponse } | { ok: false; error: string } {
  if (!res || typeof res !== 'object' || Array.isArray(res)) {
    return { ok: false, error: 'Mock response must be an object' };
  }
  const r = res as Record<string, unknown>;
  if (typeof r.status !== 'number' || !isValidStatus(r.status)) {
    return { ok: false, error: `Invalid mock response status: ${r.status}` };
  }
  if (!r.headers || typeof r.headers !== 'object' || Array.isArray(r.headers)) {
    return { ok: false, error: 'Mock response headers must be an object' };
  }
  for (const [k, v] of Object.entries(r.headers)) {
    if (typeof v !== 'string') {
      return { ok: false, error: `Mock response header ${k} value must be a string` };
    }
  }
  if (typeof r.body !== 'string') {
    return { ok: false, error: 'Mock response body must be a string' };
  }
  if (r.bodyEncoding !== 'text' && r.bodyEncoding !== 'base64') {
    return { ok: false, error: `Invalid mock response bodyEncoding: ${r.bodyEncoding}` };
  }
  if (typeof r.delayMs !== 'number' || Number.isNaN(r.delayMs) || r.delayMs < 0) {
    return { ok: false, error: `Invalid mock response delayMs: ${r.delayMs}` };
  }
  return {
    ok: true,
    response: {
      status: r.status,
      headers: r.headers as Record<string, string>,
      body: r.body,
      bodyEncoding: r.bodyEncoding,
      delayMs: r.delayMs,
    },
  };
}

function validateMock(mock: unknown): { ok: true; mock: Mock } | { ok: false; error: string } {
  if (!mock || typeof mock !== 'object' || Array.isArray(mock)) {
    return { ok: false, error: 'Mock must be an object' };
  }
  const m = mock as Record<string, unknown>;
  if (typeof m.id !== 'string' || !m.id) {
    return { ok: false, error: 'Mock must have a string id' };
  }
  if (m.name !== undefined && typeof m.name !== 'string') {
    return { ok: false, error: 'Mock name must be a string if defined' };
  }
  if (typeof m.enabled !== 'boolean') {
    return { ok: false, error: 'Mock enabled must be a boolean' };
  }
  if (typeof m.method !== 'string' || !VALID_METHODS.has(m.method.toUpperCase())) {
    return { ok: false, error: `Invalid mock method: ${m.method}` };
  }
  if (typeof m.urlPattern !== 'string') {
    return { ok: false, error: 'Mock urlPattern must be a string' };
  }
  if (m.graphqlOperation !== undefined && typeof m.graphqlOperation !== 'string') {
    return { ok: false, error: 'Mock graphqlOperation must be a string if defined' };
  }
  if (m.reply !== undefined && m.reply !== 'fixed' && m.reply !== 'code') {
    return { ok: false, error: `Invalid mock reply: ${String(m.reply)}` };
  }
  if (m.code !== undefined && typeof m.code !== 'string') {
    return { ok: false, error: 'Mock code must be a string if defined' };
  }
  if (m.source !== 'recorded' && m.source !== 'manual') {
    return { ok: false, error: `Invalid mock source: ${m.source}` };
  }
  if (typeof m.createdAt !== 'number' || Number.isNaN(m.createdAt)) {
    return { ok: false, error: 'Mock createdAt must be a number' };
  }
  const resValid = validateMockResponse(m.response);
  if (!resValid.ok) return resValid;

  return {
    ok: true,
    mock: {
      id: m.id,
      name: m.name as string | undefined,
      enabled: m.enabled,
      method: m.method.toUpperCase() as HttpMethod,
      urlPattern: m.urlPattern,
      graphqlOperation: m.graphqlOperation as string | undefined,
      response: resValid.response,
      ...(m.reply !== undefined ? { reply: m.reply as 'fixed' | 'code' } : {}),
      ...(typeof m.code === 'string' ? { code: m.code } : {}),
      source: m.source,
      createdAt: m.createdAt,
    },
  };
}

function validateScenario(
  scenario: unknown,
): { ok: true; scenario: Scenario } | { ok: false; error: string } {
  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) {
    return { ok: false, error: 'Scenario must be an object' };
  }
  const s = scenario as Record<string, unknown>;
  if (typeof s.id !== 'string' || !s.id) {
    return { ok: false, error: 'Scenario must have a string id' };
  }
  if (typeof s.name !== 'string') {
    return { ok: false, error: 'Scenario must have a string name' };
  }
  if (!Array.isArray(s.mocks)) {
    return { ok: false, error: 'Scenario mocks must be an array' };
  }
  const mocks: Mock[] = [];
  for (const m of s.mocks) {
    const valid = validateMock(m);
    if (!valid.ok) return valid;
    mocks.push(valid.mock);
  }
  return {
    ok: true,
    scenario: {
      id: s.id,
      name: s.name,
      mocks,
    },
  };
}

export function exportProject(p: Project): string {
  return JSON.stringify(
    {
      wemock: 'project',
      schemaVersion: 1,
      id: p.id,
      name: p.name,
      origins: p.origins,
      scenarios: p.scenarios,
      activeScenarioId: p.activeScenarioId,
    },
    null,
    2,
  );
}

export function parseProjectFile(
  text: string,
): { ok: true; project: Project } | { ok: false; error: string } {
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: 'Export file must be a JSON object' };
    }
    if (data.wemock !== 'project') {
      return { ok: false, error: 'Invalid or missing wemock discriminator' };
    }
    if (data.schemaVersion !== 1) {
      return { ok: false, error: `Unsupported schemaVersion: ${data.schemaVersion}` };
    }
    const projData =
      data.project && typeof data.project === 'object' && !Array.isArray(data.project)
        ? data.project
        : data;

    if (typeof projData.id !== 'string' || !projData.id) {
      return { ok: false, error: 'Project must have a string id' };
    }
    if (typeof projData.name !== 'string') {
      return { ok: false, error: 'Project must have a string name' };
    }
    if (
      !Array.isArray(projData.origins) ||
      !projData.origins.every((o: unknown) => typeof o === 'string')
    ) {
      return { ok: false, error: 'Project origins must be an array of strings' };
    }
    if (!Array.isArray(projData.scenarios) || projData.scenarios.length === 0) {
      return { ok: false, error: 'Project must have at least one scenario' };
    }
    const scenarios: Scenario[] = [];
    for (const sc of projData.scenarios) {
      const valid = validateScenario(sc);
      if (!valid.ok) return valid;
      scenarios.push(valid.scenario);
    }
    if (typeof projData.activeScenarioId !== 'string') {
      return { ok: false, error: 'Project activeScenarioId must be a string' };
    }
    if (!scenarios.some((s) => s.id === projData.activeScenarioId)) {
      return {
        ok: false,
        error: 'Project activeScenarioId does not match any scenario in project',
      };
    }

    return {
      ok: true,
      project: {
        id: projData.id,
        name: projData.name,
        origins: projData.origins,
        scenarios,
        activeScenarioId: projData.activeScenarioId,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to parse JSON',
    };
  }
}

export function importProject(
  state: WemockState,
  p: Project,
  newId: () => string,
): WemockState {
  const importedProject: Project = {
    ...p,
    id: newId(),
  };
  return {
    ...state,
    projects: [...state.projects, importedProject],
  };
}
