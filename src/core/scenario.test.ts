import { describe, it, expect } from 'vitest';
import { activeMocks, projectForOrigin } from './scenario';
import type { WemockState, Mock } from './types';
import { DEFAULT_SCENARIO_ID, emptyState, newProject } from './types';

function createMock(id: string, name?: string): Mock {
  return {
    id,
    name,
    enabled: true,
    method: 'GET',
    urlPattern: `/${id}`,
    response: {
      status: 200,
      headers: {},
      body: '',
      bodyEncoding: 'text',
      delayMs: 0,
    },
    source: 'manual',
    createdAt: 1000,
  };
}

describe('scenario', () => {
  describe('activeMocks', () => {
    it('returns Default mocks once when active scenario is Default', () => {
      const proj = newProject('p1', 'https://example.com');
      const m1 = createMock('m1');
      const m2 = createMock('m2');
      proj.scenarios[0]!.mocks = [m1, m2];
      proj.activeScenarioId = DEFAULT_SCENARIO_ID;

      const mocks = activeMocks(proj);
      expect(mocks).toEqual([m1, m2]);
    });

    it('returns active scenario mocks first, then Default mocks', () => {
      const proj = newProject('p1', 'https://example.com');
      const defMock1 = createMock('def1');
      const defMock2 = createMock('def2');
      proj.scenarios[0]!.mocks = [defMock1, defMock2];

      const errMock = createMock('err1');
      proj.scenarios.push({
        id: 'scenario-500',
        name: '500 error',
        mocks: [errMock],
      });
      proj.activeScenarioId = 'scenario-500';

      const mocks = activeMocks(proj);
      // A11: Default's mocks carry fromDefault while another scenario is active.
      expect(mocks).toEqual([errMock, { ...defMock1, fromDefault: true }, { ...defMock2, fromDefault: true }]);
    });

    it('falls back to Default mocks if activeScenarioId is not found', () => {
      const proj = newProject('p1', 'https://example.com');
      const defMock = createMock('def1');
      proj.scenarios[0]!.mocks = [defMock];
      proj.activeScenarioId = 'non-existent';

      const mocks = activeMocks(proj);
      expect(mocks).toEqual([defMock]);
    });
  });

  describe('projectForOrigin', () => {
    it('matches exact origin strings', () => {
      const state: WemockState = {
        ...emptyState(),
        projects: [
          {
            ...newProject('p1', 'https://a.com'),
            origins: ['https://a.com', 'http://localhost:3000'],
          },
          {
            ...newProject('p2', 'https://b.com'),
            origins: ['https://b.com'],
          },
        ],
      };

      expect(projectForOrigin(state, 'https://a.com')?.id).toBe('p1');
      expect(projectForOrigin(state, 'http://localhost:3000')?.id).toBe('p1');
      expect(projectForOrigin(state, 'https://b.com')?.id).toBe('p2');
      expect(projectForOrigin(state, 'https://a.com/')).toBeNull(); // exact match, trailing slash does not match
      expect(projectForOrigin(state, 'https://c.com')).toBeNull();
    });
  });
});
