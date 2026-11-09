import { encodeBody, mockBodyBytes } from '../core/bodies';
import { findAnyMock } from '../core/sockets';
import { statusTextFor } from '../core/statusText';
import type { Badge, LogDraft, Mock, RequestFacts, Settings } from '../core/types';
import { announce, type PageConsole } from './announce';
import type { CallCounter } from './callCounter';
import { resolveReply, type RunHandler } from './reply';
import type { Gate, GateResult } from './gate';

export interface PatchDeps {
  gate: Gate;
  report(d: LogDraft): void;
  now(): number;
  /** A4: the page console, captured at install. */
  console?: PageConsole;
  /** A2: runs a code mock; absent outside a real page (code mocks then answer the error reply). */
  runHandler?: RunHandler;
  /** A12: call counter for sequence and code mocks. */
  callCounter?: CallCounter;
}

declare global {
  interface Window {
    Request: typeof Request;
    Response: typeof Response;
    Headers: typeof Headers;
  }
}

function getSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | undefined {
  if (init?.signal) {
    return init.signal;
  }
  if (input && typeof input === 'object' && 'signal' in input) {
    return (input as Request).signal;
  }
  return undefined;
}

function createAbortError(reason?: unknown): DOMException {
  if (reason instanceof DOMException && reason.name === 'AbortError') {
    return reason;
  }
  return new DOMException('The operation was aborted.', 'AbortError');
}

/** Logging must never change what the page gets. */
export function pageOriginOf(win: Window): string {
  try {
    return new URL(win.location.href).origin;
  } catch {
    return '';
  }
}

function safeReport(deps: PatchDeps, d: LogDraft): void {
  try {
    deps.report(d);
  } catch {
    // the log is best effort
  }
}

export function installFetchPatch(win: Window, deps: PatchDeps): () => void {
  const nativeFetch = win.fetch;

  async function patchedFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const startedAt = deps.now();
    const signal = getSignal(input, init);

    if (signal?.aborted) {
      throw createAbortError(signal.reason);
    }

    let reqFacts: RequestFacts;
    try {
      const reqInput =
        typeof input === 'string'
          ? new URL(input, win.location.href).href
          : input instanceof URL
            ? input.href
            : input;

      const inputToUse =
        input && typeof input === 'object' && 'clone' in input && typeof (input as Request).clone === 'function'
          ? (input as Request).clone()
          : reqInput;

      // A streamed body can be read only once: keep it for the real call, match on URL only.
      const streamed = typeof ReadableStream !== 'undefined' && init?.body instanceof ReadableStream;
      const factsInit: RequestInit | undefined = streamed
        ? { ...init, body: undefined, duplex: undefined } as RequestInit
        : init;
      const req = new win.Request(inputToUse, factsInit);
      const method = req.method;
      const url = req.url;

      let body: string | undefined;
      if (typeof init?.body === 'string') {
        body = init.body;
      } else if (!streamed && method !== 'GET' && method !== 'HEAD') {
        try {
          body = await req.clone().text();
        } catch {
          // Body not readable as text
        }
      }

      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => {
        headers[k] = v;
      });
      reqFacts = { method, url, body, headers };
    } catch {
      return nativeFetch.call(win, input, init);
    }

    let gateRes: GateResult;
    try {
      gateRes = await deps.gate.wait();
    } catch {
      return nativeFetch.call(win, input, init);
    }

    let mock: Mock | null = null;
    if (gateRes.settings.enabled) {
      try {
        mock = findAnyMock(gateRes.mocks, gateRes.sockets, reqFacts);
      } catch {
        mock = null;
      }
    }

    if (mock) {
      const isSocket = !gateRes.mocks.includes(mock);
      let callCount = 1;
      if (!isSocket && deps.callCounter) {
        const listKey = gateRes.mocks.map((m) => m.id).join(',');
        callCount = deps.callCounter.next(mock, listKey);
      }
      const reply = await resolveReply(deps.runHandler, mock, reqFacts, callCount);
      if (signal?.aborted) {
        throw createAbortError(signal.reason);
      }
      const response = reply.response;
      if (response.delayMs > 0) {
        await new Promise<void>((resolve, reject) => {
          if (signal?.aborted) {
            reject(createAbortError(signal.reason));
            return;
          }

          let timer: ReturnType<typeof setTimeout> | null = null;
          let onAbort: (() => void) | null = null;

          if (signal) {
            onAbort = () => {
              if (timer !== null) clearTimeout(timer);
              signal.removeEventListener('abort', onAbort!);
              reject(createAbortError(signal.reason));
            };
            signal.addEventListener('abort', onAbort);
          }

          timer = setTimeout(() => {
            if (signal && onAbort) {
              signal.removeEventListener('abort', onAbort);
            }
            resolve();
          }, response.delayMs);
        });
      }

      try {
        const isNullBody = [204, 205, 304].includes(response.status);
        const bodyBytes = isNullBody ? null : mockBodyBytes(response);
        const bodyData: BodyInit | null = bodyBytes ? (bodyBytes as unknown as BodyInit) : null;
        const status = response.status;
        const statusText = statusTextFor(status);
        const headers = new win.Headers(response.headers);

        const res = new win.Response(bodyData, {
          status,
          statusText,
          headers,
        });

        Object.defineProperty(res, 'url', {
          value: reqFacts.url,
          writable: false,
          enumerable: true,
          configurable: true,
        });

        const durationMs = deps.now() - startedAt;
        safeReport(deps, {
          method: reqFacts.method,
          url: reqFacts.url,
          requestBody: reqFacts.body,
          status,
          responseHeaders: { ...response.headers },
          responseBody: isNullBody ? null : response.body,
          responseEncoding: response.bodyEncoding,
          truncated: false,
          durationMs,
          badge: 'MOCK',
          mockId: mock.id,
          ...(reply.error ? { error: reply.error } : {}),
          startedAt,
        });
        announce(deps.console, gateRes.settings, { method: reqFacts.method, url: reqFacts.url, status, mock, durationMs, error: reply.error }, pageOriginOf(win));

        return res;
      } catch {
        return nativeFetch.call(win, input, init);
      }
    }

    const realRes = await nativeFetch.call(win, input, init);
    const durationMs = deps.now() - startedAt;
    const badge: Badge = gateRes.late ? 'LATE' : 'real';

    void (async () => {
      try {
        const clone = realRes.clone();
        const buffer = await clone.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const contentType = clone.headers.get('content-type');
        const { body, encoding, truncated } = encodeBody(bytes, contentType);

        const headersRecord: Record<string, string> = {};
        clone.headers.forEach((val, key) => {
          headersRecord[key.toLowerCase()] = val;
        });

        deps.report({
          method: reqFacts.method,
          url: reqFacts.url,
          requestBody: reqFacts.body,
          status: clone.status,
          responseHeaders: headersRecord,
          responseBody: body,
          responseEncoding: encoding,
          truncated,
          durationMs,
          badge,
          startedAt,
        });
      } catch {
        // swallow logging errors so page never breaks
      }
    })();

    return realRes;
  }

  win.fetch = patchedFetch;

  return () => {
    win.fetch = nativeFetch;
  };
}
