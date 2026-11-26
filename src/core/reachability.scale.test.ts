// The "never answers" check at the size real projects reach: a few hundred to a thousand mocks.
import { describe, expect, it, vi } from 'vitest';
import { splitPattern } from './match';
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

// The real splitPattern, counted: how many times a pattern is read is the cost, and a count does
// not depend on how busy the machine is. A time limit did: 150 ms failed twice under other work.
vi.mock('./match', async (importOriginal) => {
  const real = await importOriginal<typeof import('./match')>();
  return { ...real, splitPattern: vi.fn(real.splitPattern) };
});

describe('unreachableMocks at scale', () => {
  const many = Array.from({ length: 900 }, (_, i) => mock(`i${i + 1}`, `/api/items/${i + 1}`));

  it('reads each of 900 patterns once, not once for every pair', () => {
    vi.mocked(splitPattern).mockClear();
    const result = unreachableMocks(many);
    expect(result.size).toBe(0);
    // Read once per pair, as before the fix, it was about 809,000 reads and 600 ms on a desktop.
    expect(vi.mocked(splitPattern)).toHaveBeenCalledTimes(900);
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
