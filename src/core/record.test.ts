import { describe, expect, it } from 'vitest';
import { mockFromLog, scenarioFromLogs, ensureProject } from './record';
import { emptyState, type LogEntry } from './types';

function createLogEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: 'log-1',
    method: 'GET',
    url: 'https://a.com/api/goals?page=2',
    status: 200,
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: '{"a":1}',
    responseEncoding: 'text',
    truncated: false,
    durationMs: 42,
    badge: 'real',
    startedAt: 1000,
    ...overrides,
  };
}

describe('record', () => {
  describe('mockFromLog', () => {
    it('creates a mock from a log entry with stripped query parameters and filtered headers', () => {
      const entry = createLogEntry({
        url: 'https://a.com/api/goals?page=2',
        status: 200,
        responseHeaders: {
          'content-type': 'application/json',
          'content-length': '9',
          'content-encoding': 'gzip',
          'set-cookie': 'a=b',
          'transfer-encoding': 'chunked',
        },
        responseBody: '{"a":1}',
      });

      const mk = mockFromLog(entry, 'id1', 5);
      expect(mk.id).toBe('id1');
      expect(mk.urlPattern).toBe('/api/goals');
      expect(mk.response.headers).toEqual({ 'content-type': 'application/json' });
      expect(mk).toMatchObject({ source: 'recorded', enabled: true, createdAt: 5 });
      expect(mk.response.delayMs).toBe(0);
      expect(mk.response.status).toBe(200);
      expect(mk.response.body).toBe('{"a":1}');
      expect(mk.response.bodyEncoding).toBe('text');
    });

    it('sets graphqlOperation when requestBody has operationName', () => {
      const entry = createLogEntry({
        method: 'POST',
        url: 'https://a.com/graphql',
        requestBody: JSON.stringify({ operationName: 'GetGoals', query: 'query GetGoals { goals { id } }' }),
      });

      const mk = mockFromLog(entry, 'id2', 10);
      expect(mk.graphqlOperation).toBe('GetGoals');
    });

    it('leaves graphqlOperation undefined when requestBody is not GraphQL', () => {
      const entry = createLogEntry({
        method: 'POST',
        url: 'https://a.com/api/echo',
        requestBody: '{"not":"graphql"}',
      });

      const mk = mockFromLog(entry, 'id3', 10);
      expect(mk.graphqlOperation).toBeUndefined();
    });

    it('throws when log entry is truncated', () => {
      const entry = createLogEntry({ truncated: true, responseBody: null });
      expect(() => mockFromLog(entry, 'id-trunc', 10)).toThrow(/truncated/i);
    });

    it('preserves base64 responseEncoding', () => {
      const entry = createLogEntry({
        responseBody: 'iVBORw0KGgoAAAANSUhEUg==',
        responseEncoding: 'base64',
      });
      const mk = mockFromLog(entry, 'id-b64', 10);
      expect(mk.response.bodyEncoding).toBe('base64');
      expect(mk.response.body).toBe('iVBORw0KGgoAAAANSUhEUg==');
    });
  });

  describe('scenarioFromLogs', () => {
    it('creates a scenario, deduping method + URL keeping the later startedAt body', () => {
      let idCounter = 1;
      const newId = () => `id-${idCounter++}`;

      const entries: LogEntry[] = [
        createLogEntry({
          id: 'log-1',
          method: 'GET',
          url: 'https://a.com/api/x',
          responseBody: 'first',
          startedAt: 100,
        }),
        createLogEntry({
          id: 'log-2',
          method: 'GET',
          url: 'https://a.com/api/x',
          responseBody: 'second',
          startedAt: 200,
        }),
      ];

      const scenario = scenarioFromLogs(entries, 'My Scenario', newId, 500);
      expect(scenario.id).toBe('id-1');
      expect(scenario.name).toBe('My Scenario');
      expect(scenario.mocks).toHaveLength(1);
      const firstMock = scenario.mocks[0];
      expect(firstMock).toBeDefined();
      if (firstMock) {
        expect(firstMock.response.body).toBe('second');
        expect(firstMock.urlPattern).toBe('/api/x');
      }
    });

    it('skips truncated entries and MOCK-badged entries', () => {
      let idCounter = 1;
      const newId = () => `id-${idCounter++}`;

      const entries: LogEntry[] = [
        createLogEntry({ id: '1', url: 'https://a.com/a', truncated: true }),
        createLogEntry({ id: '2', url: 'https://a.com/b', badge: 'MOCK' }),
        createLogEntry({ id: '3', url: 'https://a.com/c', badge: 'real', responseBody: 'real-body' }),
        createLogEntry({ id: '4', url: 'https://a.com/d', badge: 'LATE', responseBody: 'late-body' }),
      ];

      const scenario = scenarioFromLogs(entries, 'Filtered', newId, 100);
      expect(scenario.mocks).toHaveLength(2);
      expect(scenario.mocks.map((m) => m.urlPattern)).toEqual(['/c', '/d']);
    });

    it('produces a base64 mock from a base64 entry', () => {
      const newId = () => 'id-b64';
      const entries: LogEntry[] = [
        createLogEntry({
          url: 'https://a.com/logo.png',
          responseBody: 'base64data',
          responseEncoding: 'base64',
          responseHeaders: { 'content-type': 'image/png' },
        }),
      ];

      const scenario = scenarioFromLogs(entries, 'PNG Scenario', newId, 100);
      const firstMock = scenario.mocks[0];
      expect(firstMock).toBeDefined();
      if (firstMock) {
        expect(firstMock.response.bodyEncoding).toBe('base64');
        expect(firstMock.response.body).toBe('base64data');
      }
    });
  });

  describe('ensureProject', () => {
    it('creates a new project when no project matches the origin', () => {
      const state = emptyState();
      const { state: nextState, project } = ensureProject(state, 'https://example.com', () => 'proj-1');

      expect(project.id).toBe('proj-1');
      expect(project.origins).toEqual(['https://example.com']);
      expect(project.name).toBe('example.com');
      expect(nextState.projects).toHaveLength(1);
      expect(nextState.projects[0]).toBe(project);
    });

    it('returns the existing project unchanged when a project matches the origin', () => {
      const state = emptyState();
      const { state: stateWithProj, project: existingProj } = ensureProject(state, 'https://example.com', () => 'proj-1');

      const { state: stateAfter, project: foundProj } = ensureProject(stateWithProj, 'https://example.com', () => 'proj-2');

      expect(foundProj).toBe(existingProj);
      expect(foundProj.id).toBe('proj-1');
      expect(stateAfter.projects).toHaveLength(1);
      expect(stateAfter).toBe(stateWithProj);
    });
  });
});

describe('record: rows that cannot become mocks (review)', () => {
  it('mockFromLog throws on status 0 (network error or blocked call)', () => {
    expect(() => mockFromLog(createLogEntry({ status: 0 }), 'id', 1)).toThrow();
  });

  it('scenarioFromLogs skips rows whose status is not 200-599', () => {
    let n = 0;
    const s = scenarioFromLogs(
      [
        createLogEntry({ url: 'https://a.com/bad', status: 0, startedAt: 1 }),
        createLogEntry({ url: 'https://a.com/good', status: 200, startedAt: 2 }),
      ],
      'S',
      () => `id${n++}`,
      1,
    );
    expect(s.mocks.map((m) => m.urlPattern)).toEqual(['/good']);
  });
});
