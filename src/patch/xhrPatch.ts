import { encodeBody, mockBodyBytes } from '../core/bodies';
import { findAnyMock } from '../core/sockets';
import { statusTextFor } from '../core/statusText';
import type { Badge, BodyEncoding, LogDraft, Mock, MockResponse, RequestFacts, Settings } from '../core/types';
import { announce } from './announce';
import { patchRealResponse } from './patchReal';
import { resolveReply } from './reply';
import { pageOriginOf, type PatchDeps } from './fetchPatch';
import type { GateResult } from './gate';

declare global {
  interface Window {
    XMLHttpRequest: typeof XMLHttpRequest;
    Blob: typeof Blob;
    ProgressEvent: typeof ProgressEvent;
    Event: typeof Event;
  }
}

/** Logging must never change what the page gets. */
function safeReport(deps: PatchDeps, d: LogDraft): void {
  try {
    deps.report(d);
  } catch {
    // the log is best effort
  }
}

export function installXhrPatch(win: Window, deps: PatchDeps): () => void {
  if (!win.XMLHttpRequest) {
    return () => {};
  }

  const NativeXHR = win.XMLHttpRequest;

  class PatchedXHR extends NativeXHR {
    private _method = 'GET';
    private _requestHeaders: Record<string, string> = {};
    private _url = '';
    private _isAsync = true;
    private _sent = false;
    private _aborted = false;
    private _isMock = false;
    private _realSent = false;
    private _mockCompleted = false;
    private _mockReadyState = 0;
    private _mockStatus = 0;
    private _mockStatusText = '';
    private _mockHeaders: Record<string, string> = {};
    private _mockResponseText = '';
    private _mockJson: unknown = null;
    private _mockBlob: Blob | null = null;
    private _mockArrayBuffer: ArrayBuffer | null = null;
    private _delayTimer: ReturnType<typeof setTimeout> | null = null;
    private _gettersDefined = false;
    private _customResponseType: XMLHttpRequestResponseType | null = null;
    private _customTimeout: number | null = null;

    override get responseType(): XMLHttpRequestResponseType {
      if (this._customResponseType !== null) {
        return this._customResponseType;
      }
      try {
        return super.responseType;
      } catch {
        return '';
      }
    }

    override set responseType(val: XMLHttpRequestResponseType) {
      this._customResponseType = val;
      try {
        super.responseType = val;
      } catch {
        // Native XHR throws if state is invalid
      }
    }

    override get timeout(): number {
      if (this._customTimeout !== null) {
        return this._customTimeout;
      }
      try {
        return super.timeout;
      } catch {
        return 0;
      }
    }

    override set timeout(val: number) {
      this._customTimeout = val;
      try {
        super.timeout = val;
      } catch {
        // Native XHR throws if state is invalid
      }
    }

    override open(
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ): void {
      // A reused XHR: drop the previous mock's getters so a real call reads native values.
      this._clearMockGetters();
      try {
        this._method = String(method).toUpperCase();
        this._url = new URL(String(url), win.location.href).href;
        this._isAsync = async !== false;
        this._sent = false;
        this._aborted = false;
        this._isMock = false;
        this._realSent = false;
        this._mockCompleted = false;
        this._mockReadyState = 1;
        this._requestHeaders = {};
      } catch {
        // Keep going
      }

      if (async === undefined) {
        return super.open(method, url);
      }
      return super.open(method, url, async, username, password);
    }

    override setRequestHeader(name: string, value: string): void {
      super.setRequestHeader(name, value);
      try {
        const key = String(name).toLowerCase();
        const prev = this._requestHeaders[key];
        this._requestHeaders[key] = prev === undefined ? String(value) : `${prev}, ${value}`;
      } catch {
        // header capture is best effort
      }
    }

    override send(body?: Document | XMLHttpRequestBodyInit | null): void {
      if (!this._isAsync) {
        // Synchronous XHR (async === false): never mock; pass straight through.
        this._realSent = true;
        return super.send(body);
      }

      this._sent = true;
      const startedAt = deps.now();

      void this._executeSend(body, startedAt);
    }

    override abort(): void {
      if (this._realSent) {
        super.abort();
        return;
      }

      if (this._isMock || this._sent) {
        if (this._aborted || this._mockCompleted) {
          return;
        }
        this._aborted = true;
        if (this._delayTimer !== null) {
          clearTimeout(this._delayTimer);
          this._delayTimer = null;
        }

        this._defineMockGetters();
        this._mockReadyState = 4;
        this.dispatchEvent(new win.Event('readystatechange'));
        this.dispatchEvent(new win.ProgressEvent('abort', { lengthComputable: false, loaded: 0, total: 0 }));
        this.dispatchEvent(new win.ProgressEvent('loadend', { lengthComputable: false, loaded: 0, total: 0 }));
        this._mockReadyState = 0;
        this._mockCompleted = true;
        return;
      }

      super.abort();
    }

    private async _executeSend(
      body: Document | XMLHttpRequestBodyInit | null | undefined,
      startedAt: number,
    ): Promise<void> {
      let gateRes: GateResult;
      try {
        gateRes = await deps.gate.wait();
      } catch {
        this._passThroughReal(body, startedAt, false);
        return;
      }

      if (this._aborted) {
        return;
      }

      let reqFacts: RequestFacts;
      try {
        let reqBodyStr: string | undefined;
        if (typeof body === 'string') {
          reqBodyStr = body;
        } else if (body instanceof URLSearchParams) {
          reqBodyStr = body.toString();
        }

        reqFacts = {
          method: this._method,
          url: this._url,
          body: reqBodyStr,
          headers: { ...this._requestHeaders },
        };
      } catch {
        this._passThroughReal(body, startedAt, gateRes.late);
        return;
      }

      let mock: Mock | null = null;
      if (gateRes.settings.enabled) {
        try {
          mock = findAnyMock(gateRes.mocks, gateRes.sockets, reqFacts);
        } catch {
          mock = null;
        }
      }

      if (!mock) {
        this._passThroughReal(body, startedAt, gateRes.late);
        return;
      }

      if (mock.reply === 'patch') {
        this._isMock = true;
        const fetchFn = deps.nativeFetch ?? win.fetch;
        if (!fetchFn) {
          this._passThroughReal(body, startedAt, gateRes.late);
          return;
        }

        const init: RequestInit = {
          method: this._method,
          headers: { ...this._requestHeaders },
          credentials: this.withCredentials ? 'include' : 'same-origin',
        };
        if (this._method !== 'GET' && this._method !== 'HEAD' && body !== undefined && body !== null) {
          init.body = body as BodyInit;
        }

        let realRes: Response;
        try {
          realRes = await fetchFn(this._url, init);
        } catch {
          if (this._aborted) {
            return;
          }
          this._failNetworkError();
          return;
        }

        if (this._aborted) {
          return;
        }

        let patchedResponse: MockResponse;
        try {
          patchedResponse = await patchRealResponse(realRes, mock);
        } catch {
          if (this._aborted) {
            return;
          }
          this._failNetworkError();
          return;
        }

        if (this._aborted) {
          return;
        }

        try {
          await this._serveMock(mock, reqFacts, startedAt, gateRes, patchedResponse);
        } catch {
          if (this._aborted) {
            return;
          }
          this._failNetworkError();
        }
        return;
      }

      try {
        await this._serveMock(mock, reqFacts, startedAt, gateRes);
      } catch {
        this._clearMockGetters();
        this._passThroughReal(body, startedAt, gateRes.late);
      }
    }

    private _passThroughReal(
      body: Document | XMLHttpRequestBodyInit | null | undefined,
      startedAt: number,
      isLate: boolean,
    ): void {
      if (this._aborted || this._realSent) {
        return;
      }
      this._realSent = true;

      try {
        const onNativeLoadEnd = () => {
          try {
            super.removeEventListener('loadend', onNativeLoadEnd);
            const durationMs = deps.now() - startedAt;
            const badge: Badge = isLate ? 'LATE' : 'real';

            let rawHeaders = '';
            try {
              rawHeaders = this.getAllResponseHeaders();
            } catch {
              // Ignore
            }

            const responseHeaders: Record<string, string> = {};
            if (rawHeaders) {
              for (const line of rawHeaders.split('\r\n')) {
                const idx = line.indexOf(':');
                if (idx > 0) {
                  const k = line.slice(0, idx).trim().toLowerCase();
                  const v = line.slice(idx + 1).trim();
                  responseHeaders[k] = v;
                }
              }
            }

            const contentType = responseHeaders['content-type'] ?? null;
            let responseBody: string | null = null;
            let responseEncoding: BodyEncoding = 'text';
            let truncated = false;

            const rType = this.responseType;
            if (rType === '' || rType === 'text') {
              let text = '';
              try {
                text = this.responseText;
              } catch {
                // InvalidState
              }
              const encoded = encodeBody(new TextEncoder().encode(text), contentType);
              responseBody = encoded.body;
              responseEncoding = encoded.encoding;
              truncated = encoded.truncated;
            } else if (rType === 'arraybuffer' && this.response instanceof ArrayBuffer) {
              const encoded = encodeBody(new Uint8Array(this.response), contentType);
              responseBody = encoded.body;
              responseEncoding = encoded.encoding;
              truncated = encoded.truncated;
            } else if (rType === 'blob' && this.response instanceof win.Blob) {
              const blob = this.response;
              void (async () => {
                try {
                  const buf = await blob.arrayBuffer();
                  const encoded = encodeBody(new Uint8Array(buf), contentType);
                  safeReport(deps, {
                    method: this._method,
                    url: this._url,
                    requestBody: typeof body === 'string' ? body : undefined,
                    status: this.status,
                    responseHeaders,
                    responseBody: encoded.body,
                    responseEncoding: encoded.encoding,
                    truncated: encoded.truncated,
                    durationMs,
                    badge,
                    startedAt,
                  });
                } catch {
                  // Best effort
                }
              })();
              return;
            } else if (rType === 'json') {
              try {
                responseBody =
                  typeof this.response === 'object' ? JSON.stringify(this.response) : String(this.response);
              } catch {
                // Ignore
              }
            }

            safeReport(deps, {
              method: this._method,
              url: this._url,
              requestBody: typeof body === 'string' ? body : undefined,
              status: this.status,
              responseHeaders,
              responseBody,
              responseEncoding,
              truncated,
              durationMs,
              badge,
              startedAt,
            });
          } catch {
            // Logging is best effort
          }
        };

        super.addEventListener('loadend', onNativeLoadEnd);
        super.send(body);
      } catch {
        // Native send failure should not crash the patch
      }
    }

    private async _serveMock(
      mock: Mock,
      reqFacts: RequestFacts,
      startedAt: number,
      gateRes: GateResult,
      customResponse?: MockResponse,
    ): Promise<void> {
      this._isMock = true;
      this._defineMockGetters();

      let response: MockResponse;
      let error: string | undefined;

      if (customResponse) {
        response = customResponse;
      } else {
        const isSocket = !gateRes.mocks.includes(mock);
        let callCount = 1;
        if (!isSocket && deps.callCounter) {
          const listKey = gateRes.mocks.map((m) => m.id).join(',');
          callCount = deps.callCounter.next(mock, listKey);
        }
        const reply = await resolveReply(deps.runHandler, mock, reqFacts, callCount);
        if (this._aborted) {
          return;
        }
        response = reply.response;
        error = reply.error;
      }

      const delayMs = response.delayMs;
      const timeoutMs = this.timeout;

      if (timeoutMs > 0 && timeoutMs < delayMs) {
        await new Promise<void>((resolve) => {
          this._delayTimer = setTimeout(() => {
            this._delayTimer = null;
            resolve();
          }, timeoutMs);
        });

        if (this._aborted) {
          return;
        }

        this._mockReadyState = 4;
        this.dispatchEvent(new win.Event('readystatechange'));
        this.dispatchEvent(new win.ProgressEvent('timeout', { lengthComputable: false, loaded: 0, total: 0 }));
        this.dispatchEvent(new win.ProgressEvent('loadend', { lengthComputable: false, loaded: 0, total: 0 }));
        this._mockCompleted = true;
        return;
      }

      if (delayMs > 0) {
        await new Promise<void>((resolve) => {
          this._delayTimer = setTimeout(() => {
            this._delayTimer = null;
            resolve();
          }, delayMs);
        });

        if (this._aborted) {
          return;
        }
      }

      const isNullBody = [204, 205, 304].includes(response.status);
      const bytes = isNullBody ? new Uint8Array(0) : mockBodyBytes(response);
      const bodyLength = isNullBody ? 0 : bytes.byteLength;

      this._mockStatus = response.status;
      this._mockStatusText = statusTextFor(response.status);
      this._mockHeaders = { ...response.headers };

      if (isNullBody) {
        this._mockResponseText = '';
        this._mockJson = null;
        const contentType = this._getHeader('content-type') ?? '';
        this._mockBlob = new win.Blob([], { type: contentType });
        this._mockArrayBuffer = new ArrayBuffer(0);
      } else {
        if (response.bodyEncoding === 'base64') {
          this._mockResponseText = new TextDecoder().decode(bytes);
        } else {
          this._mockResponseText = response.body;
        }

        try {
          this._mockJson = JSON.parse(this._mockResponseText);
        } catch {
          this._mockJson = null;
        }

        const ab = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(ab).set(bytes);
        this._mockArrayBuffer = ab;

        const contentType = this._getHeader('content-type') ?? '';
        this._mockBlob = new win.Blob([ab], { type: contentType });
      }

      // 1. readyState 2
      this._mockReadyState = 2;
      this.dispatchEvent(new win.Event('readystatechange'));

      // 2. readyState 3
      this._mockReadyState = 3;
      this.dispatchEvent(new win.Event('readystatechange'));

      // 3. readyState 4
      this._mockReadyState = 4;
      this.dispatchEvent(new win.Event('readystatechange'));

      // 4. progress
      this.dispatchEvent(
        new win.ProgressEvent('progress', {
          lengthComputable: true,
          loaded: bodyLength,
          total: bodyLength,
        }),
      );

      // 5. load
      this.dispatchEvent(
        new win.ProgressEvent('load', {
          lengthComputable: true,
          loaded: bodyLength,
          total: bodyLength,
        }),
      );

      // 6. loadend
      this.dispatchEvent(
        new win.ProgressEvent('loadend', {
          lengthComputable: true,
          loaded: bodyLength,
          total: bodyLength,
        }),
      );

      this._mockCompleted = true;

      const durationMs = deps.now() - startedAt;
      safeReport(deps, {
        method: reqFacts.method,
        url: reqFacts.url,
        requestBody: reqFacts.body,
        status: response.status,
        responseHeaders: { ...response.headers },
        responseBody: isNullBody ? null : response.body,
        responseEncoding: response.bodyEncoding,
        truncated: false,
        durationMs,
        badge: 'MOCK',
        mockId: mock.id,
        ...(error ? { error } : {}),
        startedAt,
      });
      announce(
        deps.console,
        gateRes.settings,
        { method: reqFacts.method, url: reqFacts.url, status: response.status, mock, durationMs, error },
        pageOriginOf(win),
      );
    }

    private _defineMockGetters(): void {
      if (this._gettersDefined) return;
      this._gettersDefined = true;

      Object.defineProperty(this, 'readyState', {
        get: () => this._mockReadyState,
        configurable: true,
        enumerable: true,
      });

      Object.defineProperty(this, 'status', {
        get: () => this._mockStatus,
        configurable: true,
        enumerable: true,
      });

      Object.defineProperty(this, 'statusText', {
        get: () => this._mockStatusText,
        configurable: true,
        enumerable: true,
      });

      Object.defineProperty(this, 'response', {
        get: () => this._getMockResponse(),
        configurable: true,
        enumerable: true,
      });

      Object.defineProperty(this, 'responseText', {
        get: () => this._getMockResponseText(),
        configurable: true,
        enumerable: true,
      });

      Object.defineProperty(this, 'responseURL', {
        get: () => this._url,
        configurable: true,
        enumerable: true,
      });

      Object.defineProperty(this, 'responseXML', {
        get: () => null,
        configurable: true,
        enumerable: true,
      });

      this.getResponseHeader = (name: string): string | null => {
        if (this._mockReadyState < 2) return null;
        return this._getHeader(name);
      };

      this.getAllResponseHeaders = (): string => {
        if (this._mockReadyState < 2) return '';
        let res = '';
        for (const [k, v] of Object.entries(this._mockHeaders)) {
          res += `${k.toLowerCase()}: ${v}\r\n`;
        }
        return res;
      };
    }

    private _failNetworkError(): void {
      if (this._aborted || this._mockCompleted) {
        return;
      }
      if (this._delayTimer !== null) {
        clearTimeout(this._delayTimer);
        this._delayTimer = null;
      }
      this._defineMockGetters();
      this._mockReadyState = 4;
      this._mockStatus = 0;
      this._mockStatusText = '';
      this._mockHeaders = {};
      this._mockResponseText = '';
      this._mockJson = null;
      this._mockBlob = null;
      this._mockArrayBuffer = null;
      this.dispatchEvent(new win.Event('readystatechange'));
      this.dispatchEvent(new win.ProgressEvent('error', { lengthComputable: false, loaded: 0, total: 0 }));
      this.dispatchEvent(new win.ProgressEvent('loadend', { lengthComputable: false, loaded: 0, total: 0 }));
      this._mockCompleted = true;
    }

    private _clearMockGetters(): void {
      if (!this._gettersDefined) return;
      this._gettersDefined = false;
      for (const key of ['readyState', 'status', 'statusText', 'response', 'responseText',
        'responseURL', 'responseXML', 'getResponseHeader', 'getAllResponseHeaders']) {
        try {
          delete (this as unknown as Record<string, unknown>)[key];
        } catch {
          // own property only; the prototype's native accessor remains
        }
      }
      if (this._delayTimer !== null) {
        clearTimeout(this._delayTimer);
        this._delayTimer = null;
      }
      this._mockHeaders = {};
      this._mockStatus = 0;
      this._mockStatusText = '';
      this._mockResponseText = '';
      this._mockJson = null;
      this._mockBlob = null;
      this._mockArrayBuffer = null;
      this._mockCompleted = false;
      this._isMock = false;
    }

    private _getHeader(name: string): string | null {
      const target = name.toLowerCase();
      for (const [k, v] of Object.entries(this._mockHeaders)) {
        if (k.toLowerCase() === target) {
          return v;
        }
      }
      return null;
    }

    private _getMockResponseText(): string {
      if (this._mockReadyState === 0) {
        return '';
      }
      const rType = this.responseType;
      if (rType !== '' && rType !== 'text') {
        throw new DOMException(
          `Failed to read the 'responseText' property from 'XMLHttpRequest': The value is only accessible if the object's 'responseType' is '' or 'text' (was '${rType}').`,
          'InvalidStateError',
        );
      }
      if (this._mockReadyState < 3) {
        return '';
      }
      return this._mockResponseText;
    }

    private _getMockResponse(): unknown {
      if (this._mockReadyState < 4) {
        if (this._mockReadyState === 3 && (this.responseType === '' || this.responseType === 'text')) {
          return this._mockResponseText;
        }
        return this.responseType === '' || this.responseType === 'text' ? '' : null;
      }

      const rType = this.responseType;
      switch (rType) {
        case '':
        case 'text':
          return this._mockResponseText;
        case 'json':
          return this._mockJson;
        case 'blob':
          return this._mockBlob;
        case 'arraybuffer':
          return this._mockArrayBuffer;
        default:
          return null;
      }
    }
  }

  win.XMLHttpRequest = PatchedXHR;

  return () => {
    win.XMLHttpRequest = NativeXHR;
  };
}
