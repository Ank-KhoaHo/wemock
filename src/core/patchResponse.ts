import type { MockPatch } from './types';

function parseValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isForbiddenKey(segment: string): boolean {
  return segment === '__proto__' || segment === 'constructor' || segment === 'prototype';
}

function applySet(target: unknown, segments: string[], value: unknown): void {
  if (typeof target !== 'object' || target === null || segments.length === 0) {
    return;
  }

  const head = segments[0];
  if (head === undefined) {
    return;
  }
  const tail = segments.slice(1);

  if (tail.length === 0) {
    if (head === '*') {
      if (Array.isArray(target)) {
        for (let i = 0; i < target.length; i++) {
          target[i] = typeof value === 'object' && value !== null ? JSON.parse(JSON.stringify(value)) : value;
        }
      } else {
        for (const k of Object.keys(target)) {
          if (!isForbiddenKey(k)) {
            (target as Record<string, unknown>)[k] =
              typeof value === 'object' && value !== null ? JSON.parse(JSON.stringify(value)) : value;
          }
        }
      }
    } else if (Array.isArray(target)) {
      if (/^\d+$/.test(head)) {
        const idx = Number(head);
        if (idx >= 0 && idx < target.length) {
          target[idx] = value;
        }
      }
    } else {
      (target as Record<string, unknown>)[head] = value;
    }
    return;
  }

  if (head === '*') {
    if (Array.isArray(target)) {
      for (let i = 0; i < target.length; i++) {
        applySet(target[i], tail, value);
      }
    } else {
      for (const k of Object.keys(target)) {
        if (!isForbiddenKey(k)) {
          applySet((target as Record<string, unknown>)[k], tail, value);
        }
      }
    }
  } else if (Array.isArray(target)) {
    if (/^\d+$/.test(head)) {
      const idx = Number(head);
      if (idx >= 0 && idx < target.length) {
        applySet(target[idx], tail, value);
      }
    }
  } else {
    const obj = target as Record<string, unknown>;
    const current = obj[head];
    if (current === undefined) {
      const nextObj = {};
      obj[head] = nextObj;
      applySet(nextObj, tail, value);
    } else if (typeof current === 'object' && current !== null) {
      applySet(current, tail, value);
    }
  }
}

function applyRemove(target: unknown, segments: string[]): void {
  if (typeof target !== 'object' || target === null || segments.length === 0) {
    return;
  }

  const head = segments[0];
  if (head === undefined) {
    return;
  }
  const tail = segments.slice(1);

  if (tail.length === 0) {
    if (head === '*') {
      if (Array.isArray(target)) {
        target.length = 0;
      } else {
        for (const k of Object.keys(target)) {
          delete (target as Record<string, unknown>)[k];
        }
      }
    } else if (Array.isArray(target)) {
      if (/^\d+$/.test(head)) {
        const idx = Number(head);
        if (idx >= 0 && idx < target.length) {
          target.splice(idx, 1);
        }
      }
    } else {
      delete (target as Record<string, unknown>)[head];
    }
    return;
  }

  if (head === '*') {
    if (Array.isArray(target)) {
      for (let i = 0; i < target.length; i++) {
        applyRemove(target[i], tail);
      }
    } else {
      for (const k of Object.keys(target)) {
        if (!isForbiddenKey(k)) {
          applyRemove((target as Record<string, unknown>)[k], tail);
        }
      }
    }
  } else if (Array.isArray(target)) {
    if (/^\d+$/.test(head)) {
      const idx = Number(head);
      if (idx >= 0 && idx < target.length) {
        applyRemove(target[idx], tail);
      }
    }
  } else {
    const obj = target as Record<string, unknown>;
    const current = obj[head];
    if (typeof current === 'object' && current !== null) {
      applyRemove(current, tail);
    }
  }
}

export function applyPatch(
  real: { status: number; headers: Record<string, string>; body: string },
  patch: MockPatch,
): { status: number; headers: Record<string, string>; body: string } {
  try {
    const status = typeof patch.status === 'number' ? patch.status : real.status;

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(real.headers)) {
      const lower = k.toLowerCase();
      if (lower === 'content-length') continue;
      headers[lower] = v;
    }
    if (patch.headers) {
      for (const [k, v] of Object.entries(patch.headers)) {
        headers[k.toLowerCase()] = v;
      }
    }

    const hasOps = Boolean((patch.set && patch.set.length > 0) || (patch.remove && patch.remove.length > 0));
    if (!hasOps) {
      return { status, headers, body: real.body };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(real.body);
    } catch {
      return { status, headers, body: real.body };
    }

    if (patch.set) {
      for (const s of patch.set) {
        if (!s || typeof s.path !== 'string') continue;
        const segments = s.path.split('.');
        if (segments.some(isForbiddenKey)) continue;
        const val = parseValue(s.value);
        applySet(parsed, segments, val);
      }
    }

    if (patch.remove) {
      for (const r of patch.remove) {
        if (!r || typeof r !== 'string') continue;
        const segments = r.split('.');
        if (segments.some(isForbiddenKey)) continue;
        applyRemove(parsed, segments);
      }
    }

    const body = JSON.stringify(parsed);
    return { status, headers, body };
  } catch {
    return {
      status: real.status,
      headers: { ...real.headers },
      body: real.body,
    };
  }
}

export function patchSummary(patch: MockPatch): string[] {
  const lines: string[] = [];
  if (typeof patch.status === 'number') {
    lines.push(`Status ${patch.status}`);
  }
  if (patch.headers) {
    for (const [k, v] of Object.entries(patch.headers)) {
      lines.push(`Header ${k}: ${v}`);
    }
  }
  if (patch.set) {
    for (const s of patch.set) {
      lines.push(`Set ${s.path} = ${s.value}`);
    }
  }
  if (patch.remove) {
    for (const r of patch.remove) {
      lines.push(`Remove ${r}`);
    }
  }
  if (lines.length === 0) {
    return ['No changes: the real response as it is'];
  }
  return lines;
}
