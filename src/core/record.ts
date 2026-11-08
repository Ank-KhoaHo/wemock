import { operationName } from './graphql';
import { projectForOrigin } from './scenario';
import { isValidStatus } from './statusText';
import {
  type HttpMethod,
  type LogEntry,
  type Mock,
  type MockResponse,
  newProject,
  type Project,
  type Scenario,
  type WemockState,
} from './types';

const DROPPED_HEADERS = new Set([
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'set-cookie',
]);

function extractPathname(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname || '/';
  } catch {
    const path = url.split('?')[0];
    return path || '/';
  }
}

export function mockFromLog(entry: LogEntry, id: string, now: number): Mock {
  if (entry.truncated) {
    throw new Error('Cannot create mock from truncated log entry');
  }
  if (!isValidStatus(entry.status)) {
    throw new Error(`Cannot create mock from status ${entry.status}`);
  }

  const urlPattern = extractPathname(entry.url);

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(entry.responseHeaders)) {
    const lowerKey = key.toLowerCase();
    if (!DROPPED_HEADERS.has(lowerKey)) {
      headers[lowerKey] = value;
    }
  }

  const op = operationName(entry.requestBody);

  const response: MockResponse = {
    status: entry.status,
    headers,
    body: entry.responseBody ?? '',
    bodyEncoding: entry.responseEncoding,
    delayMs: 0,
  };

  const mock: Mock = {
    id,
    enabled: true,
    method: entry.method.toUpperCase() as HttpMethod,
    urlPattern,
    ...(op ? { graphqlOperation: op } : {}),
    response,
    source: 'recorded',
    createdAt: now,
  };

  return mock;
}

export function scenarioFromLogs(
  entries: LogEntry[],
  name: string,
  newId: () => string,
  now: number,
): Scenario {
  const latestByKey = new Map<string, LogEntry>();
  const keyOrder: string[] = [];

  for (const entry of entries) {
    if (entry.truncated || entry.badge === 'MOCK' || !isValidStatus(entry.status)) continue;

    const op = operationName(entry.requestBody);
    const pattern = extractPathname(entry.url);
    const key = `${entry.method.toUpperCase()}|${pattern}|${op ?? ''}`;

    const existing = latestByKey.get(key);
    if (!existing) {
      keyOrder.push(key);
      latestByKey.set(key, entry);
    } else if (entry.startedAt >= existing.startedAt) {
      latestByKey.set(key, entry);
    }
  }

  const scenarioId = newId();
  const mocks: Mock[] = keyOrder.map((key) => {
    const entry = latestByKey.get(key);
    if (!entry) {
      throw new Error(`Missing entry for key ${key}`);
    }
    return mockFromLog(entry, newId(), now);
  });

  return {
    id: scenarioId,
    name,
    mocks,
  };
}

export function ensureProject(
  state: WemockState,
  origin: string,
  newId: () => string,
): { state: WemockState; project: Project } {
  const existing = projectForOrigin(state, origin);
  if (existing) {
    return { state, project: existing };
  }

  const project = newProject(newId(), origin);
  const nextState: WemockState = {
    ...state,
    projects: [...state.projects, project],
  };

  return { state: nextState, project };
}
