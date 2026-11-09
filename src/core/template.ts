import type { HandlerInput } from './handler';

function defaultUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function formatValue(val: unknown): string {
  if (val === undefined || val === null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val) ?? '';
    } catch {
      return '';
    }
  }
  return '';
}

function getPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const seg of path) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    if (seg === '__proto__' || seg === 'constructor' || seg === 'prototype') return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return undefined;
      cur = cur[idx];
    } else {
      if (!Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}

export function fillTemplate(
  text: string,
  req: HandlerInput['req'],
  deps?: { now?: () => Date; uuid?: () => string },
): string {
  try {
    if (typeof text !== 'string' || !text.includes('{{')) {
      return text;
    }

    let memoDate: Date | undefined;
    const getNow = () => {
      if (!memoDate) {
        memoDate = deps?.now ? deps.now() : new Date();
      }
      return memoDate;
    };

    const getUuid = () => (deps?.uuid ? deps.uuid() : defaultUuid());

    const tagRe = /(\\)?\{\{([^{}]*?)\}\}/g;

    return text.replace(tagRe, (match, escaped, rawInside: string) => {
      if (escaped) {
        return `{{${rawInside}}}`;
      }

      const name = rawInside.trim();

      if (name === 'uuid') {
        return getUuid();
      }
      if (name === 'now') {
        return getNow().toISOString();
      }
      if (name === 'timestamp') {
        return String(getNow().getTime());
      }
      if (name === 'body') {
        return formatValue(req.body);
      }
      if (name.startsWith('body.')) {
        const pathStr = name.slice(5);
        if (!pathStr) return match;
        const segs = pathStr.split('.');
        if (segs.some((s) => s === '')) return match;
        return formatValue(getPath(req.body, segs));
      }
      if (name.startsWith('params.')) {
        const k = name.slice(7);
        if (!k) return match;
        let val: unknown = req.params ? req.params[k] : undefined;
        if (Array.isArray(val)) {
          val = val[0];
        }
        return formatValue(val);
      }
      if (name.startsWith('query.')) {
        const k = name.slice(6);
        if (!k) return match;
        let val: unknown = req.query ? req.query[k] : undefined;
        if (Array.isArray(val)) {
          val = (val as unknown[])[0];
        }
        return formatValue(val);
      }
      if (name.startsWith('headers.')) {
        const k = name.slice(8);
        if (!k) return match;
        let val: unknown = undefined;
        if (req.headers && typeof req.headers === 'object') {
          const target = k.toLowerCase();
          for (const [hk, hv] of Object.entries(req.headers)) {
            if (hk.toLowerCase() === target) {
              val = hv;
              break;
            }
          }
        }
        return formatValue(val);
      }

      return match;
    });
  } catch {
    return text;
  }
}
