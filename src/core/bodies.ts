import { TEMPLATE_TAG } from './template';
import { type BodyEncoding, BODY_CAP_BYTES, type Mock, type MockResponse } from './types';

export function isTextual(contentType: string | null | undefined): boolean {
  if (!contentType) return true;
  const mime = (contentType.toLowerCase().split(';')[0] ?? '').trim();
  if (mime.startsWith('text/')) return true;
  if (mime.includes('json')) return true;
  if (mime.includes('xml')) return true;
  if (mime.includes('javascript')) return true;
  if (mime === 'application/x-www-form-urlencoded') return true;
  if (mime === 'application/graphql') return true;
  return false;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToBytes(s: string): Uint8Array {
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function encodeBody(
  bytes: Uint8Array,
  contentType: string | null,
): { body: string | null; encoding: BodyEncoding; truncated: boolean } {
  const textual = isTextual(contentType);
  const encoding: BodyEncoding = textual ? 'text' : 'base64';

  if (bytes.byteLength > BODY_CAP_BYTES) {
    return { body: null, encoding, truncated: true };
  }

  if (textual) {
    const body = new TextDecoder('utf-8').decode(bytes);
    return { body, encoding: 'text', truncated: false };
  }

  const body = bytesToBase64(bytes);
  return { body, encoding: 'base64', truncated: false };
}

/**
 * Above this many characters the body editor shows plain text. CodeMirror's JSON parser
 * re-reads a large body while the user types elsewhere in the panel (150 ms a key at 1.4 MB).
 */
export const JSON_EDITOR_MAX_CHARS = 100_000;

/** The editor language for a body: JSON when it is small and starts like JSON, else plain text. */
export function bodyLanguage(body: string): 'json' | 'text' {
  if (body.length > JSON_EDITOR_MAX_CHARS) return 'text';
  const first = body.trimStart()[0];
  return first === '{' || first === '[' ? 'json' : 'text';
}

const JSON_INDENT = '  ';
// A template tag is one token, kept as typed.
const JSON_TOKEN = new RegExp(String.raw`"(?:[^"\\]|\\.)*"|${TEMPLATE_TAG.source}|[{}[\],:]|[^\s{}[\],:"]+`, 'g');
const JSON_OPENERS = new Set(['{', '[']);
const JSON_CLOSERS = new Set(['}', ']']);

export interface JsonBodyOptions {
  /** Fill {{templates}} is on: a tag counts as a JSON value. */
  templates?: boolean;
}

/** The parsed body, or undefined when it is not JSON. */
function parseJson(text: string, { templates = false }: JsonBodyOptions): unknown {
  const filled = templates ? text.replace(TEMPLATE_TAG, (tag, escaped) => (escaped ? tag : '0')) : text;
  try {
    return JSON.parse(filled);
  } catch {
    return undefined;
  }
}

export function isJson(text: string, options: JsonBodyOptions = {}): boolean {
  return parseJson(text, options) !== undefined;
}

export function isJsonContainer(text: string, options: JsonBodyOptions = {}): boolean {
  const value = parseJson(text, options);
  return typeof value === 'object' && value !== null;
}

function jsonContainerTokens(text: string, options: JsonBodyOptions): string[] | null {
  return isJsonContainer(text, options) ? (text.match(JSON_TOKEN) ?? []) : null;
}

export function compactJson(text: string, options: JsonBodyOptions = {}): string {
  return jsonContainerTokens(text, options)?.join('') ?? text;
}

export function withBody(mock: Mock, transform: (body: string, options: JsonBodyOptions) => string): Mock {
  const body = transform(mock.response.body, { templates: mock.templates });
  return { ...mock, response: { ...mock.response, body } };
}

export function formatJson(text: string, options: JsonBodyOptions = {}): string {
  const tokens = jsonContainerTokens(text, options);
  if (!tokens) return text;

  const parts: string[] = [];
  let depth = 0;
  let prev = '';
  for (const token of tokens) {
    const closes = JSON_CLOSERS.has(token);
    if (closes) depth--;
    const startsLine = prev === ',' || JSON_OPENERS.has(prev) !== closes;
    if (startsLine) parts.push('\n', JSON_INDENT.repeat(depth));
    parts.push(token === ':' ? ': ' : token);
    if (JSON_OPENERS.has(token)) depth++;
    prev = token;
  }
  return parts.join('');
}

export function mockBodyBytes(r: MockResponse): Uint8Array {
  if (r.bodyEncoding === 'base64') {
    return base64ToBytes(r.body);
  }
  return new TextEncoder().encode(r.body);
}

export function capBody(bytes: Uint8Array, maxBytes: number = BODY_CAP_BYTES): Uint8Array {
  if (bytes.byteLength <= maxBytes) return bytes;
  let end = maxBytes;
  let i = end - 1;
  while (i >= 0 && ((bytes[i] ?? 0) & 0xc0) === 0x80 && end - i < 4) {
    i--;
  }
  if (i >= 0) {
    const lead = bytes[i] ?? 0;
    let seqLen = 1;
    if ((lead & 0xe0) === 0xc0) seqLen = 2;
    else if ((lead & 0xf0) === 0xe0) seqLen = 3;
    else if ((lead & 0xf8) === 0xf0) seqLen = 4;
    if (i + seqLen > end) {
      end = i;
    }
  }
  return bytes.subarray(0, end);
}
