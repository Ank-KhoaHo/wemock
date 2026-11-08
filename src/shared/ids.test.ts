import { describe, expect, it } from 'vitest';
import { newId } from './ids';

describe('ids', () => {
  it('generates a valid UUID string', () => {
    const id = newId();
    expect(typeof id).toBe('string');
    // UUID v4 format regex
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(id).toMatch(uuidRegex);
  });

  it('generates unique IDs across calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(newId());
    }
    expect(ids.size).toBe(100);
  });
});
