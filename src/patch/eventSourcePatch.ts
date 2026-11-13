import { findMock } from '../core/match';
import { parseSseFrame, streamBodyText } from '../core/stream';
import type { GateConfig } from './gate';
import type { LogDraft, Mock } from '../core/types';
import { announce } from './announce';
import { pageOriginOf, type PatchDeps } from './fetchPatch';
import { resolveReply } from './reply';

declare global {
  interface Window {
    EventSource: typeof EventSource;
    EventTarget: typeof EventTarget;
  }
}

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

function makeEvent(win: Window, type: string, data: string, lastEventId: string, origin: string): Event {
  const Ctor = (win as unknown as { MessageEvent?: typeof MessageEvent }).MessageEvent ?? MessageEvent;
  try {
    const ev = new Ctor(type, { data, lastEventId, origin });
    if ((ev as MessageEvent).lastEventId === lastEventId) return ev;
  } catch {
    // fallback
  }
  const ev = new Event(type);
  Object.defineProperties(ev, {
    data: { value: data },
    lastEventId: { value: lastEventId },
    origin: { value: origin },
  });
  return ev;
}

export function installEventSourcePatch(win: Window, deps: PatchDeps): () => void {
  const Native = win.EventSource;
  if (typeof Native !== 'function') return () => {};
  const BaseTarget = (win.EventTarget ?? EventTarget) as typeof EventTarget;

  class FakeEventSource extends BaseTarget {
    static readonly CONNECTING = CONNECTING;
    static readonly OPEN = OPEN;
    static readonly CLOSED = CLOSED;
    readonly CONNECTING = CONNECTING;
    readonly OPEN = OPEN;
    readonly CLOSED = CLOSED;

    readyState: number = CONNECTING;

    private _onopen: ((this: EventSource, ev: Event) => unknown) | null = null;
    private _onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null = null;
    private _onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
    private _timers: ReturnType<typeof setTimeout>[] = [];
    private _logged = false;

    constructor(
      private _win: Window,
      public readonly url: string,
      public readonly withCredentials: boolean,
      private _mock: Mock,
      private _cfg: GateConfig,
      private _deps: PatchDeps,
      private _startedAt: number,
    ) {
      super();
      const startTimer = setTimeout(() => {
        void this._run();
      }, 0);
      this._timers.push(startTimer);
    }

    get onopen(): ((this: EventSource, ev: Event) => unknown) | null {
      return this._onopen;
    }
    set onopen(fn: ((this: EventSource, ev: Event) => unknown) | null) {
      if (this._onopen) {
        this.removeEventListener('open', this._onopen as EventListener);
      }
      this._onopen = fn;
      if (fn) {
        this.addEventListener('open', fn as EventListener);
      }
    }

    get onmessage(): ((this: EventSource, ev: MessageEvent) => unknown) | null {
      return this._onmessage;
    }
    set onmessage(fn: ((this: EventSource, ev: MessageEvent) => unknown) | null) {
      if (this._onmessage) {
        this.removeEventListener('message', this._onmessage as EventListener);
      }
      this._onmessage = fn;
      if (fn) {
        this.addEventListener('message', fn as EventListener);
      }
    }

    get onerror(): ((this: EventSource, ev: Event) => unknown) | null {
      return this._onerror;
    }
    set onerror(fn: ((this: EventSource, ev: Event) => unknown) | null) {
      if (this._onerror) {
        this.removeEventListener('error', this._onerror as EventListener);
      }
      this._onerror = fn;
      if (fn) {
        this.addEventListener('error', fn as EventListener);
      }
    }

    close(): void {
      if (this.readyState === CLOSED) return;
      this.readyState = CLOSED;
      this._clearTimers();
    }

    private _clearTimers(): void {
      for (const t of this._timers) {
        clearTimeout(t);
      }
      this._timers.length = 0;
    }

    private _origin(): string {
      try {
        return new URL(this.url).origin;
      } catch {
        return '';
      }
    }

    private _log(responseBody: string): void {
      if (this._logged) return;
      this._logged = true;
      const durationMs = this._deps.now() - this._startedAt;
      const headers: Record<string, string> = {
        ...this._mock.response.headers,
        'content-type': 'text/event-stream',
      };
      try {
        this._deps.report({
          method: 'GET',
          url: this.url,
          status: this._mock.response.status,
          responseHeaders: headers,
          responseBody,
          responseEncoding: 'text',
          truncated: false,
          durationMs,
          badge: 'MOCK',
          mockId: this._mock.id,
          startedAt: this._startedAt,
        });
      } catch {
        // best effort
      }
      announce(
        this._deps.console,
        this._cfg.settings,
        {
          method: 'GET',
          url: this.url,
          status: this._mock.response.status,
          mock: this._mock,
          durationMs,
        },
        pageOriginOf(this._win),
      );
    }

    private async _run(): Promise<void> {
      if (this.readyState === CLOSED) return;
      this.readyState = OPEN;
      this.dispatchEvent(new Event('open'));
      if (this.readyState === CLOSED) return;

      if (this._mock.reply === 'stream') {
        const stream = this._mock.stream ?? { chunks: [], gapMs: 0, sse: false };
        const chunks = stream.chunks;
        const gapMs = stream.gapMs;
        const fullText = streamBodyText(stream);

        if (chunks.length === 0) {
          this.readyState = CLOSED;
          this.dispatchEvent(new Event('error'));
          this._log(fullText);
          return;
        }

        const origin = this._origin();
        chunks.forEach((chunk, i) => {
          const delay = i * gapMs;
          const t = setTimeout(() => {
            if (this.readyState !== OPEN) return;
            const parsed = parseSseFrame(chunk);
            const ev = makeEvent(this._win, parsed.event, parsed.data, parsed.id, origin);
            this.dispatchEvent(ev);

            if (i === chunks.length - 1) {
              const endTimer = setTimeout(() => {
                if (this.readyState !== OPEN) return;
                this.readyState = CLOSED;
                this.dispatchEvent(new Event('error'));
                this._log(fullText);
              }, gapMs);
              this._timers.push(endTimer);
            }
          }, delay);
          this._timers.push(t);
        });
      } else {
        const reply = await resolveReply(this._deps.runHandler, this._mock, {
          method: 'GET',
          url: this.url,
        });
        if (this.readyState !== OPEN) return;

        const origin = this._origin();
        const body = reply.response.body;
        const ev = makeEvent(this._win, 'message', body, '', origin);
        this.dispatchEvent(ev);

        const endTimer = setTimeout(() => {
          if (this.readyState !== OPEN) return;
          this.readyState = CLOSED;
          this.dispatchEvent(new Event('error'));
          this._log(body);
        }, 0);
        this._timers.push(endTimer);
      }
    }
  }

  const Patched = function (
    this: unknown,
    url: string | URL,
    eventSourceInitDict?: EventSourceInit,
  ): EventSource {
    if (!new.target) {
      return (Native as unknown as (u: unknown, i?: unknown) => EventSource)(url, eventSourceInitDict);
    }
    let fake: FakeEventSource | null = null;
    try {
      const cfg = deps.gate.current();
      if (cfg && cfg.settings.enabled && cfg.mocks && cfg.mocks.length > 0) {
        const abs = new URL(String(url), win.location.href).href;
        const mock = findMock(cfg.mocks, { method: 'GET', url: abs });
        if (mock) {
          fake = new FakeEventSource(
            win,
            abs,
            eventSourceInitDict?.withCredentials ?? false,
            mock,
            cfg,
            deps,
            deps.now(),
          );
        }
      }
    } catch {
      fake = null;
    }
    if (fake) return fake as unknown as EventSource;
    return eventSourceInitDict === undefined ? new Native(url) : new Native(url, eventSourceInitDict);
  } as unknown as typeof EventSource;

  Object.defineProperty(Patched, 'prototype', { value: Native.prototype });
  Object.defineProperty(Patched, Symbol.hasInstance, {
    value: (x: unknown) => x instanceof Native || x instanceof FakeEventSource,
  });
  for (const [k, v] of Object.entries({ CONNECTING, OPEN, CLOSED })) {
    Object.defineProperty(Patched, k, { value: v, enumerable: true });
  }
  Object.defineProperty(Patched, 'name', { value: 'EventSource' });

  win.EventSource = Patched;
  return () => {
    win.EventSource = Native;
  };
}
