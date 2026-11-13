import { hasConditions } from './conditions';
import { splitPattern } from './match';
import type { Mock } from './types';

function isWildcard(seg: string): boolean {
  return seg.startsWith('*');
}

function isParam(seg: string): boolean {
  return seg.startsWith(':');
}

function getSegments(path: string): string[] {
  const trimmed = path.replace(/^\/+|\/+$/g, '');
  if (!trimmed) return [];
  return trimmed.split('/');
}

export function patternCovers(a: string, b: string): boolean {
  // Any {, }, ( or ) in either (optional parts, groups): false
  if (/[{}()]/.test(a) || /[{}()]/.test(b)) {
    return false;
  }

  const isAbsA = a.startsWith('http://') || a.startsWith('https://');
  const isAbsB = b.startsWith('http://') || b.startsWith('https://');
  if (isAbsA !== isAbsB) {
    return false;
  }

  // splitPattern, not new URL(): the URL parser turns `\:` into `/:`, which reads as a parameter.
  let pathA: string;
  let pathB: string;
  try {
    const sa = splitPattern(a);
    const sb = splitPattern(b);
    if (sa.origin !== sb.origin) {
      return false;
    }
    pathA = sa.path;
    pathB = sb.path;
  } catch {
    return false;
  }

  const aSegments = getSegments(pathA);
  const bSegments = getSegments(pathB);

  const aLen = aSegments.length;
  const bLen = bSegments.length;

  const aEndsWithWildcard = aLen > 0 && isWildcard(aSegments[aLen - 1]!);

  if (aEndsWithWildcard) {
    // a's last segment is a *name wildcard.
    // It covers one or more remaining segments of b (including b's own : or * segments).
    const prefixLen = aLen - 1;
    if (bLen < aLen) {
      return false;
    }

    for (let i = 0; i < prefixLen; i++) {
      const segA = aSegments[i]!;
      const segB = bSegments[i]!;
      if (isParam(segA)) {
        if (isWildcard(segB)) {
          return false;
        }
      } else if (segA !== segB) {
        return false;
      }
    }

    return true;
  }

  // Lengths must otherwise agree
  if (aLen !== bLen) {
    return false;
  }

  for (let i = 0; i < aLen; i++) {
    const segA = aSegments[i]!;
    const segB = bSegments[i]!;
    if (isParam(segA)) {
      if (isWildcard(segB)) {
        return false;
      }
    } else if (segA !== segB) {
      return false;
    }
  }

  return true;
}

export function unreachableMocks(
  mocks: Mock[],
): Map<string, { byId: string; reason: string }> {
  const result = new Map<string, { byId: string; reason: string }>();

  for (let i = 0; i < mocks.length; i++) {
    const b = mocks[i]!;
    if (!b.enabled) continue;
    if (hasConditions(b)) continue;

    for (let j = 0; j < i; j++) {
      const a = mocks[j]!;
      if (!a.enabled) continue;
      if (hasConditions(a)) continue;

      // Method: ANY or same method as B (an ANY B is caught only by an ANY A)
      const methodMatches =
        a.method === 'ANY' || (b.method !== 'ANY' && a.method === b.method);
      if (!methodMatches) continue;

      // GraphQL: has no graphqlOperation or the same one as B
      const aOp = a.graphqlOperation?.trim();
      const bOp = b.graphqlOperation?.trim();
      const graphqlMatches = !aOp || aOp === bOp;
      if (!graphqlMatches) continue;

      if (!patternCovers(a.urlPattern, b.urlPattern)) continue;

      const nameOrPattern = a.name?.trim() ? a.name : a.urlPattern;
      result.set(b.id, {
        byId: a.id,
        reason: `Never answers: ${nameOrPattern} above catches all its calls`,
      });
      break;
    }
  }

  return result;
}
