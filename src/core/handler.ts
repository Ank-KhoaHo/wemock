import { match } from 'path-to-regexp';
import { isValidStatus } from './statusText';
import type { Mock, MockResponse } from './types';

// Spec A2: code mocks. Everything here is pure, so the page, the background
// and the panel all build the same input and read the same reply.

export const HANDLER_TIMEOUT_MS = 1000;
export const HANDLER_WAIT_MS = 3000;

export const DEFAULT_CODE = `// Runs for every call this mock matches. Return the body.
// req: method, url, path, params, query, headers, body.  res: status, headers, delayMs.
return { id: params.id };
`;

/** What the page knows about a request. Sent to the background, never code. */
export interface HandlerRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HandlerInput {
  req: {
    method: string;
    url: string;
    path: string;
    params: Record<string, string | string[]>;
    query: Record<string, string>;
    headers: Record<string, string>;
    body: unknown;
    bodyText: string | undefined;
  };
  res: { status: number; headers: Record<string, string>; delayMs: number };
}

/** What the sandbox worker sends back. Bytes arrive as base64 text. */
export type WorkerOutcome =
  | {
      ok: true;
      kind: 'undefined' | 'string' | 'json' | 'bytes';
      value?: string;
      res: { status?: unknown; headers?: unknown; delayMs?: unknown };
    }
  | { ok: false; error: string };

export interface HandlerReply {
  response: MockResponse;
  error?: string;
}

/** URL parameters of `pattern` in `url`, e.g. `/doc/:id` + `/doc/1` = `{ id: '1' }`. */
export function matchParams(pattern: string, url: string): Record<string, string | string[]> {
  try {
    let path = pattern;
    if (pattern.startsWith('http://') || pattern.startsWith('https://')) {
      path = new URL(pattern).pathname;
    }
    const found = match(path, { decode: decodeURIComponent })(new URL(url).pathname);
    if (!found) return {};
    const out: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(found.params)) {
      if (typeof v === 'string' || Array.isArray(v)) out[k] = v as string | string[];
    }
    return out;
  } catch {
    return {};
  }
}

export function buildInput(mock: Mock, request: HandlerRequest): HandlerInput {
  let path = '';
  let query: Record<string, string> = {};
  try {
    const u = new URL(request.url);
    path = u.pathname;
    query = {};
    u.searchParams.forEach((v, k) => {
      if (!(k in query)) query[k] = v;
    });
  } catch {
    // keep empty
  }
  let body: unknown = request.body;
  if (typeof request.body === 'string' && request.body.length > 0) {
    try {
      body = JSON.parse(request.body);
    } catch {
      body = request.body;
    }
  }
  return {
    req: {
      method: request.method.toUpperCase(),
      url: request.url,
      path,
      params: matchParams(mock.urlPattern, request.url),
      query,
      headers: { ...request.headers },
      body,
      bodyText: request.body,
    },
    res: {
      status: mock.response.status,
      headers: { ...mock.response.headers },
      delayMs: mock.response.delayMs,
    },
  };
}

/** Status 500 with the message, so a broken handler is loud, never a silent real call. */
export function errorReply(message: string): HandlerReply {
  return {
    error: message,
    response: {
      status: 500,
      headers: { 'content-type': 'application/json', 'x-wemock-error': '1' },
      body: JSON.stringify({ wemockError: message }),
      bodyEncoding: 'text',
      delayMs: 0,
    },
  };
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((k) => k.toLowerCase() === name);
}

/** Turns what the worker returned into the reply the page serves. */
export function toReply(outcome: WorkerOutcome): HandlerReply {
  if (!outcome || typeof outcome !== 'object') return errorReply('The sandbox sent no answer');
  if (!outcome.ok) return errorReply(String(outcome.error || 'The code failed'));

  const res = outcome.res ?? {};
  const status = Number(res.status);
  if (!Number.isInteger(status) || !isValidStatus(status)) {
    return errorReply(`res.status must be a whole number from 200 to 599, got ${String(res.status)}`);
  }
  const delay = Number(res.delayMs ?? 0);
  if (!Number.isFinite(delay) || delay < 0) {
    return errorReply(`res.delayMs must be 0 or more, got ${String(res.delayMs)}`);
  }
  const headers: Record<string, string> = {};
  if (res.headers && typeof res.headers === 'object' && !Array.isArray(res.headers)) {
    for (const [k, v] of Object.entries(res.headers as Record<string, unknown>)) {
      if (v !== undefined && v !== null) headers[k] = String(v);
    }
  }

  let body = '';
  let bodyEncoding: MockResponse['bodyEncoding'] = 'text';
  if (outcome.kind === 'string' || outcome.kind === 'json') {
    body = outcome.value ?? '';
    if (outcome.kind === 'json' && !hasHeader(headers, 'content-type')) {
      headers['content-type'] = 'application/json';
    }
  } else if (outcome.kind === 'bytes') {
    body = outcome.value ?? '';
    bodyEncoding = 'base64';
  }

  return { response: { status, headers, body, bodyEncoding, delayMs: delay } };
}

export function isCodeMock(mock: Mock): boolean {
  return mock.reply === 'code';
}
