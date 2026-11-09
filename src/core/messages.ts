import type { LogDraft, Mock, Settings } from './types';

export const PAGE_SOURCE = 'wemock-page';
export const BRIDGE_SOURCE = 'wemock-bridge';

export type PageToBridge = {
  source: typeof PAGE_SOURCE;
  type: 'log';
  entry: LogDraft;
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
