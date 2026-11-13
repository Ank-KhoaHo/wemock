import { encodeBody, mockBodyBytes } from '../core/bodies';
import { applyHeaderRules, rulesFor } from '../core/headerRules';
import { findAnyMock } from '../core/sockets';
import { statusTextFor } from '../core/statusText';
import { sseFrame, streamBodyText } from '../core/stream';
import {
  type Badge,
  type BodyEncoding,
  BODY_CAP_BYTES,
  type LogDraft,
  type Mock,
  type RequestFacts,
  type Settings,
} from '../core/types';
import { announce, type PageConsole } from './announce';
import type { CallCounter } from './callCounter';
import { patchRealResponse } from './patchReal';
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
  /** A33: the native fetch captured before patches. */
  nativeFetch?: typeof fetch;
}

declare global {
  interface Window {
    Request: typeof Request;
    Response: typeof Response;
    Headers: typeof Headers;
    ReadableStream: typeof ReadableStream;
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

function createAbortError(reason?: unknown): unknown {
  if (reason !== undefined) {
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
      if (mock.reply === 'patch') {
        const fetchFn = deps.nativeFetch ?? nativeFetch;
        const realRes = await fetchFn.call(win, input, init);
        if (signal?.aborted) {
          throw createAbortError(signal.reason);
        }

        const patchedResponse = await patchRealResponse(realRes, mock);
        if (signal?.aborted) {
          throw createAbortError(signal.reason);
        }

        if (patchedResponse.delayMs > 0) {
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
            }, patchedResponse.delayMs);
          });
        }

        try {
          const isNullBody = [204, 205, 304].includes(patchedResponse.status);
          const bodyBytes = isNullBody ? null : mockBodyBytes(patchedResponse);
          const bodyData: BodyInit | null = bodyBytes ? (bodyBytes as unknown as BodyInit) : null;
          const status = patchedResponse.status;
          const statusText = statusTextFor(status);
          const headers = new win.Headers(patchedResponse.headers);

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
            responseHeaders: { ...patchedResponse.headers },
            responseBody: isNullBody ? null : patchedResponse.body,
            responseEncoding: patchedResponse.bodyEncoding,
            truncated: false,
            durationMs,
            badge: 'MOCK',
            mockId: mock.id,
            startedAt,
          });
          announce(deps.console, gateRes.settings, { method: reqFacts.method, url: reqFacts.url, status, mock, durationMs }, pageOriginOf(win));

          return res;
        } catch (err) {
          // Never call the server a second time: a POST would run twice. Fail like a network error.
          throw new TypeError(`wemock could not build the changed response: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (mock.reply === 'stream') {
        const streamConfig = mock.stream ?? { chunks: [], gapMs: 0, sse: false };
        const encoder = new TextEncoder();
        const chunks = streamConfig.chunks;
        const gapMs = streamConfig.gapMs;
        const sse = streamConfig.sse;
        const fullBodyText = streamBodyText(streamConfig);
        const status = mock.response.status;
        const statusText = statusTextFor(status);
        const headers = new win.Headers(mock.response.headers);
        if (sse) {
          headers.set('content-type', 'text/event-stream');
        }

        const timers: ReturnType<typeof setTimeout>[] = [];
        const cleanTimers = () => {
          for (const t of timers) clearTimeout(t);
          timers.length = 0;
        };

        let streamEnded = false;
        let onAbort: (() => void) | null = null;

        const finish = () => {
          if (streamEnded) return;
          streamEnded = true;
          cleanTimers();
          if (signal && onAbort) signal.removeEventListener('abort', onAbort);
          const durationMs = deps.now() - startedAt;
          const loggedHeaders: Record<string, string> = { ...mock.response.headers };
          if (sse) {
            loggedHeaders['content-type'] = 'text/event-stream';
          }
          safeReport(deps, {
            method: reqFacts.method,
            url: reqFacts.url,
            requestBody: reqFacts.body,
            status,
            responseHeaders: loggedHeaders,
            responseBody: fullBodyText,
            responseEncoding: 'text',
            truncated: false,
            durationMs,
            badge: 'MOCK',
            mockId: mock.id,
            startedAt,
          });
          announce(deps.console, gateRes.settings, { method: reqFacts.method, url: reqFacts.url, status, mock, durationMs }, pageOriginOf(win));
        };

        const StreamCtor = win.ReadableStream ?? ReadableStream;
        const readable = new StreamCtor({
          start(controller) {
            if (signal) {
              if (signal.aborted) {
                controller.error(createAbortError(signal.reason));
                cleanTimers();
                return;
              }
              onAbort = () => {
                cleanTimers();
                controller.error(createAbortError(signal.reason));
              };
              signal.addEventListener('abort', onAbort);
            }

            if (chunks.length === 0) {
              controller.close();
              finish();
              return;
            }

            const sendChunk = (i: number) => {
              const text = sse ? sseFrame(chunks[i]!) : chunks[i]!;
              controller.enqueue(encoder.encode(text));
              if (i === chunks.length - 1) {
                controller.close();
                finish();
              }
            };

            chunks.forEach((_, i) => {
              const delay = i * gapMs;
              if (delay === 0) {
                sendChunk(i);
              } else {
                const t = setTimeout(() => {
                  try {
                    sendChunk(i);
                  } catch {
                    // Controller may already be closed
                  }
                }, delay);
                timers.push(t);
              }
            });
          },
          cancel() {
            cleanTimers();
            if (signal && onAbort) signal.removeEventListener('abort', onAbort);
          },
        });

        const res = new win.Response(readable as unknown as BodyInit, {
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

        return res;
      }

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

    let realInput: RequestInfo | URL = input;
    let realInit: RequestInit | undefined = init;
    let requestHeadersToSend: Record<string, string> = { ...reqFacts.headers };
    let changedHeadersToSend: string[] = [];

    if (gateRes.headerRules && gateRes.headerRules.length > 0) {
      try {
        const matchingRules = rulesFor(gateRes.headerRules, { method: reqFacts.method, url: reqFacts.url });
        if (matchingRules.length > 0) {
          const applied = applyHeaderRules(gateRes.headerRules, { method: reqFacts.method, url: reqFacts.url }, reqFacts.headers ?? {});
          requestHeadersToSend = applied.headers;
          changedHeadersToSend = applied.changed;

          const newHeaders = new win.Headers(applied.headers);
          try {
            realInput = new win.Request(input, {
              ...(init ? init : {}),
              headers: newHeaders,
            });
            realInit = undefined;
          } catch {
            realInit = { ...(init ? init : {}), headers: newHeaders };
          }
        }
      } catch {
        // Fall back to native call
      }
    }

    const realRes = await nativeFetch.call(win, realInput, realInit);
    if (!gateRes.settings.recording) {
      return realRes;
    }

    const durationMs = deps.now() - startedAt;
    const badge: Badge = gateRes.late ? 'LATE' : 'real';

    void (async () => {
      try {
        const clone = realRes.clone();
        const headersRecord: Record<string, string> = {};
        clone.headers.forEach((val, key) => {
          headersRecord[key.toLowerCase()] = val;
        });
        const contentType = clone.headers.get('content-type');

        let body: string | null = null;
        let encoding: BodyEncoding = 'text';
        let truncated = false;

        if (clone.body && typeof clone.body.getReader === 'function') {
          const reader = clone.body.getReader();
          const chunks: Uint8Array[] = [];
          let totalBytes = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
              totalBytes += value.byteLength;
              if (totalBytes > BODY_CAP_BYTES) {
                truncated = true;
                void reader.cancel().catch(() => {});
                break;
              }
            }
          }

          if (truncated) {
            const enc = encodeBody(new Uint8Array(0), contentType);
            encoding = enc.encoding;
            body = null;
          } else {
            const combined = new Uint8Array(totalBytes);
            let offset = 0;
            for (const chunk of chunks) {
              combined.set(chunk, offset);
              offset += chunk.byteLength;
            }
            const enc = encodeBody(combined, contentType);
            body = enc.body;
            encoding = enc.encoding;
            truncated = enc.truncated;
          }
        } else {
          const buffer = await clone.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          const enc = encodeBody(bytes, contentType);
          body = enc.body;
          encoding = enc.encoding;
          truncated = enc.truncated;
        }

        deps.report({
          method: reqFacts.method,
          url: reqFacts.url,
          requestBody: reqFacts.body,
          requestHeaders: requestHeadersToSend,
          changedHeaders: changedHeadersToSend,
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
