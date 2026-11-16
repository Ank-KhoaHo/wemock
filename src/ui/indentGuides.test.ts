import { describe, expect, it } from 'vitest';
import { indentDepths } from './indentGuides';

describe('indentDepths', () => {
  it('counts indent units at the start of each line', () => {
    expect(indentDepths(['{', '  "a": [', '    1', '  ]', '}'], 2)).toEqual([0, 1, 2, 1, 0]);
  });

  it('gives a blank line the deeper of its neighbours, so guides do not break', () => {
    expect(indentDepths(['{', '  "a": {', '', '   ', '    "b": 1', '  }', '}'], 2)).toEqual([0, 1, 2, 2, 2, 1, 0]);
  });

  it('counts a tab as one unit and rounds partial units down', () => {
    expect(indentDepths(['\tx', '\t\ty', '   z', ' w'], 2)).toEqual([1, 2, 1, 0]);
  });

  it('uses the unit it is given', () => {
    expect(indentDepths(['a', '    b', '        c'], 4)).toEqual([0, 1, 2]);
  });

  it('gives blank lines at the edges no guides', () => {
    expect(indentDepths(['', 'x', ''], 2)).toEqual([0, 0, 0]);
  });
});
