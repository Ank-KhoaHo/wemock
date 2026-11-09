import type { Mock, Settings } from '../core/types';

/** The two console methods wemock uses, captured from the page at install. */
export interface PageConsole {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
}

export interface MockedCall {
  method: string;
  url: string;
  status: number;
  mock: Mock;
  durationMs: number;
  /** Set when a code mock failed; the call was answered with the error reply. */
  error?: string;
}

/** Same-origin URLs show path + query; other origins show the full URL. */
export function shortUrl(url: string, pageOrigin: string): string {
  try {
    const u = new URL(url);
    return u.origin === pageOrigin ? `${u.pathname}${u.search}` : u.href;
  } catch {
    return url;
  }
}

export function mockLabel(mock: Mock): string {
  const name = mock.name?.trim();
  return name ? `"${name}"` : mock.urlPattern;
}

/** `[wemock] GET /doc/1 → 200 mock "Doc one" (12 ms)` (spec A4). */
export function announceLine(call: MockedCall, pageOrigin: string): string {
  const ms = Math.max(0, Math.round(call.durationMs));
  return `[wemock] ${call.method.toUpperCase()} ${shortUrl(call.url, pageOrigin)} → ${call.status} mock ${mockLabel(call.mock)} (${ms} ms)`;
}

/** Writes the console line for a mocked call. Never throws into the page. */
export function announce(
  con: PageConsole | undefined,
  settings: Settings,
  call: MockedCall,
  pageOrigin: string,
): void {
  if (!con || settings.consoleLog === false) return;
  try {
    const line = announceLine(call, pageOrigin);
    if (call.error) {
      con.warn(`${line}: code failed: ${call.error}`);
    } else {
      con.info(line);
    }
  } catch {
    // the console line is best effort
  }
}
