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

/** A pattern read once: what patternCovers compares. null when the pattern is one we cannot judge. */
interface ParsedPattern {
  absolute: boolean;
  origin: string | null;
  segments: string[];
  endsWithWildcard: boolean;
}

function parsePattern(p: string): ParsedPattern | null {
  // Any {, }, ( or ) (optional parts, groups): too hard to judge, so never "covers".
  if (/[{}()]/.test(p)) return null;
  // splitPattern, not new URL(): the URL parser turns `\:` into `/:`, which reads as a parameter.
  let split: { origin: string | null; path: string };
  try {
    split = splitPattern(p);
  } catch {
    return null;
  }
  const segments = getSegments(split.path);
  return {
    absolute: p.startsWith('http://') || p.startsWith('https://'),
    origin: split.origin,
    segments,
    endsWithWildcard: segments.length > 0 && isWildcard(segments[segments.length - 1]!),
  };
}

/** One pattern segment against another: a :param takes any one segment but not a *wildcard. */
function segmentCovers(segA: string, segB: string): boolean {
  return isParam(segA) ? !isWildcard(segB) : segA === segB;
}

function parsedCovers(a: ParsedPattern | null, b: ParsedPattern | null): boolean {
  if (!a || !b) return false;
  if (a.absolute !== b.absolute || a.origin !== b.origin) return false;
  const aLen = a.segments.length;
  const bLen = b.segments.length;
  if (a.endsWithWildcard) {
    // a's last segment is a *name wildcard: it covers one or more remaining segments of b.
    if (bLen < aLen) return false;
    for (let i = 0; i < aLen - 1; i++) {
      if (!segmentCovers(a.segments[i]!, b.segments[i]!)) return false;
    }
    return true;
  }
  if (aLen !== bLen) return false;
  for (let i = 0; i < aLen; i++) {
    if (!segmentCovers(a.segments[i]!, b.segments[i]!)) return false;
  }
  return true;
}

export function patternCovers(a: string, b: string): boolean {
  return parsedCovers(parsePattern(a), parsePattern(b));
}

export function unreachableMocks(
  mocks: Mock[],
): Map<string, { byId: string; reason: string }> {
  const result = new Map<string, { byId: string; reason: string }>();
  // Each pattern is read once here, not once per pair: with 900 mocks that is 900 reads, not 810,000.
  const parsed: (ParsedPattern | null | undefined)[] = new Array(mocks.length);
  const parsedAt = (k: number) => {
    if (parsed[k] === undefined) parsed[k] = parsePattern(mocks[k]!.urlPattern);
    return parsed[k] ?? null;
  };

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

      if (!parsedCovers(parsedAt(j), parsedAt(i))) continue;

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
