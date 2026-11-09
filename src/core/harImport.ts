import { scenarioFromLogs } from './record';
import { isValidStatus } from './statusText';
import {
  type BodyEncoding,
  type LogEntry,
  newProject,
  type Project,
} from './types';

export interface HarSummary {
  mocks: number;
  calls: number;
  skipped: number;
}

export type HarImportResult =
  | {
      ok: true;
      result: {
        project: Project;
        summary: HarSummary;
      };
    }
  | {
      ok: false;
      error: string;
    };

interface HarHeader {
  name?: unknown;
  value?: unknown;
}

interface HarContent {
  mimeType?: unknown;
  text?: unknown;
  encoding?: unknown;
}

interface HarPostData {
  text?: unknown;
}

interface HarRequest {
  method?: unknown;
  url?: unknown;
  postData?: HarPostData;
}

interface HarResponse {
  status?: unknown;
  headers?: HarHeader[];
  content?: HarContent;
}

interface HarEntry {
  startedDateTime?: unknown;
  _resourceType?: unknown;
  request?: HarRequest;
  response?: HarResponse;
}

export function detectHar(data: unknown): boolean {
  if (!data || typeof data !== 'object') {
    return false;
  }
  const obj = data as Record<string, unknown>;
  if (!('log' in obj) || !obj.log || typeof obj.log !== 'object') {
    return false;
  }
  const log = obj.log as Record<string, unknown>;
  return 'entries' in log && Array.isArray(log.entries);
}

function isKeptMimeType(mimeType: unknown): boolean {
  if (typeof mimeType !== 'string') return false;
  const mime = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!mime) return false;
  if (mime === 'application/json' || mime.endsWith('+json')) return true;
  if (mime === 'application/xml' || mime === 'text/xml' || mime.endsWith('+xml')) return true;
  if (mime === 'text/plain') return true;
  return false;
}

function shouldKeepEntry(entry: HarEntry): boolean {
  const resourceType = entry._resourceType;
  if (typeof resourceType === 'string' && resourceType.trim().length > 0) {
    const t = resourceType.trim().toLowerCase();
    return t === 'xhr' || t === 'fetch';
  }
  return isKeptMimeType(entry.response?.content?.mimeType);
}

export function importHar(
  data: unknown,
  fileName: string,
  pageOrigin: string,
  newId: () => string,
  now: number,
): HarImportResult {
  if (!detectHar(data)) {
    return { ok: false, error: 'Unrecognized HAR format' };
  }

  const log = (data as { log: { entries: unknown[] } }).log;
  const rawEntries = log.entries;
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    return { ok: false, error: 'This HAR file has no calls wemock can mock' };
  }

  let calls = 0;
  let skipped = 0;
  const logEntries: LogEntry[] = [];

  for (const raw of rawEntries) {
    if (!raw || typeof raw !== 'object') {
      skipped++;
      continue;
    }

    const entry = raw as HarEntry;
    if (!shouldKeepEntry(entry)) {
      skipped++;
      continue;
    }

    const rawStatus = entry.response?.status;
    const status = typeof rawStatus === 'number' ? rawStatus : Number(rawStatus);
    if (!isValidStatus(status)) {
      skipped++;
      continue;
    }

    const url = entry.request?.url;
    if (typeof url !== 'string' || !url.trim()) {
      skipped++;
      continue;
    }

    calls++;

    const method =
      typeof entry.request?.method === 'string' && entry.request.method.trim()
        ? entry.request.method.trim().toUpperCase()
        : 'GET';

    const requestBody =
      typeof entry.request?.postData?.text === 'string'
        ? entry.request.postData.text
        : undefined;

    const responseHeaders: Record<string, string> = {};
    if (Array.isArray(entry.response?.headers)) {
      for (const h of entry.response.headers) {
        if (h && typeof h === 'object') {
          const name = h.name;
          const value = h.value;
          if (typeof name === 'string' && value !== undefined && value !== null) {
            const lower = name.toLowerCase();
            if (!lower.startsWith(':')) {
              responseHeaders[lower] = String(value);
            }
          }
        }
      }
    }

    const responseBody =
      typeof entry.response?.content?.text === 'string'
        ? entry.response.content.text
        : '';

    const responseEncoding: BodyEncoding =
      entry.response?.content?.encoding === 'base64' ? 'base64' : 'text';

    let startedAt = 0;
    if (typeof entry.startedDateTime === 'string') {
      const parsed = Date.parse(entry.startedDateTime);
      if (!Number.isNaN(parsed)) {
        startedAt = parsed;
      }
    }

    logEntries.push({
      id: `har-entry-${calls}`,
      method,
      url,
      requestBody,
      status,
      responseHeaders,
      responseBody,
      responseEncoding,
      truncated: false,
      durationMs: 0,
      badge: 'real',
      startedAt,
    });
  }

  const scenarioName = `HAR ${fileName}`;
  const harScenario = scenarioFromLogs(logEntries, scenarioName, newId, now, pageOrigin);
  const project = newProject(newId(), pageOrigin);
  project.scenarios.push(harScenario);
  project.activeScenarioId = harScenario.id;

  return {
    ok: true,
    result: {
      project,
      summary: {
        mocks: harScenario.mocks.length,
        calls,
        skipped,
      },
    },
  };
}

export function harSummaryText(summary: {
  mocks: number;
  calls: number;
  skipped: number;
}): string {
  const mockPart = `${summary.mocks} mock${summary.mocks === 1 ? '' : 's'}`;
  const callPart = `${summary.calls} call${summary.calls === 1 ? '' : 's'}`;
  let text = `${mockPart} from ${callPart}`;
  if (summary.skipped > 0) {
    text += ` (${summary.skipped} skipped)`;
  }
  return text;
}
