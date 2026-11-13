import { compilePattern } from './match';
import type { HeaderRule } from './types';

const TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const FORBIDDEN_HEADERS = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
]);

export function forbiddenHeaderReason(name: string): string | null {
  if (name === '') {
    return 'Type a header name';
  }
  if (!TOKEN_RE.test(name)) {
    return 'A header name has no spaces or symbols like : ( ) ,';
  }
  const lower = name.toLowerCase();
  if (FORBIDDEN_HEADERS.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-')) {
    return `Browsers do not let pages set ${name}`;
  }
  return null;
}

export function rulesFor(
  rules: HeaderRule[],
  facts: { method: string; url: string },
): HeaderRule[] {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(facts.url);
  } catch {
    try {
      parsedUrl = new URL(
        facts.url,
        typeof window !== 'undefined' && window.location ? window.location.href : 'http://localhost',
      );
    } catch {
      return [];
    }
  }

  const result: HeaderRule[] = [];
  const targetMethod = facts.method.toUpperCase();

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const ruleMethod = rule.method.toUpperCase();
    if (ruleMethod !== 'ANY' && ruleMethod !== targetMethod) continue;
    const compiled = compilePattern(rule.urlPattern);
    if (!compiled.ok || !compiled.test(parsedUrl)) continue;
    result.push(rule);
  }

  return result;
}

export function applyHeaderRules(
  rules: HeaderRule[],
  facts: { method: string; url: string },
  headers: Record<string, string>,
): { headers: Record<string, string>; changed: string[] } {
  try {
    const out: Record<string, string> = { ...headers };
    const changed: string[] = [];
    const changedSet = new Set<string>();

    const applicableRules = rulesFor(rules, facts);
    for (const rule of applicableRules) {
      if (forbiddenHeaderReason(rule.name) !== null) {
        continue;
      }
      const lowerName = rule.name.toLowerCase();
      for (const k of Object.keys(out)) {
        if (k.toLowerCase() === lowerName) {
          delete out[k];
        }
      }
      if (rule.value !== '') {
        out[lowerName] = rule.value;
      }
      if (!changedSet.has(lowerName)) {
        changedSet.add(lowerName);
        changed.push(lowerName);
      }
    }

    return { headers: out, changed };
  } catch {
    return { headers: { ...headers }, changed: [] };
  }
}
