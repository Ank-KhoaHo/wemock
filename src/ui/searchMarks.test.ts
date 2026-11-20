import { SearchQuery } from '@codemirror/search';
import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { activeIndex, countLabel, findMatches, MAX_MATCHES } from './searchMarks';

const state = (doc: string) => EditorState.create({ doc });

describe('findMatches', () => {
  it('finds every match in order', () => {
    const matches = findMatches(state('a1 b a2 a3'), new SearchQuery({ search: 'a' }));
    expect(matches).toEqual({ list: [{ from: 0, to: 1 }, { from: 5, to: 6 }, { from: 8, to: 9 }], capped: false });
  });

  it('stops counting at the cap', () => {
    const matches = findMatches(state('x'.repeat(MAX_MATCHES + 5)), new SearchQuery({ search: 'x' }));
    expect(matches.list).toHaveLength(MAX_MATCHES);
    expect(matches.capped).toBe(true);
  });

  it('finds nothing for an empty search or a broken regexp', () => {
    expect(findMatches(state('abc'), new SearchQuery({ search: '' })).list).toEqual([]);
    expect(findMatches(state('a(b'), new SearchQuery({ search: '(', regexp: true })).list).toEqual([]);
  });
});

describe('activeIndex', () => {
  it('is the match the selection covers, or -1', () => {
    const matches = findMatches(state('ab ab ab'), new SearchQuery({ search: 'ab' }));
    expect(activeIndex(matches, EditorSelection.range(3, 5))).toBe(1);
    expect(activeIndex(matches, EditorSelection.cursor(4))).toBe(-1);
  });
});

describe('countLabel', () => {
  const two = { list: [{ from: 0, to: 1 }, { from: 2, to: 3 }], capped: false };

  it('shows the active match out of the total', () => {
    expect(countLabel(two, 1)).toBe('2 of 2');
    expect(countLabel(two, -1)).toBe('? of 2');
  });

  it('says when there is nothing, or more than the cap', () => {
    expect(countLabel({ list: [], capped: false }, -1)).toBe('No results');
    expect(countLabel({ ...two, capped: true }, 0)).toBe(`1 of ${MAX_MATCHES}+`);
  });
});
