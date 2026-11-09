import type { HandlerReply, HandlerRequest } from './handler';
import type { LogDraft, Mock, Settings } from './types';

export const PAGE_SOURCE = 'wemock-page';
export const BRIDGE_SOURCE = 'wemock-bridge';
/** A2: background -> offscreen document messages carry this `target`. */
export const OFFSCREEN_TARGET = 'wemock-offscreen';
/** A2: bridge or panel -> background: run a code mock. */
export const RUN_HANDLER = 'run-handler';

export type PageToBridge = {
  source: typeof PAGE_SOURCE;
  type: 'log';
  entry: LogDraft;
};

/** A2: the page asks the bridge to run a code mock. Carries no code. */
export type PageRunHandler = {
  source: typeof PAGE_SOURCE;
  type: 'run-handler';
  callId: string;
  mockId: string;
  request: HandlerRequest;
};

/** A2: the bridge answers a PageRunHandler. */
export type BridgeHandlerResult = {
  source: typeof BRIDGE_SOURCE;
  type: 'handler-result';
  callId: string;
  reply: HandlerReply;
};

export type BridgeToPage = {
  source: typeof BRIDGE_SOURCE;
  type: 'config';
  mocks: Mock[];
  settings: Settings;
};

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

export function isPageToBridge(data: unknown): data is PageToBridge {
  if (!isObject(data)) return false;
  if (data.source !== PAGE_SOURCE) return false;
  if (data.type !== 'log') return false;

  const entry = data.entry;
  if (!isObject(entry)) return false;

  if (typeof entry.method !== 'string') return false;
  if (typeof entry.url !== 'string') return false;
  if (entry.requestBody !== undefined && typeof entry.requestBody !== 'string') return false;
  if (typeof entry.status !== 'number' || Number.isNaN(entry.status)) return false;

  if (!isObject(entry.responseHeaders)) return false;
  for (const v of Object.values(entry.responseHeaders)) {
    if (typeof v !== 'string') return false;
  }

  if (entry.responseBody !== null && typeof entry.responseBody !== 'string') return false;
  if (entry.responseEncoding !== 'text' && entry.responseEncoding !== 'base64') return false;
  if (typeof entry.truncated !== 'boolean') return false;
  if (typeof entry.durationMs !== 'number' || Number.isNaN(entry.durationMs)) return false;
  if (entry.badge !== 'MOCK' && entry.badge !== 'real' && entry.badge !== 'LATE') return false;
  if (entry.mockId !== undefined && typeof entry.mockId !== 'string') return false;
  if (entry.error !== undefined && typeof entry.error !== 'string') return false;
  if (typeof entry.startedAt !== 'number' || Number.isNaN(entry.startedAt)) return false;

  return true;
}

export function isBridgeToPage(data: unknown): data is BridgeToPage {
  if (!isObject(data)) return false;
  if (data.source !== BRIDGE_SOURCE) return false;
  if (data.type !== 'config') return false;
  if (!Array.isArray(data.mocks)) return false;

  const settings = data.settings;
  if (!isObject(settings)) return false;
  if (typeof settings.enabled !== 'boolean') return false;
  if (typeof settings.recording !== 'boolean') return false;
  if (settings.consoleLog !== undefined && typeof settings.consoleLog !== 'boolean') return false;

  return true;
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return isObject(v) && Object.values(v).every((x) => typeof x === 'string');
}

export function isPageRunHandler(data: unknown): data is PageRunHandler {
  if (!isObject(data)) return false;
  if (data.source !== PAGE_SOURCE || data.type !== 'run-handler') return false;
  if (typeof data.callId !== 'string' || typeof data.mockId !== 'string') return false;
  const r = data.request;
  if (!isObject(r)) return false;
  if (typeof r.method !== 'string' || typeof r.url !== 'string' || !isStringRecord(r.headers)) return false;
  if (r.body !== undefined && typeof r.body !== 'string') return false;
  return true;
}

export function isHandlerReply(v: unknown): v is HandlerReply {
  if (!isObject(v)) return false;
  if (v.error !== undefined && typeof v.error !== 'string') return false;
  const r = v.response;
  if (!isObject(r)) return false;
  if (typeof r.status !== 'number' || !Number.isInteger(r.status) || r.status < 200 || r.status > 599) return false;
  if (!isStringRecord(r.headers)) return false;
  if (typeof r.body !== 'string') return false;
  if (r.bodyEncoding !== 'text' && r.bodyEncoding !== 'base64') return false;
  if (typeof r.delayMs !== 'number' || !Number.isFinite(r.delayMs) || r.delayMs < 0) return false;
  return true;
}

export function isBridgeHandlerResult(data: unknown): data is BridgeHandlerResult {
  if (!isObject(data)) return false;
  if (data.source !== BRIDGE_SOURCE || data.type !== 'handler-result') return false;
  if (typeof data.callId !== 'string') return false;
  return isHandlerReply(data.reply);
}
