import { compilePattern, findMock } from './match';
import { negotiateBody } from './signalr';
import type { Mock, Project, RequestFacts, SocketMock } from './types';
import { DEFAULT_SCENARIO_ID } from './types';

// Spec A5. Which socket mock answers a WebSocket URL, and SignalR's negotiate call.

/** Socket mocks in effect: the active scenario's first, then Default's, like activeMocks. */
export function activeSockets(project: Project): SocketMock[] {
  const def = project.scenarios.find((s) => s.id === DEFAULT_SCENARIO_ID) ?? project.scenarios[0];
  const defSockets = def?.sockets ?? [];
  if (!def || project.activeScenarioId === def.id) return [...defSockets];
  const active = project.scenarios.find((s) => s.id === project.activeScenarioId);
  return active ? [...(active.sockets ?? []), ...defSockets] : [...defSockets];
}

/** ws: and wss: URLs compare like http: and https:, so one pattern serves both. */
export function toHttpUrl(url: URL): URL {
  const u = new URL(url.href);
  if (u.protocol === 'ws:') u.protocol = 'http:';
  else if (u.protocol === 'wss:') u.protocol = 'https:';
  return u;
}

export function normalizePattern(pattern: string): string {
  if (pattern.startsWith('ws://')) return `http://${pattern.slice(5)}`;
  if (pattern.startsWith('wss://')) return `https://${pattern.slice(6)}`;
  return pattern;
}

export function socketMatches(socket: SocketMock, url: URL): boolean {
  const compiled = compilePattern(normalizePattern(socket.urlPattern));
  return compiled.ok && compiled.test(toHttpUrl(url));
}

/** The first enabled socket mock for this URL, or null. */
export function findSocket(sockets: SocketMock[], url: string): SocketMock | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  for (const s of sockets) {
    if (s.enabled && socketMatches(s, u)) return s;
  }
  return null;
}

/** A SignalR socket mock whose hub this `POST <hub>/negotiate` call belongs to. */
export function negotiateSocket(sockets: SocketMock[], facts: RequestFacts): SocketMock | null {
  if (facts.method.toUpperCase() !== 'POST') return null;
  let u: URL;
  try {
    u = new URL(facts.url);
  } catch {
    return null;
  }
  if (!u.pathname.endsWith('/negotiate')) return null;
  u.pathname = u.pathname.slice(0, -'/negotiate'.length) || '/';
  u.search = '';
  for (const s of sockets) {
    if (s.enabled && s.kind === 'signalr' && socketMatches(s, u)) return s;
  }
  return null;
}

/** A fixed mock that answers the negotiate call for `socket`. */
export function negotiateMock(socket: SocketMock): Mock {
  return {
    id: socket.id,
    name: socket.name,
    enabled: true,
    method: 'POST',
    urlPattern: `${socket.urlPattern.replace(/\/$/, '')}/negotiate`,
    response: {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: negotiateBody(`wemock-${socket.id}`),
      bodyEncoding: 'text',
      delayMs: 0,
    },
    source: 'manual',
    createdAt: socket.createdAt,
  };
}

/** The page's choice for an HTTP call: the user's mocks first, then a SignalR negotiate. */
export function findAnyMock(mocks: Mock[], sockets: SocketMock[] | undefined, facts: RequestFacts): Mock | null {
  const m = findMock(mocks, facts);
  if (m) return m;
  const s = sockets ? negotiateSocket(sockets, facts) : null;
  return s ? negotiateMock(s) : null;
}
