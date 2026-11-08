export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'ANY';

export type BodyEncoding = 'text' | 'base64';

export interface MockResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  bodyEncoding: BodyEncoding;
  delayMs: number;
}

export interface Mock {
  id: string;
  name?: string;
  enabled: boolean;
  method: HttpMethod;
  urlPattern: string;
  graphqlOperation?: string;
  response: MockResponse;
  source: 'recorded' | 'manual';
  createdAt: number;
}

export interface Scenario {
  id: string;
  name: string;
  mocks: Mock[];
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
  startedAt: number;
}

export type LogDraft = Omit<LogEntry, 'id'>;

export const LOG_CAP = 500;
export const BODY_CAP_BYTES = 1_048_576;
export const GATE_TIMEOUT_MS = 200;
export const DEFAULT_SCENARIO_ID = 'default';
export const STATE_KEY = 'wemock.state';

export function emptyState(): WemockState {
  return {
    schemaVersion: 1,
    settings: { enabled: true, recording: true },
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
