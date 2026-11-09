import type { MockResponse, MockSequence } from './types';

/**
 * A12: picks which step to serve for the Nth call.
 * A count below 1 counts as 1. Callers handle an empty steps array.
 */
export function pickStep(seq: MockSequence, callCount: number): MockResponse {
  const count = Math.max(1, callCount);
  if (seq.steps.length === 0) {
    return seq.steps[0]!;
  }
  const index = count - 1;
  if (seq.after === 'loop') {
    return seq.steps[index % seq.steps.length]!;
  }
  const idx = Math.min(index, seq.steps.length - 1);
  return seq.steps[idx]!;
}
