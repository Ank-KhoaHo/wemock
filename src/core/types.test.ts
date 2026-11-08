import { describe, it, expect } from 'vitest';
import {
  emptyState,
  newProject,
  LOG_CAP,
  BODY_CAP_BYTES,
  GATE_TIMEOUT_MS,
  DEFAULT_SCENARIO_ID,
  STATE_KEY,
} from './types';

describe('types and state initialization', () => {
  it('defines exact constants', () => {
    expect(LOG_CAP).toBe(500);
    expect(BODY_CAP_BYTES).toBe(1_048_576);
    expect(GATE_TIMEOUT_MS).toBe(200);
    expect(DEFAULT_SCENARIO_ID).toBe('default');
    expect(STATE_KEY).toBe('wemock.state');
  });

  it('emptyState returns initial state', () => {
    const state = emptyState();
    expect(state).toEqual({
      schemaVersion: 1,
      settings: { enabled: true, recording: true },
      projects: [],
      enabledOrigins: [],
    });
  });

  it('newProject creates a project with host name and Default scenario', () => {
    const proj = newProject('p1', 'https://api.example.com');
    expect(proj.id).toBe('p1');
    expect(proj.name).toBe('api.example.com');
    expect(proj.origins).toEqual(['https://api.example.com']);
    expect(proj.activeScenarioId).toBe(DEFAULT_SCENARIO_ID);
    expect(proj.scenarios).toHaveLength(1);
    expect(proj.scenarios[0]).toEqual({
      id: DEFAULT_SCENARIO_ID,
      name: 'Default',
      mocks: [],
    });
  });

  it('newProject extracts host from origin with port', () => {
    const proj = newProject('p2', 'http://localhost:3000');
    expect(proj.name).toBe('localhost:3000');
    expect(proj.origins).toEqual(['http://localhost:3000']);
  });
});
