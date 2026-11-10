import { statusTextFor } from './statusText';
import type { BodyEncoding, LogEntry } from './types';

function isJson(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

export function logToHar(entries: LogEntry[]): { har: unknown; skippedSockets: number } {
  let skippedSockets = 0;
  const harEntries: unknown[] = [];

  for (const entry of entries) {
    if (entry.method.startsWith('WS')) {
      skippedSockets++;
      continue;
    }

    let mimeType = '';
    for (const [k, v] of Object.entries(entry.responseHeaders)) {
      if (k.toLowerCase() === 'content-type') {
        mimeType = v;
        break;
      }
    }

    const text = entry.truncated ? '' : (entry.responseBody ?? '');

    const content: {
      size: number;
      mimeType: string;
      text: string;
      encoding?: BodyEncoding;
    } = {
      size: text.length,
      mimeType,
      text,
      ...(entry.responseEncoding === 'base64' ? { encoding: 'base64' } : {}),
    };

    const postData =
      entry.requestBody !== undefined
        ? {
            mimeType: isJson(entry.requestBody) ? 'application/json' : 'text/plain',
            text: entry.requestBody,
          }
        : undefined;

    const responseHeaders = Object.entries(entry.responseHeaders).map(([name, value]) => ({
      name,
      value,
    }));

    harEntries.push({
      startedDateTime: new Date(entry.startedAt).toISOString(),
      time: entry.durationMs,
      request: {
        method: entry.method,
        url: entry.url,
        httpVersion: 'HTTP/1.1',
        headers: [],
        queryString: [],
        cookies: [],
        headersSize: -1,
        bodySize: -1,
        ...(postData !== undefined ? { postData } : {}),
      },
      response: {
        status: entry.status,
        statusText: statusTextFor(entry.status),
        httpVersion: 'HTTP/1.1',
        headers: responseHeaders,
        cookies: [],
        content,
        redirectURL: '',
        headersSize: -1,
        bodySize: -1,
      },
      cache: {},
      timings: {
        send: 0,
        wait: entry.durationMs,
        receive: 0,
      },
      _resourceType: 'fetch',
      _wemockBadge: entry.badge,
    });
  }

  return {
    har: {
      log: {
        version: '1.2',
        creator: {
          name: 'wemock',
          version: '1',
        },
        entries: harEntries,
      },
    },
    skippedSockets,
  };
}
