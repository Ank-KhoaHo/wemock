import { encodeBody, mockBodyBytes } from '../core/bodies';
import { findMock } from '../core/match';
import { statusTextFor } from '../core/statusText';
import type { Badge, LogDraft, Mock, RequestFacts, Settings } from '../core/types';
import type { Gate } from './gate';

export interface PatchDeps {
  gate: Gate;
  report(d: LogDraft): void;
  now(): number;
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

      reqFacts = { method, url, body };
    } catch {
      return nativeFetch.call(win, input, init);
    }

    let gateRes: { mocks: Mock[]; settings: Settings; late: boolean };
    try {
      gateRes = await deps.gate.wait();
    } catch {
      return nativeFetch.call(win, input, init);
    }

    let mock: Mock | null = null;
    if (gateRes.settings.enabled) {
      try {
        mock = findMock(gateRes.mocks, reqFacts);
      } catch {
        mock = null;
      }
    }

    if (mock) {
      if (mock.response.delayMs > 0) {
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
          }, mock.response.delayMs);
        });
      }

      try {
        const isNullBody = [204, 205, 304].includes(mock.response.status);
        const bodyBytes = isNullBody ? null : mockBodyBytes(mock.response);
        const bodyData: BodyInit | null = bodyBytes ? (bodyBytes as unknown as BodyInit) : null;
        const status = mock.response.status;
        const statusText = statusTextFor(status);
        const headers = new win.Headers(mock.response.headers);

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
          responseHeaders: { ...mock.response.headers },
          responseBody: isNullBody ? null : mock.response.body,
          responseEncoding: mock.response.bodyEncoding,
          truncated: false,
          durationMs,
          badge: 'MOCK',
          mockId: mock.id,
          startedAt,
        });

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
