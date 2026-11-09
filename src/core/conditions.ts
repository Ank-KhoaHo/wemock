import type { Mock, MockMatch, RequestFacts } from './types';

/** A11: returns true if the mock has any non-empty match condition. */
export function hasConditions(mock: Mock): boolean {
  const m = mock.match;
  if (!m) return false;
  if (m.query && Object.keys(m.query).length > 0) return true;
  if (m.headers && Object.keys(m.headers).length > 0) return true;
  if (typeof m.body === 'string' && m.body.trim().length > 0) return true;
  return false;
}

function isSubset(expected: unknown, actual: unknown): boolean {
  if (expected === actual) return true;
  if (expected === null || actual === null) return expected === actual;
  if (typeof expected !== typeof actual) return false;

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    if (expected.length !== actual.length) return false;
    for (let i = 0; i < expected.length; i++) {
      if (!isSubset(expected[i], actual[i])) return false;
    }
    return true;
  }

  if (typeof expected === 'object') {
    if (Array.isArray(actual)) return false;
    if (typeof actual !== 'object' || actual === null) return false;
    const expObj = expected as Record<string, unknown>;
    const actObj = actual as Record<string, unknown>;
    for (const key of Object.keys(expObj)) {
      if (!Object.prototype.hasOwnProperty.call(actObj, key)) return false;
      if (!isSubset(expObj[key], actObj[key])) return false;
    }
    return true;
  }

  return expected === actual;
}

/**
 * A11: evaluates whether request facts satisfy mock conditions.
 * Query values compared after URL decoding, any of repeated values, '*' = present.
 * Header names case-insensitive, values exact, '*' = present.
 * Body: nested JSON subset match if both parse as JSON, else substring.
 * Empty parts are no condition. Never throws.
 */
export function matchConditions(match: MockMatch | undefined, facts: RequestFacts): boolean {
  if (!match) return true;

  try {
    // 1. Query conditions
    if (match.query && Object.keys(match.query).length > 0) {
      let searchParams: URLSearchParams;
      try {
        const parsed = new URL(facts.url, 'http://localhost');
        searchParams = parsed.searchParams;
      } catch {
        return false;
      }

      for (const [key, expected] of Object.entries(match.query)) {
        if (expected === '*') {
          if (!searchParams.has(key)) return false;
        } else {
          const actualValues = searchParams.getAll(key);
          if (!actualValues.includes(expected)) return false;
        }
      }
    }

    // 2. Header conditions
    if (match.headers && Object.keys(match.headers).length > 0) {
      if (!facts.headers) return false;

      for (const [key, expected] of Object.entries(match.headers)) {
        const lowerKey = key.toLowerCase();
        let found = false;
        let actualValue: string | undefined;

        for (const [hKey, hVal] of Object.entries(facts.headers)) {
          if (hKey.toLowerCase() === lowerKey) {
            found = true;
            actualValue = hVal;
            break;
          }
        }

        if (!found) return false;
        if (expected !== '*' && actualValue !== expected) return false;
      }
    }

    // 3. Body condition
    if (typeof match.body === 'string' && match.body.trim().length > 0) {
      const trimmedCond = match.body.trim();
      if (facts.body === undefined) return false;

      let isCondJson = false;
      let condJson: unknown;
      try {
        condJson = JSON.parse(trimmedCond);
        isCondJson = true;
      } catch {
        isCondJson = false;
      }

      let isBodyJson = false;
      let bodyJson: unknown;
      try {
        bodyJson = JSON.parse(facts.body);
        isBodyJson = true;
      } catch {
        isBodyJson = false;
      }

      if (isCondJson && isBodyJson) {
        if (!isSubset(condJson, bodyJson)) return false;
      } else {
        if (!facts.body.includes(trimmedCond)) return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}
