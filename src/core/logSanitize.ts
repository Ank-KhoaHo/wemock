import { BODY_CAP_BYTES, type BodyEncoding, type LogDraft, type Badge } from './types';

function isValidBase64(s: string): boolean {
  if (typeof s !== 'string') return false;
  if (s.length === 0) return true;
  if (s.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return false;
  try {
    atob(s);
    return true;
  } catch {
    return false;
  }
}

export function sanitizeLogDraft(raw: unknown): LogDraft | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const r = raw as Record<string, unknown>;

  if (typeof r.method !== 'string') return null;
  if (typeof r.url !== 'string') return null;
  if (typeof r.status !== 'number' || !Number.isFinite(r.status)) return null;
  if (typeof r.durationMs !== 'number' || !Number.isFinite(r.durationMs)) return null;
  if (typeof r.startedAt !== 'number' || !Number.isFinite(r.startedAt)) return null;
  if (typeof r.truncated !== 'boolean') return null;

  if (r.badge !== 'MOCK' && r.badge !== 'real' && r.badge !== 'LATE') return null;
  if (r.responseEncoding !== 'text' && r.responseEncoding !== 'base64') return null;

  if (!r.responseHeaders || typeof r.responseHeaders !== 'object' || Array.isArray(r.responseHeaders)) {
    return null;
  }

  const responseHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.responseHeaders as Record<string, unknown>)) {
    if (typeof v !== 'string') return null;
    responseHeaders[k] = v;
  }

  if (r.responseBody !== null && typeof r.responseBody !== 'string' && r.responseBody !== undefined) {
    return null;
  }

  if (r.requestBody !== undefined && typeof r.requestBody !== 'string') {
    return null;
  }

  if (r.mockId !== undefined && typeof r.mockId !== 'string') {
    return null;
  }

  if (r.error !== undefined && typeof r.error !== 'string') {
    return null;
  }

  if (r.connectionId !== undefined && typeof r.connectionId !== 'string') {
    return null;
  }

  let truncated = r.truncated;
  let responseBody: string | null = (r.responseBody as string | null) ?? null;

  if (responseBody !== null) {
    if (responseBody.length > BODY_CAP_BYTES) {
      responseBody = null;
      truncated = true;
    } else if (r.responseEncoding === 'base64' && !isValidBase64(responseBody)) {
      responseBody = null;
    }
  }

  let requestBody: string | undefined = undefined;
  if (typeof r.requestBody === 'string') {
    if (r.requestBody.length <= BODY_CAP_BYTES) {
      requestBody = r.requestBody;
    }
  }

  const result: LogDraft = {
    method: r.method,
    url: r.url,
    status: r.status,
    responseHeaders,
    responseBody,
    responseEncoding: r.responseEncoding as BodyEncoding,
    truncated,
    durationMs: r.durationMs,
    badge: r.badge as Badge,
    startedAt: r.startedAt,
  };

  if (requestBody !== undefined) {
    result.requestBody = requestBody;
  }
  if (typeof r.mockId === 'string') {
    result.mockId = r.mockId;
  }
  if (typeof r.error === 'string') {
    result.error = r.error;
  }
  if (typeof r.connectionId === 'string') {
    result.connectionId = r.connectionId;
  }

  if (r.requestHeaders !== undefined) {
    if (!r.requestHeaders || typeof r.requestHeaders !== 'object' || Array.isArray(r.requestHeaders)) {
      return null;
    }
    const reqHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.requestHeaders as Record<string, unknown>)) {
      if (typeof v !== 'string') return null;
      reqHeaders[k] = v;
    }
    result.requestHeaders = reqHeaders;
  }

  if (r.changedHeaders !== undefined) {
    if (!Array.isArray(r.changedHeaders)) {
      return null;
    }
    const changed: string[] = [];
    for (const item of r.changedHeaders) {
      if (typeof item !== 'string') return null;
      changed.push(item);
    }
    result.changedHeaders = changed;
  }

  return result;
}
