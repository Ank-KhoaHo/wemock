export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'ANY';

export type BodyEncoding = 'text' | 'base64';

export interface MockResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  bodyEncoding: BodyEncoding;
  delayMs: number;
}

/** A12: a sequence of responses served in order across calls. */
export interface MockSequence {
  steps: MockResponse[];
  after: 'stay' | 'loop';
}

/** A11: optional conditions that must hold for this mock to match. */
export interface MockMatch {
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
}

export interface Mock {
  id: string;
  name?: string;
  enabled: boolean;
  method: HttpMethod;
  urlPattern: string;
  graphqlOperation?: string;
  /** A11: conditions on query params, headers, or body. */
  match?: MockMatch;
  /**
   * A11: set by activeMocks (never stored) on Default's mocks while another scenario is active.
   * findMock tries the scenario's mocks first, then these, each with conditions first.
   */
  fromDefault?: true;
  response: MockResponse;
  /** A2: 'code' runs `code` in the sandbox; absent or 'fixed' serves `response`; 'sequence' serves `sequence`. */
  reply?: 'fixed' | 'code' | 'sequence';
  /** A2: the body of an async function. See core/handler.ts. */
  code?: string;
  /** A12: the sequence of responses when reply === 'sequence'. */
  sequence?: MockSequence;
  /** A13: fill {{...}} in a text body. */
  templates?: boolean;
  source: 'recorded' | 'manual';
  createdAt: number;
}

/** A5: one message the fake server sends. */
export interface SocketPush {
  id: string;
  afterMs: number;
  /** SignalR: the hub method the client receives. Plain sockets: unused. */
  target: string;
  /** SignalR: a JSON array of arguments. Plain sockets: the text frame. */
  data: string;
}

/** A5: how the fake server answers a client message. */
export interface SocketReply {
  id: string;
  /** SignalR: the hub method the client invokes. Plain: text the frame contains ('' = any). */
  when: string;
  /** A31 error = result is the error text; A32 stream = result is a JSON array of items. */
  respond: 'fixed' | 'code' | 'error' | 'stream';
  /** SignalR: JSON of the completion result ('' = none). Plain: text sent back ('' = none). */
  result: string;
  /** respond 'code': an async function body, run in the A2 sandbox. */
  code?: string;
  /** Sent after the reply, each `afterMs` after it. */
  pushes: SocketPush[];
}

/** A5: a mocked WebSocket. */
export interface SocketMock {
  id: string;
  name?: string;
  enabled: boolean;
  kind: 'signalr' | 'plain';
  urlPattern: string;
  /** Sent after the socket opens (SignalR: after the handshake). */
  onConnect: SocketPush[];
  replies: SocketReply[];
  createdAt: number;
}

export interface Scenario {
  id: string;
  name: string;
  mocks: Mock[];
  /** A5: socket mocks. Absent in files from before 1.2. */
  sockets?: SocketMock[];
}

export interface Project {
  id: string;
  name: string;
  origins: string[];
  scenarios: Scenario[];
  activeScenarioId: string; // scenarios[0] is Default
}

export interface Settings {
  enabled: boolean;
  recording: boolean;
  /** A4: one console line per mocked call. Absent means on. */
  consoleLog?: boolean;
}

export interface WemockState {
  schemaVersion: 1;
  settings: Settings;
  projects: Project[];
  enabledOrigins: string[];
}

export interface RequestFacts {
  method: string;
  url: string; // url absolute
  body?: string;
  headers?: Record<string, string>;
}

export type Badge = 'MOCK' | 'real' | 'LATE';

export interface LogEntry {
  id: string;
  method: string;
  url: string;
  requestBody?: string;
  status: number;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
  responseEncoding: BodyEncoding;
  truncated: boolean;
  durationMs: number;
  badge: Badge;
  mockId?: string;
  /** A2: a code mock failed and the call got the error reply. */
  error?: string;
  /** A6: ties the rows of one WebSocket connection together. */
  connectionId?: string;
  startedAt: number;
}

/** A6: message rows logged per socket connection, then one "not logged" row. */
export const SOCKET_LOG_CAP = 200;

export type LogDraft = Omit<LogEntry, 'id'>;

export const LOG_CAP = 500;
export const BODY_CAP_BYTES = 1_048_576;
export const GATE_TIMEOUT_MS = 200;
export const DEFAULT_SCENARIO_ID = 'default';
export const STATE_KEY = 'wemock.state';

export function emptyState(): WemockState {
  return {
    schemaVersion: 1,
    settings: { enabled: true, recording: true, consoleLog: true },
    projects: [],
    enabledOrigins: [],
  };
}

export function newProject(id: string, origin: string): Project {
  let name = origin;
  try {
    name = new URL(origin).host;
  } catch {
    // If origin is not a parseable URL, fall back to origin string
  }
  return {
    id,
    name,
    origins: [origin],
    scenarios: [
      {
        id: DEFAULT_SCENARIO_ID,
        name: 'Default',
        mocks: [],
      },
    ],
    activeScenarioId: DEFAULT_SCENARIO_ID,
  };
}
