import { type BodyEncoding, BODY_CAP_BYTES, type MockResponse } from './types';

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
