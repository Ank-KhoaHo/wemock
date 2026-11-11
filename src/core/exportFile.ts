import { isValidStatus } from './statusText';
import type { HttpMethod, Mock, MockMatch, MockPatch, MockResponse, MockSequence, Project, Scenario, SocketMock, SocketPush, SocketReply, WemockState } from './types';

const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ANY']);

type Check<T> = { ok: true; value: T } | { ok: false; error: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function validateMatch(v: unknown): Check<MockMatch> {
  if (!isObj(v)) {
    return { ok: false, error: 'Mock match must be an object' };
  }
  let query: Record<string, string> | undefined;
  if (v.query !== undefined) {
    if (!isObj(v.query)) {
      return { ok: false, error: 'Mock match query must be an object' };
    }
    query = {};
    for (const [k, val] of Object.entries(v.query)) {
      if (typeof val !== 'string') {
        return { ok: false, error: `Mock match query ${k} value must be a string` };
      }
      query[k] = val;
    }
  }

  let headers: Record<string, string> | undefined;
  if (v.headers !== undefined) {
    if (!isObj(v.headers)) {
      return { ok: false, error: 'Mock match headers must be an object' };
    }
    headers = {};
    for (const [k, val] of Object.entries(v.headers)) {
      if (typeof val !== 'string') {
        return { ok: false, error: `Mock match header ${k} value must be a string` };
      }
      headers[k] = val;
    }
  }

  let body: string | undefined;
  if (v.body !== undefined) {
    if (typeof v.body !== 'string') {
      return { ok: false, error: 'Mock match body must be a string' };
    }
    body = v.body;
  }

  const out: MockMatch = {
    ...(query ? { query } : {}),
    ...(headers ? { headers } : {}),
    ...(body !== undefined ? { body } : {}),
  };
  return { ok: true, value: out };
}

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

function validateSequence(v: unknown): Check<MockSequence> {
  if (!isObj(v)) {
    return { ok: false, error: 'Mock sequence must be an object' };
  }
  if (v.after !== 'stay' && v.after !== 'loop') {
    return { ok: false, error: `Invalid sequence after: ${String(v.after)}` };
  }
  if (!Array.isArray(v.steps)) {
    return { ok: false, error: 'Sequence steps must be an array' };
  }
  const steps: MockResponse[] = [];
  for (const s of v.steps) {
    const res = validateMockResponse(s);
    if (!res.ok) return res;
    steps.push(res.response);
  }
  return {
    ok: true,
    value: {
      steps,
      after: v.after,
    },
  };
}

function validatePatch(v: unknown): Check<MockPatch> {
  if (!isObj(v)) {
    return { ok: false, error: 'Mock patch must be an object' };
  }
  let status: number | undefined;
  if (v.status !== undefined) {
    if (typeof v.status !== 'number' || !Number.isInteger(v.status) || v.status < 200 || v.status > 599) {
      return { ok: false, error: `Invalid mock patch status: ${String(v.status)}` };
    }
    status = v.status;
  }
  let headers: Record<string, string> | undefined;
  if (v.headers !== undefined) {
    if (!isObj(v.headers)) {
      return { ok: false, error: 'Mock patch headers must be an object' };
    }
    headers = {};
    for (const [k, val] of Object.entries(v.headers)) {
      if (typeof val !== 'string') {
        return { ok: false, error: `Mock patch header ${k} must be a string` };
      }
      headers[k] = val;
    }
  }
  let set: { path: string; value: string }[] | undefined;
  if (v.set !== undefined) {
    if (!Array.isArray(v.set)) {
      return { ok: false, error: 'Mock patch set must be an array' };
    }
    set = [];
    for (const item of v.set) {
      if (!isObj(item) || typeof item.path !== 'string' || typeof item.value !== 'string') {
        return { ok: false, error: 'Mock patch set item must have string path and value' };
      }
      set.push({ path: item.path, value: item.value });
    }
  }
  let remove: string[] | undefined;
  if (v.remove !== undefined) {
    if (!Array.isArray(v.remove)) {
      return { ok: false, error: 'Mock patch remove must be an array' };
    }
    remove = [];
    for (const item of v.remove) {
      if (typeof item !== 'string') {
        return { ok: false, error: 'Mock patch remove item must be a string' };
      }
      remove.push(item);
    }
  }
  const out: MockPatch = {
    ...(status !== undefined ? { status } : {}),
    ...(headers !== undefined ? { headers } : {}),
    ...(set !== undefined ? { set } : {}),
    ...(remove !== undefined ? { remove } : {}),
  };
  return { ok: true, value: out };
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
  if (m.reply !== undefined && m.reply !== 'fixed' && m.reply !== 'code' && m.reply !== 'sequence' && m.reply !== 'patch') {
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
  let match: MockMatch | undefined;
  if (m.match !== undefined) {
    const matchRes = validateMatch(m.match);
    if (!matchRes.ok) return matchRes;
    match = matchRes.value;
  }

  let sequence: MockSequence | undefined;
  if (m.sequence !== undefined) {
    const seqValid = validateSequence(m.sequence);
    if (!seqValid.ok) return seqValid;
    sequence = seqValid.value;
  }

  let patch: MockPatch | undefined;
  if (m.patch !== undefined) {
    const patchValid = validatePatch(m.patch);
    if (!patchValid.ok) return patchValid;
    patch = patchValid.value;
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
      ...(match !== undefined ? { match } : {}),
      response: resValid.response,
      ...(m.reply !== undefined ? { reply: m.reply as 'fixed' | 'code' | 'sequence' | 'patch' } : {}),
      ...(typeof m.code === 'string' ? { code: m.code } : {}),
      ...(sequence !== undefined ? { sequence } : {}),
      ...(patch !== undefined ? { patch } : {}),
      source: m.source,
      createdAt: m.createdAt,
    },
  };
}

function validatePushes(v: unknown, where: string): Check<SocketPush[]> {
  if (!Array.isArray(v)) return { ok: false, error: `${where} must be an array` };
  const out: SocketPush[] = [];
  for (const p of v) {
    if (!isObj(p) || typeof p.id !== 'string' || typeof p.target !== 'string' || typeof p.data !== 'string') {
      return { ok: false, error: `${where}: each message needs a string id, target and data` };
    }
    if (typeof p.afterMs !== 'number' || !Number.isFinite(p.afterMs) || p.afterMs < 0) {
      return { ok: false, error: `${where}: afterMs must be 0 or more` };
    }
    out.push({ id: p.id, afterMs: p.afterMs, target: p.target, data: p.data });
  }
  return { ok: true, value: out };
}

/** A5: a socket mock from a file. */
function validateSocket(v: unknown): Check<SocketMock> {
  if (!isObj(v)) return { ok: false, error: 'Socket must be an object' };
  if (typeof v.id !== 'string' || !v.id) return { ok: false, error: 'Socket must have a string id' };
  if (v.name !== undefined && typeof v.name !== 'string') return { ok: false, error: 'Socket name must be a string' };
  if (typeof v.enabled !== 'boolean') return { ok: false, error: 'Socket enabled must be a boolean' };
  if (v.kind !== 'signalr' && v.kind !== 'plain') return { ok: false, error: `Invalid socket kind: ${String(v.kind)}` };
  if (typeof v.urlPattern !== 'string') return { ok: false, error: 'Socket urlPattern must be a string' };
  if (typeof v.createdAt !== 'number') return { ok: false, error: 'Socket createdAt must be a number' };
  const onConnect = validatePushes(v.onConnect, 'Socket onConnect');
  if (!onConnect.ok) return onConnect;
  if (!Array.isArray(v.replies)) return { ok: false, error: 'Socket replies must be an array' };
  const replies: SocketReply[] = [];
  for (const r of v.replies) {
    if (!isObj(r) || typeof r.id !== 'string' || typeof r.when !== 'string' || typeof r.result !== 'string') {
      return { ok: false, error: 'Socket reply needs a string id, when and result' };
    }
    if (r.respond !== 'fixed' && r.respond !== 'code' && r.respond !== 'error' && r.respond !== 'stream') {
      return { ok: false, error: `Invalid socket reply respond: ${String(r.respond)}` };
    }
    if (r.code !== undefined && typeof r.code !== 'string') return { ok: false, error: 'Socket reply code must be a string' };
    const pushes = validatePushes(r.pushes, 'Socket reply pushes');
    if (!pushes.ok) return pushes;
    replies.push({
      id: r.id,
      when: r.when,
      respond: r.respond,
      result: r.result,
      ...(typeof r.code === 'string' ? { code: r.code } : {}),
      pushes: pushes.value,
    });
  }
  return {
    ok: true,
    value: {
      id: v.id,
      ...(typeof v.name === 'string' ? { name: v.name } : {}),
      enabled: v.enabled,
      kind: v.kind,
      urlPattern: v.urlPattern,
      onConnect: onConnect.value,
      replies,
      createdAt: v.createdAt,
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
  let sockets: SocketMock[] | undefined;
  if (s.sockets !== undefined) {
    if (!Array.isArray(s.sockets)) return { ok: false, error: 'Scenario sockets must be an array' };
    sockets = [];
    for (const raw of s.sockets) {
      const valid = validateSocket(raw);
      if (!valid.ok) return valid;
      sockets.push(valid.value);
    }
  }
  return {
    ok: true,
    scenario: {
      id: s.id,
      name: s.name,
      mocks,
      ...(sockets ? { sockets } : {}),
    },
  };
}

export function exportScenario(scenario: Scenario): string {
  return JSON.stringify(
    {
      wemock: 'scenario',
      schemaVersion: 1,
      scenario,
    },
    null,
    2,
  );
}

export function parseScenarioFile(
  text: string,
): { ok: true; scenario: Scenario } | { ok: false; error: string } {
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: 'Scenario export file must be a JSON object' };
    }
    if (data.wemock !== 'scenario') {
      return { ok: false, error: 'Invalid or missing wemock discriminator' };
    }
    if (data.schemaVersion !== 1) {
      return { ok: false, error: `Unsupported schemaVersion: ${data.schemaVersion}` };
    }
    if (!data.scenario || typeof data.scenario !== 'object' || Array.isArray(data.scenario)) {
      return { ok: false, error: 'Scenario must be an object' };
    }
    return validateScenario(data.scenario);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to parse JSON',
    };
  }
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
