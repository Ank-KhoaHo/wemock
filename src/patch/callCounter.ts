import type { Mock } from '../core/types';

export interface CallCounter {
  next(mock: Mock, listKey: string): number;
}

/**
 * A12: Counts calls per mock id.
 * A mock whose content (JSON.stringify of the mock) changed starts at 1 again.
 * When listKey differs from the previous call's, every count starts over.
 */
export function createCallCounter(): CallCounter {
  let lastListKey: string | null = null;
  const counts = new Map<string, number>();
  const mockContents = new Map<string, string>();

  return {
    next(mock: Mock, listKey: string): number {
      if (lastListKey !== null && listKey !== lastListKey) {
        counts.clear();
        mockContents.clear();
      }
      lastListKey = listKey;

      const content = JSON.stringify(mock);
      if (mockContents.get(mock.id) !== content) {
        mockContents.set(mock.id, content);
        counts.set(mock.id, 0);
      }

      const nextCount = (counts.get(mock.id) ?? 0) + 1;
      counts.set(mock.id, nextCount);
      return nextCount;
    },
  };
}
