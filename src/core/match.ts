import { match } from 'path-to-regexp';
import { hasConditions, matchConditions } from './conditions';
import { operationName } from './graphql';
import type { Mock, RequestFacts } from './types';

// Not new URL(pattern).pathname: it turns `\` into `/` and encodes `{}`, breaking the syntax.
export function splitPattern(pattern: string): { origin: string | null; path: string } {
  let origin: string | null = null;
  let path = pattern;

  const host = /^https?:\/\/[^/?#\\]*/.exec(pattern);
  if (host) {
    origin = new URL(host[0]).origin;
    path = pattern.slice(host[0].length).replace(/(?<!\\)[?#][\s\S]*$/, '') || '/';
  }

  return { origin, path: path.replaceAll(/[^\x21-\x7E]/gu, (c) => encodeURIComponent(c)) };
}

export function compilePattern(
  pattern: string,
): { ok: true; test(url: URL): boolean } | { ok: false; error: string } {
  try {
    const { origin: expectedOrigin, path } = splitPattern(pattern);

    const matchFn = match(path, { decode: decodeURIComponent });

    return {
      ok: true,
      test(url: URL): boolean {
        if (expectedOrigin !== null && url.origin !== expectedOrigin) {
          return false;
        }
        try {
          return matchFn(url.pathname) !== false;
        } catch {
          return false;
        }
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function matchesBase(m: Mock, req: RequestFacts, reqUrl: URL, reqMethod: string): boolean {
  if (!m.enabled) {
    return false;
  }

  const mockMethod = m.method.toUpperCase();
  if (mockMethod !== 'ANY' && mockMethod !== reqMethod) {
    return false;
  }

  const compiled = compilePattern(m.urlPattern);
  if (!compiled.ok) {
    return false;
  }

  if (!compiled.test(reqUrl)) {
    return false;
  }

  if (m.graphqlOperation && m.graphqlOperation.trim().length > 0) {
    const op = operationName(req.body);
    if (op !== m.graphqlOperation) {
      return false;
    }
  }

  return true;
}

export function findMock(mocks: Mock[], req: RequestFacts): Mock | null {
  try {
    let reqUrl: URL;
    try {
      reqUrl = new URL(req.url);
    } catch {
      return null;
    }

    const reqMethod = req.method.toUpperCase();

    // A11: the active scenario's mocks, then Default's (fromDefault), so a scenario still
    // overrides Default. Within each, mocks with conditions first, then the rest, in list order.
    for (const layer of [mocks.filter((m) => !m.fromDefault), mocks.filter((m) => m.fromDefault)]) {
      for (const withConditions of [true, false]) {
        for (const m of layer) {
          if (hasConditions(m) !== withConditions) continue;
          if (!matchesBase(m, req, reqUrl, reqMethod)) continue;
          if (withConditions && !matchConditions(m.match, req)) continue;
          return m;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}
