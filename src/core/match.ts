import { match } from 'path-to-regexp';
import { operationName } from './graphql';
import type { Mock, RequestFacts } from './types';

export function compilePattern(
  pattern: string,
): { ok: true; test(url: URL): boolean } | { ok: false; error: string } {
  try {
    let expectedOrigin: string | null = null;
    let path = pattern;

    if (pattern.startsWith('http://') || pattern.startsWith('https://')) {
      const parsed = new URL(pattern);
      expectedOrigin = parsed.origin;
      path = parsed.pathname;
    }

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

export function findMock(mocks: Mock[], req: RequestFacts): Mock | null {
  try {
    let reqUrl: URL;
    try {
      reqUrl = new URL(req.url);
    } catch {
      return null;
    }

    const reqMethod = req.method.toUpperCase();

    for (const m of mocks) {
      if (!m.enabled) {
        continue;
      }

      const mockMethod = m.method.toUpperCase();
      if (mockMethod !== 'ANY' && mockMethod !== reqMethod) {
        continue;
      }

      const compiled = compilePattern(m.urlPattern);
      if (!compiled.ok) {
        continue;
      }

      if (!compiled.test(reqUrl)) {
        continue;
      }

      if (m.graphqlOperation && m.graphqlOperation.trim().length > 0) {
        const op = operationName(req.body);
        if (op !== m.graphqlOperation) {
          continue;
        }
      }

      return m;
    }

    return null;
  } catch {
    return null;
  }
}
