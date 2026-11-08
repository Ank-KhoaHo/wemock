import { describe, it, expect } from 'vitest';
import { compilePattern, findMock } from './match';
import type { Mock, RequestFacts } from './types';

function mock(partial: Partial<Mock>): Mock {
  return {
    id: 'm1',
    enabled: true,
    method: 'GET',
    urlPattern: '/x',
    response: {
      status: 200,
      headers: {},
      body: '',
      bodyEncoding: 'text',
      delayMs: 0,
    },
    source: 'manual',
    createdAt: Date.now(),
    ...partial,
  };
}

function get(pathOrUrl: string): RequestFacts {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `https://a.com${pathOrUrl}`;
  return { method: 'GET', url };
}

function post(pathOrUrl: string, body?: string): RequestFacts {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `https://a.com${pathOrUrl}`;
  return { method: 'POST', url, body };
}

describe('match', () => {
  it('compiles patterns correctly and handles invalid patterns without throwing', () => {
    expect(compilePattern('/api/goals/:id').ok).toBe(true);
    expect(compilePattern('/api/(').ok).toBe(false); // Review Focus 2
  });

  it('matches method and url ignoring query string', () => {
    const m = mock({ method: 'GET', urlPattern: '/api/goals/:id' });
    expect(findMock([m], { method: 'GET', url: 'https://a.com/api/goals/7?x=1' })).toBe(m); // query ignored
    expect(findMock([m], { method: 'POST', url: 'https://a.com/api/goals/7' })).toBeNull();
  });

  it('matches ANY method to any HTTP method', () => {
    expect(findMock([mock({ method: 'ANY', urlPattern: '/x' })], { method: 'DELETE', url: 'https://a.com/x' })).not.toBeNull();
  });

  it('matches method case-insensitively', () => {
    const m = mock({ method: 'GET', urlPattern: '/x' });
    expect(findMock([m], { method: 'get', url: 'https://a.com/x' })).toBe(m);
  });

  it('enforces origin match when pattern includes origin', () => {
    const hosted = mock({ urlPattern: 'https://api.b.com/x' });
    expect(findMock([hosted], { method: 'GET', url: 'https://api.c.com/x' })).toBeNull();
    expect(findMock([hosted], { method: 'GET', url: 'https://api.b.com/x' })).toBe(hosted);
  });

  it('skips invalid patterns without throwing and continues to next mock', () => {
    const bad = mock({ urlPattern: '/api/(' });
    const good = mock({ urlPattern: '/api/z' });
    expect(findMock([bad, good], { method: 'GET', url: 'https://a.com/api/z' })).toBe(good);
  });

  it('skips disabled mocks', () => {
    expect(findMock([mock({ enabled: false, urlPattern: '/x' })], get('/x'))).toBeNull();
  });

  it('picks first match in list order', () => {
    const first = mock({ urlPattern: '/x' });
    const second = mock({ urlPattern: '/x' });
    expect(findMock([first, second], get('/x'))).toBe(first); // list order
  });

  it('matches graphqlOperation in request body', () => {
    const gq = mock({ method: 'POST', urlPattern: '/graphql', graphqlOperation: 'GetMe' });
    expect(findMock([gq], post('/graphql', '{"operationName":"GetMe"}'))).toBe(gq);
    expect(findMock([gq], post('/graphql', '{"operationName":"Other"}'))).toBeNull();
  });

  it('returns null when request url is invalid', () => {
    const m = mock({ urlPattern: '/x' });
    expect(findMock([m], { method: 'GET', url: 'not-a-valid-url' })).toBeNull();
  });

  it('supports path-to-regexp wildcards with *name syntax', () => {
    const wildcard = mock({ urlPattern: '/static/*path' });
    expect(findMock([wildcard], get('/static/css/app.css'))).toBe(wildcard);
  });
});
