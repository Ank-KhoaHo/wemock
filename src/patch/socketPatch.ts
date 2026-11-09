import {
  completionMessage,
  frame,
  handshakeError,
  HANDSHAKE_OK,
  invocationMessage,
  MessageType,
  parseArguments,
  parseMessage,
  parseResult,
  PING_INTERVAL_MS,
  PING_MESSAGE,
  splitMessages,
  withoutPings,
} from '../core/signalr';
import { findSocket } from '../core/sockets';
import { SOCKET_LOG_CAP, type LogDraft, type Settings, type SocketMock, type SocketPush, type SocketReply } from '../core/types';
import { announce } from './announce';
import { pageOriginOf, type PatchDeps } from './fetchPatch';

// Spec A5. Replaces window.WebSocket. A URL that matches an enabled socket mock gets a
// fake socket that never touches the network; every other URL gets the native socket.

declare global {
  interface Window {
    WebSocket: typeof WebSocket;
    EventTarget: typeof EventTarget;
  }
}

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

type Handler = ((this: unknown, ev: Event) => unknown) | null;

interface Answer {
  has: boolean;
  value?: unknown;
  error?: string;
}

let connections = 0;
/** No crypto.randomUUID here: plain-http pages are not secure contexts. */
function newConnectionId(): string {
  connections += 1;
  return `c${connections}-${Math.random().toString(36).slice(2, 10)}`;
}

function frameText(data: unknown): string {
  if (typeof data === 'string') return data;
  let size = 0;
  if (data instanceof ArrayBuffer) size = data.byteLength;
  else if (ArrayBuffer.isView(data)) size = data.byteLength;
  else if (data && typeof data === 'object' && 'size' in data) size = Number((data as Blob).size) || 0;
  return `[binary ${size} bytes]`;
}

function firstProtocol(protocols?: string | string[]): string {
  if (Array.isArray(protocols)) return protocols[0] ?? '';
  return typeof protocols === 'string' ? protocols : '';
}

export function installSocketPatch(win: Window, deps: PatchDeps): () => void {
  const Native = win.WebSocket;
  if (typeof Native !== 'function') return () => {};
  const BaseTarget = (win.EventTarget ?? EventTarget) as typeof EventTarget;

  function makeMessageEvent(data: string, origin: string): Event {
    const Ctor = (win as unknown as { MessageEvent?: typeof MessageEvent }).MessageEvent ?? MessageEvent;
    return new Ctor('message', { data, origin });
  }

  function makeCloseEvent(code: number, reason: string): Event {
    const Ctor = (win as unknown as { CloseEvent?: typeof CloseEvent }).CloseEvent;
    if (typeof Ctor === 'function') return new Ctor('close', { code, reason, wasClean: true });
    const ev = new Event('close');
    Object.defineProperties(ev, { code: { value: code }, reason: { value: reason }, wasClean: { value: true } });
    return ev;
  }

  function report(d: LogDraft): void {
    try {
      deps.report(d);
    } catch {
      // the log is best effort
    }
  }

  class FakeSocket extends BaseTarget {
    static readonly CONNECTING = CONNECTING;
    static readonly OPEN = OPEN;
    static readonly CLOSING = CLOSING;
    static readonly CLOSED = CLOSED;
    readonly CONNECTING = CONNECTING;
    readonly OPEN = OPEN;
    readonly CLOSING = CLOSING;
    readonly CLOSED = CLOSED;

    readonly url: string;
    readonly protocol: string;
    readonly extensions = '';
    binaryType: BinaryType = 'blob';
    bufferedAmount = 0;
    readyState: number = CONNECTING;
    onopen: Handler = null;
    onmessage: Handler = null;
    onerror: Handler = null;
    onclose: Handler = null;

    private readonly _mock: SocketMock;
    private readonly _origin: string;
    private readonly _timers = new Set<ReturnType<typeof setTimeout>>();
    private _ping: ReturnType<typeof setInterval> | null = null;
    private _handshakeDone = false;
    private readonly _connectionId = newConnectionId();

    constructor(url: string, protocol: string, mock: SocketMock, settings: Settings) {
      super();
      this.url = url;
      this.protocol = protocol;
      this._mock = mock;
      this._origin = (() => {
        try {
          return new URL(url).origin;
        } catch {
          return '';
        }
      })();
      const startedAt = deps.now();
      this._later(0, () => {
        if (this.readyState !== CONNECTING) return;
        this.readyState = OPEN;
        this._log('WS', { status: 101 });
        announce(deps.console, settings, { method: 'WS', url, status: 101, mock, durationMs: deps.now() - startedAt }, pageOriginOf(win));
        this._emit('open', new Event('open'));
        if (mock.kind === 'plain') this._timeline(mock.onConnect);
      });
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      if (this.readyState === CONNECTING) {
        throw new DOMException("Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.", 'InvalidStateError');
      }
      if (this.readyState !== OPEN) return;
      const text = typeof data === 'string' ? data : null;
      if (this._mock.kind === 'plain') {
        this._log('WS ↑', { requestBody: text ?? '[binary frame]' });
        void this._plainMessage(text);
        return;
      }
      if (text === null) return; // the JSON hub protocol sends text only
      for (const message of splitMessages(text)) {
        void this._signalrMessage(message);
      }
    }

    close(code?: number, reason?: string): void {
      if (code !== undefined && code !== 1000 && (code < 3000 || code > 4999)) {
        throw new DOMException(`Failed to execute 'close' on 'WebSocket': The close code must be either 1000, or between 3000 and 4999. ${code} is neither.`, 'InvalidAccessError');
      }
      this._shut(code ?? 1005, reason ?? '');
    }

    // --- server side -------------------------------------------------------

    private _shut(code: number, reason: string): void {
      if (this.readyState === CLOSING || this.readyState === CLOSED) return;
      this.readyState = CLOSING;
      for (const t of this._timers) clearTimeout(t);
      this._timers.clear();
      if (this._ping !== null) clearInterval(this._ping);
      this._ping = null;
      setTimeout(() => {
        this.readyState = CLOSED;
        this._emit('close', makeCloseEvent(code, reason));
      }, 0);
    }

    private _later(ms: number, fn: () => void): void {
      const t = setTimeout(() => {
        this._timers.delete(t);
        try {
          fn();
        } catch {
          // a mock must never break the page
        }
      }, Math.max(0, ms));
      this._timers.add(t);
    }

    private _emit(type: string, ev: Event): void {
      this.dispatchEvent(ev);
      const handler = (this as unknown as Record<string, Handler>)[`on${type}`];
      if (typeof handler === 'function') {
        try {
          handler.call(this, ev);
        } catch (err) {
          // like a real socket: the page's own error is reported, not swallowed
          setTimeout(() => {
            throw err;
          }, 0);
        }
      }
    }

    /** Like a real server: never inside the page's send(), and in the order queued. */
    private _serverSend(text: string, logText: string | null): void {
      this._later(0, () => this._deliver(text, logText));
    }

    private _deliver(text: string, logText: string | null): void {
      if (this.readyState !== OPEN) return;
      if (logText !== null) this._log('WS ↓', { responseBody: logText });
      this._emit('message', makeMessageEvent(text, this._origin));
    }

    /** Runs inside its own timeline timer, so it delivers at once. */
    private _push(p: SocketPush): void {
      if (this._mock.kind === 'plain') {
        this._deliver(p.data, p.data);
      } else {
        const msg = invocationMessage(p.target, parseArguments(p.data));
        this._deliver(msg, msg.slice(0, -1));
      }
    }

    private _timeline(pushes: SocketPush[]): void {
      for (const p of pushes) this._later(p.afterMs, () => this._push(p));
    }

    private async _answer(rule: SocketReply, body: string | undefined): Promise<Answer> {
      if (rule.respond !== 'code') {
        return this._mock.kind === 'signalr' ? parseResult(rule.result) : { has: rule.result !== '', value: rule.result };
      }
      if (!deps.runHandler) return { has: false, error: 'Code replies cannot run here' };
      try {
        const reply = await deps.runHandler(rule.id, { method: 'WS', url: this.url, headers: {}, body });
        if (reply.error) return { has: false, error: reply.error };
        const r = reply.response;
        const isJson = Object.entries(r.headers).some(([k, v]) => k.toLowerCase() === 'content-type' && v.includes('json'));
        if (this._mock.kind === 'plain') return { has: r.body !== '', value: r.body };
        if (isJson) return { has: true, value: JSON.parse(r.body) as unknown };
        return r.body === '' ? { has: false } : { has: true, value: r.body };
      } catch (err) {
        return { has: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    private async _plainMessage(text: string | null): Promise<void> {
      const rule = this._mock.replies.find((r) => r.when === '' || (text !== null && text.includes(r.when)));
      if (!rule) return;
      const answer = await this._answer(rule, text ?? undefined);
      if (answer.error) {
        this._log('WS ↓', { responseBody: null, error: answer.error });
        this._warn(answer.error);
      } else if (answer.has) {
        const out = typeof answer.value === 'string' ? answer.value : JSON.stringify(answer.value);
        this._serverSend(out, out);
      }
      this._timeline(rule.pushes);
    }

    private async _signalrMessage(message: string): Promise<void> {
      if (!this._handshakeDone) {
        this._log('WS ↑', { requestBody: message });
        const err = handshakeError(message);
        if (err) {
          const res = frame({ error: err });
          // The error goes out first, then the server closes, as a real hub does.
          this._later(0, () => {
            this._deliver(res, res.slice(0, -1));
            this._shut(1000, '');
          });
          return;
        }
        this._handshakeDone = true;
        this._serverSend(HANDSHAKE_OK, '{}');
        this._timeline(this._mock.onConnect);
        this._ping = setInterval(() => this._serverSend(PING_MESSAGE, null), PING_INTERVAL_MS);
        return;
      }
      const msg = parseMessage(message);
      if (!msg || msg.type === MessageType.Ping) return;
      this._log('WS ↑', { requestBody: message });
      if (msg.type === MessageType.Close) {
        this._shut(1000, '');
        return;
      }
      if (msg.type === MessageType.StreamInvocation && msg.invocationId !== undefined) {
        const res = completionMessage(msg.invocationId, { has: false }, 'wemock does not mock streams');
        this._serverSend(res, res.slice(0, -1));
        return;
      }
      if (msg.type !== MessageType.Invocation) return;
      const rule = this._mock.replies.find((r) => r.when === msg.target);
      if (!rule) {
        if (msg.invocationId !== undefined) {
          const res = completionMessage(msg.invocationId, { has: false });
          this._serverSend(res, res.slice(0, -1));
        }
        return;
      }
      const answer = await this._answer(rule, JSON.stringify(msg.arguments ?? []));
      if (answer.error) this._warn(answer.error);
      if (msg.invocationId !== undefined) {
        const res = completionMessage(msg.invocationId, answer, answer.error);
        this._serverSend(res, res.slice(0, -1));
      }
      this._timeline(rule.pushes);
    }

    private _warn(error: string): void {
      try {
        deps.console?.warn(`[wemock] WS ${this.url} mock ${this._mock.name ? `"${this._mock.name}"` : this._mock.urlPattern}: code failed: ${error}`);
      } catch {
        // best effort
      }
    }

    private _log(method: string, part: { status?: number; requestBody?: string; responseBody?: string | null; error?: string }): void {
      report({
        method,
        url: this.url,
        ...(part.requestBody !== undefined ? { requestBody: part.requestBody } : {}),
        status: part.status ?? 0,
        responseHeaders: {},
        responseBody: part.responseBody ?? null,
        responseEncoding: 'text',
        truncated: false,
        durationMs: 0,
        badge: 'MOCK',
        mockId: this._mock.id,
        ...(part.error ? { error: part.error } : {}),
        connectionId: this._connectionId,
        startedAt: deps.now(),
      });
    }
  }

  /** A6: log a real socket's open and messages, so "Mock this socket" can rebuild it. */
  function watchReal(ws: WebSocket): void {
    try {
      const connectionId = newConnectionId();
      let count = 0;
      let capped = false;
      const log = (method: string, part: { status?: number; requestBody?: string; responseBody?: string | null }) => {
        if (method !== 'WS') {
          if (count >= SOCKET_LOG_CAP) {
            if (!capped) {
              capped = true;
              log('WS', { responseBody: `Further messages on this socket are not logged (${SOCKET_LOG_CAP} at most)` });
            }
            return;
          }
          count += 1;
        }
        report({
          method,
          url: ws.url,
          ...(part.requestBody !== undefined ? { requestBody: part.requestBody } : {}),
          status: part.status ?? 0,
          responseHeaders: {},
          responseBody: part.responseBody ?? null,
          responseEncoding: 'text',
          truncated: false,
          durationMs: 0,
          badge: 'real',
          connectionId,
          startedAt: deps.now(),
        });
      };
      ws.addEventListener('open', () => log('WS', { status: 101 }));
      ws.addEventListener('message', (e: MessageEvent) => {
        const text = withoutPings(frameText(e.data));
        if (text) log('WS ↓', { responseBody: text });
      });
      const nativeSend = Native.prototype.send;
      Object.defineProperty(ws, 'send', {
        configurable: true,
        writable: true,
        value: function send(this: WebSocket, data: string | ArrayBufferLike | Blob | ArrayBufferView) {
          nativeSend.call(this, data); // throws like the native one when not open
          try {
            const text = withoutPings(frameText(data));
            if (text) log('WS ↑', { requestBody: text });
          } catch {
            // logging never changes what the page sees
          }
        },
      });
    } catch {
      // a real socket must work even when watching it fails
    }
  }

  const Patched = function (this: unknown, url: string | URL, protocols?: string | string[]): WebSocket {
    if (!new.target) {
      // Same TypeError the native constructor gives without `new`.
      return (Native as unknown as (u: unknown, p?: unknown) => WebSocket)(url, protocols);
    }
    let fake: FakeSocket | null = null;
    try {
      const cfg = deps.gate.current();
      if (cfg && cfg.settings.enabled && cfg.sockets && cfg.sockets.length > 0) {
        const abs = new URL(String(url), win.location.href).href;
        const mock = findSocket(cfg.sockets, abs);
        if (mock) fake = new FakeSocket(abs, firstProtocol(protocols), mock, cfg.settings);
      }
    } catch {
      fake = null;
    }
    if (fake) return fake as unknown as WebSocket;
    const ws = protocols === undefined ? new Native(url) : new Native(url, protocols);
    watchReal(ws);
    return ws;
  } as unknown as typeof WebSocket;

  Object.defineProperty(Patched, 'prototype', { value: Native.prototype });
  Object.defineProperty(Patched, Symbol.hasInstance, {
    value: (x: unknown) => x instanceof Native || x instanceof FakeSocket,
  });
  for (const [k, v] of Object.entries({ CONNECTING, OPEN, CLOSING, CLOSED })) {
    Object.defineProperty(Patched, k, { value: v, enumerable: true });
  }
  Object.defineProperty(Patched, 'name', { value: 'WebSocket' });

  win.WebSocket = Patched;
  return () => {
    win.WebSocket = Native;
  };
}
