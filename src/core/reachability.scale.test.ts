// The "never answers" check at the size real projects reach: a few hundred to a thousand mocks.
import { describe, expect, it } from 'vitest';
import { unreachableMocks } from './reachability';
import type { Mock } from './types';

function mock(id: string, urlPattern: string, method: Mock['method'] = 'GET'): Mock {
  return {
    id,
    enabled: true,
    method,
    urlPattern,
    response: { status: 200, headers: {}, body: '', bodyEncoding: 'text', delayMs: 0 },
    source: 'recorded',
    createdAt: 0,
  };
}

describe('unreachableMocks at scale', () => {
  const many = Array.from({ length: 900 }, (_, i) => mock(`i${i + 1}`, `/api/items/${i + 1}`));

  it('checks 900 distinct mocks in well under a frame budget', () => {
    unreachableMocks(many); // warm up
    const t0 = performance.now();
    const result = unreachableMocks(many);
    const ms = performance.now() - t0;
    expect(result.size).toBe(0);
    // Before parsing each pattern once, this took about 600 ms on a desktop.
    expect(ms).toBeLessThan(150);
  });

  it('still finds a mock hidden by a wider one far above it, among 900', () => {
    const list = [mock('wide', '/api/items/:n'), ...many];
    const result = unreachableMocks(list);
    expect(result.size).toBe(900);
    expect(result.get('i900')).toEqual({ byId: 'wide', reason: 'Never answers: /api/items/:n above catches all its calls' });
  });

  it('a wider mock below the narrow ones hides nothing', () => {
    const list = [...many, mock('wide', '/api/items/:n')];
    expect(unreachableMocks(list).size).toBe(0);
  });
});
