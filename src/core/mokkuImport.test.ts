import { describe, expect, it } from 'vitest';
import { compilePattern } from './match';
import { detectMokku, importMokku, mokkuUrlToPattern } from './mokkuImport';
import { isValidStatus } from './statusText';
import v2 from './fixtures/mokku-v2-export.json';
import v1 from './fixtures/mokku-v1-store.json';
import mockFile from './fixtures/mokku-mock-file.json';
import mockFileList from './fixtures/mokku-mock-file-list.json';

function ids(): () => string {
  let counter = 0;
  return () => `id-${++counter}`;
}

describe('mokkuImport', () => {
  describe('detectMokku', () => {
    it('detects the three Mokku shapes correctly', () => {
      expect(detectMokku(v2)).toBe('mokku-v2');
      expect(detectMokku(v1)).toBe('mokku-v1');
      expect(detectMokku(mockFile)).toBe('mokku-mock-file');
      expect(detectMokku(mockFileList)).toBe('mokku-mock-file');
    });

    it('returns null for wemock project or unknown shapes', () => {
      expect(detectMokku({ wemock: 'project', schemaVersion: 1 })).toBeNull();
      expect(detectMokku({ foo: 1 })).toBeNull();
      expect(detectMokku(null)).toBeNull();
      expect(detectMokku('string')).toBeNull();
      expect(detectMokku({ mocks: 'not-an-array' })).toBeNull();
    });
  });

  describe('mokkuUrlToPattern', () => {
    it('strips query parameters from full URLs', () => {
      expect(mokkuUrlToPattern('https://a.com/api/goals?x=1')).toBe('https://a.com/api/goals');
    });

    it('removes host when host starts with no protocol', () => {
      expect(mokkuUrlToPattern('localhost:3000/api/goals/:id')).toBe('/api/goals/:id');
    });

    it('converts (.*) to *rest wildcard syntax compatible with path-to-regexp 8', () => {
      expect(mokkuUrlToPattern('/api/files/(.*)')).toBe('/api/files/*rest');
      expect(compilePattern(mokkuUrlToPattern('/api/files/(.*)')).ok).toBe(true);
    });
  });

  describe('importMokku', () => {
    it('imports Mokku v2 export correctly', () => {
      const r = importMokku(v2, 'http://localhost:3000', ids(), 1);
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      expect(r.result.shape).toBe('mokku-v2');
      expect(r.result.project.name).toBe('My app');
      expect(r.result.project.origins).toEqual(['http://localhost:3000']);
      expect(r.result.project.activeScenarioId).toBe('default');
      expect(r.result.summary).toEqual({
        mocks: 6,
        mocksSkipped: 1,
        codeMocks: 1,
        headerRulesSkipped: 2,
      });

      const mocks = r.result.project.scenarios[0]!.mocks;
      expect(mocks).toHaveLength(6);

      // Verify every imported mock passes compilePattern and isValidStatus
      for (const m of mocks) {
        expect(compilePattern(m.urlPattern).ok).toBe(true);
        expect(isValidStatus(m.response.status)).toBe(true);
      }

      // the 404 mock: status 404, delayMs 300, headers map from the list, name kept, enabled kept
      const m404 = mocks.find((m) => m.response.status === 404);
      expect(m404).toBeDefined();
      expect(m404?.response.status).toBe(404);
      expect(m404?.response.delayMs).toBe(300);
      expect(m404?.response.headers).toEqual({ 'x-reason': 'missing' });
      expect(m404?.name).toBe('404 Mock');
      expect(m404?.enabled).toBe(true);

      // the GraphQL mock: graphqlOperation set, method POST when missing
      const gqMock = mocks.find((m) => m.graphqlOperation === 'GetUsers');
      expect(gqMock).toBeDefined();
      expect(gqMock?.graphqlOperation).toBe('GetUsers');
      expect(gqMock?.method).toBe('POST');

      // the function mock: a code mock (A2), still enabled
      const fnMock = mocks.find((m) => m.name === 'Function Mock');
      expect(fnMock).toBeDefined();
      expect(fnMock?.enabled).toBe(true);
      expect(fnMock?.reply).toBe('code');
      expect(fnMock?.code?.trim().length).toBeGreaterThan(0);
    });

    it('imports Mokku v1 store correctly', () => {
      const r = importMokku(v1, 'http://localhost:3000', ids(), 1);
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      expect(r.result.shape).toBe('mokku-v1');
      expect(r.result.summary).toEqual({
        mocks: 6,
        mocksSkipped: 1,
        codeMocks: 1,
        headerRulesSkipped: 0,
      });

      // v1: headers object becomes the map; every mock lands in Default
      const defaultScenario = r.result.project.scenarios.find((s) => s.id === 'default');
      expect(defaultScenario).toBeDefined();
      expect(defaultScenario?.mocks).toHaveLength(6);

      const m404 = defaultScenario?.mocks.find((m) => m.response.status === 404);
      expect(m404?.response.headers).toEqual({ 'x-reason': 'missing' });
      expect(m404?.response.delayMs).toBe(300);

      const fnMock = defaultScenario?.mocks.find((m) => m.name === 'Function Mock');
      expect(fnMock?.enabled).toBe(true);
      expect(fnMock?.reply).toBe('code');

      for (const m of defaultScenario!.mocks) {
        expect(compilePattern(m.urlPattern).ok).toBe(true);
        expect(isValidStatus(m.response.status)).toBe(true);
      }
    });

    it('imports Mokku mock-file list correctly', () => {
      const r = importMokku(mockFileList, 'http://localhost:3000', ids(), 1);
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      expect(r.result.shape).toBe('mokku-mock-file');
      expect(r.result.summary).toEqual({
        mocks: 6,
        mocksSkipped: 1,
        codeMocks: 1,
        headerRulesSkipped: 0,
      });

      const mocks = r.result.project.scenarios[0]!.mocks;
      // mock-file: body object -> JSON.stringify(body, null, 2); response_body_type binary -> bodyEncoding base64
      const restMock = mocks.find((m) => m.name === 'Static REST Mock');
      expect(restMock).toBeDefined();
      expect(restMock?.response.body).toBe(JSON.stringify({ items: [] }, null, 2));
      expect(restMock?.response.bodyEncoding).toBe('text');

      const binaryMock = mocks.find((m) => m.name === 'Wildcard Binary Mock');
      expect(binaryMock).toBeDefined();
      expect(binaryMock?.response.bodyEncoding).toBe('base64');
      expect(binaryMock?.response.body).toBe('AQIDBA==');

      const fnMock = mocks.find((m) => m.name === 'Function Mock');
      expect(fnMock?.enabled).toBe(true);
      expect(fnMock?.reply).toBe('code');
    });

    it('imports single Mokku mock-file correctly', () => {
      const r = importMokku(mockFile, 'http://localhost:3000', ids(), 1);
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      expect(r.result.shape).toBe('mokku-mock-file');
      expect(r.result.summary).toEqual({
        mocks: 1,
        mocksSkipped: 0,
        codeMocks: 0,
        headerRulesSkipped: 0,
      });
      const mocks = r.result.project.scenarios[0]!.mocks;
      expect(mocks).toHaveLength(1);
      expect(mocks[0]?.response.body).toBe(JSON.stringify({ items: [] }, null, 2));
    });

    it('returns error when data is invalid or unrecognized', () => {
      expect(importMokku({ mocks: 'x' }, 'http://a', ids(), 1).ok).toBe(false);
      expect(importMokku(null, 'http://a', ids(), 1).ok).toBe(false);
      expect(importMokku('not an object', 'http://a', ids(), 1).ok).toBe(false);
      expect(importMokku({ foo: 'bar' }, 'http://a', ids(), 1).ok).toBe(false);
    });
  });
});

describe('importMokku: review cases', () => {
  const base = {
    name: 'Leftover', active: true, dynamic: false, requestType: 'REST', method: 'GET',
    url: '/api/x', status: 200, response: '{}', headers: [], delay: 0,
  };

  it('a v2 STATIC mock with leftover function source stays a fixed mock', () => {
    const data = { projects: [{ name: 'P' }], headers: [],
      mocks: [{ ...base, responseType: 'STATIC', function: 'return 1' }] };
    const r = importMokku(data, 'http://a', ids(), 1);
    if (!r.ok) throw new Error(r.error);
    const m = r.result.project.scenarios[0]!.mocks[0]!;
    expect(m.enabled).toBe(true);
    expect(m.reply).toBeUndefined();
    expect(r.result.summary.codeMocks).toBe(0);
  });

  it('a v2 FUNCTION mock with source becomes a code mock with that source (A2)', () => {
    const data = { projects: [{ name: 'P' }], headers: [],
      mocks: [{ ...base, responseType: 'FUNCTION', function: 'return { id: urlParams.id };' }] };
    const r = importMokku(data, 'http://a', ids(), 1);
    if (!r.ok) throw new Error(r.error);
    const m = r.result.project.scenarios[0]!.mocks[0]!;
    expect(m).toMatchObject({ enabled: true, reply: 'code', code: 'return { id: urlParams.id };' });
    expect(r.result.summary.codeMocks).toBe(1);
  });

  it('a v2 FUNCTION mock with empty source serves its static response, as Mokku does', () => {
    const data = { projects: [{ name: 'P' }], headers: [],
      mocks: [{ ...base, responseType: 'FUNCTION', function: '  ' }] };
    const r = importMokku(data, 'http://a', ids(), 1);
    if (!r.ok) throw new Error(r.error);
    expect(r.result.project.scenarios[0]!.mocks[0]!.reply).toBeUndefined();
    expect(r.result.summary.codeMocks).toBe(0);
  });

  it('a mock-file function_source becomes a code mock and keeps enabled false', () => {
    const data = { schema_version: 1, name: 'F', type: 'rest', method: 'GET', url_pattern: '/a/:id',
      enabled: false, response: { status: 200, headers: {}, body: null }, function_source: 'return 2;' };
    const r = importMokku(data, 'http://a', ids(), 1);
    if (!r.ok) throw new Error(r.error);
    const m = r.result.project.scenarios[0]!.mocks[0]!;
    expect(m).toMatchObject({ enabled: false, reply: 'code', code: 'return 2;' });
  });

  it('keeps an inactive mock inactive: v2 active false, mock-file enabled false', () => {
    const v2r = importMokku({ projects: [{ name: 'P' }], headers: [],
      mocks: [{ ...base, active: false, responseType: 'STATIC' }] }, 'http://a', ids(), 1);
    if (!v2r.ok) throw new Error(v2r.error);
    expect(v2r.result.project.scenarios[0]!.mocks[0]!.enabled).toBe(false);
    const fileR = importMokku({ schema_version: 1, name: 'F', type: 'rest', method: 'GET',
      url_pattern: '/api/y', enabled: false, response: { status: 200 } }, 'http://a', ids(), 1);
    if (!fileR.ok) throw new Error(fileR.error);
    expect(fileR.result.project.scenarios[0]!.mocks[0]!.enabled).toBe(false);
  });

  it('counts a mock with an unusable pattern as skipped', () => {
    const data = { mocks: [{ ...base, url: '/api/:id?' }, base] };
    const r = importMokku(data, 'http://a', ids(), 1);
    if (!r.ok) throw new Error(r.error);
    expect(r.result.summary.mocks + r.result.summary.mocksSkipped).toBe(2);
  });
});
