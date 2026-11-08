import { describe, expect, it } from 'vitest';
import { exportProject, parseProjectFile, importProject } from './exportFile';
import { emptyState, type Project } from './types';

function createSampleProject(): Project {
  return {
    id: 'proj-1',
    name: 'sample.app',
    origins: ['https://sample.app'],
    scenarios: [
      {
        id: 'default',
        name: 'Default',
        mocks: [
          {
            id: 'mock-1',
            name: 'Get User',
            enabled: true,
            method: 'GET',
            urlPattern: '/api/user',
            response: {
              status: 200,
              headers: { 'content-type': 'application/json' },
              body: '{"id":1,"name":"Alice"}',
              bodyEncoding: 'text',
              delayMs: 150,
            },
            source: 'manual',
            createdAt: 123456,
          },
        ],
      },
    ],
    activeScenarioId: 'default',
  };
}

describe('exportFile', () => {
  describe('exportProject and parseProjectFile', () => {
    it('exports and parses back a valid project file', () => {
      const p = createSampleProject();
      const exported = exportProject(p);

      const parsed = parseProjectFile(exported);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.project).toEqual(p);
      }
    });

    it('rejects invalid JSON', () => {
      const res = parseProjectFile('not json');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeDefined();
      }
    });

    it('rejects unsupported schemaVersion', () => {
      const res = parseProjectFile('{"wemock":"project","schemaVersion":2}');
      expect(res.ok).toBe(false);
    });

    it('rejects unrecognized JSON object without wemock discriminator', () => {
      const res = parseProjectFile('{"foo":1}');
      expect(res.ok).toBe(false);
    });

    it('rejects non-object JSON values like numbers or arrays', () => {
      expect(parseProjectFile('123').ok).toBe(false);
      expect(parseProjectFile('[]').ok).toBe(false);
      expect(parseProjectFile('null').ok).toBe(false);
    });

    it('rejects project missing required fields', () => {
      expect(parseProjectFile('{"wemock":"project","schemaVersion":1}').ok).toBe(false);
      expect(
        parseProjectFile(
          JSON.stringify({
            wemock: 'project',
            schemaVersion: 1,
            id: 'p1',
            name: 'P1',
            origins: ['https://a.com'],
            scenarios: [],
            activeScenarioId: 'default',
          }),
        ).ok,
      ).toBe(false);
    });

    it('rejects mock with non-number status', () => {
      const p = createSampleProject();
      const json = JSON.parse(exportProject(p));
      json.scenarios[0].mocks[0].response.status = '200'; // string instead of number
      const res = parseProjectFile(JSON.stringify(json));
      expect(res.ok).toBe(false);
    });

    it('rejects mock with invalid status outside 200..599 (e.g. 101, 600)', () => {
      const p = createSampleProject();
      const json = JSON.parse(exportProject(p));
      json.scenarios[0].mocks[0].response.status = 101;
      expect(parseProjectFile(JSON.stringify(json)).ok).toBe(false);

      json.scenarios[0].mocks[0].response.status = 600;
      expect(parseProjectFile(JSON.stringify(json)).ok).toBe(false);
    });

    it('rejects mock with invalid bodyEncoding', () => {
      const p = createSampleProject();
      const json = JSON.parse(exportProject(p));
      json.scenarios[0].mocks[0].response.bodyEncoding = 'unknown';
      expect(parseProjectFile(JSON.stringify(json)).ok).toBe(false);
    });

    it('rejects mock with invalid HTTP method', () => {
      const p = createSampleProject();
      const json = JSON.parse(exportProject(p));
      json.scenarios[0].mocks[0].method = 'INVALID';
      expect(parseProjectFile(JSON.stringify(json)).ok).toBe(false);
    });

    it('rejects mock with invalid source', () => {
      const p = createSampleProject();
      const json = JSON.parse(exportProject(p));
      json.scenarios[0].mocks[0].source = 'other';
      expect(parseProjectFile(JSON.stringify(json)).ok).toBe(false);
    });

    it('never throws regardless of malformed structure', () => {
      const badInputs = [
        '',
        '{',
        'undefined',
        JSON.stringify({ wemock: 'project', schemaVersion: 1, scenarios: 'not-array' }),
        JSON.stringify({ wemock: 'project', schemaVersion: 1, scenarios: [{ mocks: null }] }),
      ];
      for (const input of badInputs) {
        expect(() => parseProjectFile(input)).not.toThrow();
        expect(parseProjectFile(input).ok).toBe(false);
      }
    });
  });

  describe('importProject', () => {
    it('gives the project a new id and keeps the rest', () => {
      const state = emptyState();
      const p = createSampleProject();
      const newState = importProject(state, p, () => 'new-project-id');

      expect(newState.projects).toHaveLength(1);
      const imported = newState.projects[0];
      expect(imported).toBeDefined();
      if (imported) {
        expect(imported.id).toBe('new-project-id');
        expect(imported.name).toBe(p.name);
        expect(imported.origins).toEqual(p.origins);
        expect(imported.scenarios).toEqual(p.scenarios);
        expect(imported.activeScenarioId).toBe(p.activeScenarioId);
      }
    });
  });
});
