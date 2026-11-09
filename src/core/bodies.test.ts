import { describe, expect, it } from 'vitest';
import {
  isTextual,
  bytesToBase64,
  base64ToBytes,
  encodeBody,
  mockBodyBytes,
  capBody,
} from './bodies';
import { BODY_CAP_BYTES, type MockResponse } from './types';

describe('bodies', () => {
  describe('isTextual', () => {
    it('detects json mime types including vendor types', () => {
      expect(isTextual('application/json')).toBe(true);
      expect(isTextual('application/vnd.api+json; charset=utf-8')).toBe(true);
      expect(isTextual('application/problem+json')).toBe(true);
    });

    it('detects xml, javascript, urlencoded, graphql, text types', () => {
      expect(isTextual('text/plain')).toBe(true);
      expect(isTextual('text/html; charset=utf-8')).toBe(true);
      expect(isTextual('application/xml')).toBe(true);
      expect(isTextual('image/svg+xml')).toBe(true);
      expect(isTextual('application/javascript')).toBe(true);
      expect(isTextual('text/javascript')).toBe(true);
      expect(isTextual('application/x-www-form-urlencoded')).toBe(true);
      expect(isTextual('application/graphql')).toBe(true);
    });

    it('treats missing content type as textual', () => {
      expect(isTextual(null)).toBe(true);
      expect(isTextual('')).toBe(true);
    });

    it('returns false for binary types', () => {
      expect(isTextual('image/png')).toBe(false);
      expect(isTextual('image/jpeg')).toBe(false);
      expect(isTextual('application/pdf')).toBe(false);
      expect(isTextual('application/octet-stream')).toBe(false);
      expect(isTextual('audio/mpeg')).toBe(false);
    });
  });

  describe('bytesToBase64 and base64ToBytes', () => {
    it('roundtrips binary bytes', () => {
      const png = new Uint8Array([137, 80, 78, 71, 0, 255]);
      const b64 = bytesToBase64(png);
      expect(base64ToBytes(b64)).toEqual(png);
    });

    it('handles empty bytes', () => {
      const empty = new Uint8Array(0);
      expect(bytesToBase64(empty)).toBe('');
      expect(base64ToBytes('')).toEqual(empty);
    });

    it('handles large byte arrays without stack overflow (chunked)', () => {
      const large = new Uint8Array(20000);
      for (let i = 0; i < large.length; i++) {
        large[i] = i % 256;
      }
      const b64 = bytesToBase64(large);
      expect(base64ToBytes(b64)).toEqual(large);
    });
  });

  describe('encodeBody', () => {
    it('truncates bodies over BODY_CAP_BYTES (1 MB)', () => {
      const big = new TextEncoder().encode('é'.repeat(600_000)); // ~1.2 MB in bytes
      expect(encodeBody(big, 'application/json')).toEqual({
        body: null,
        encoding: 'text',
        truncated: true,
      });

      const bigBin = new Uint8Array(1_048_577);
      expect(encodeBody(bigBin, 'image/png')).toEqual({
        body: null,
        encoding: 'base64',
        truncated: true,
      });
    });

    it('encodes non-truncated textual body as UTF-8 string', () => {
      const bytes = new TextEncoder().encode('{"hello":"world"}');
      expect(encodeBody(bytes, 'application/json')).toEqual({
        body: '{"hello":"world"}',
        encoding: 'text',
        truncated: false,
      });
    });

    it('encodes non-truncated binary body as base64', () => {
      const png = new Uint8Array([137, 80, 78, 71, 0, 255]);
      expect(encodeBody(png, 'image/png')).toEqual({
        body: bytesToBase64(png),
        encoding: 'base64',
        truncated: false,
      });
    });

    it('keeps textual body of exactly BODY_CAP_BYTES bytes and truncates at BODY_CAP_BYTES + 1', () => {
      const exact = new Uint8Array(BODY_CAP_BYTES);
      exact.fill(97);
      const exactRes = encodeBody(exact, 'text/plain');
      expect(exactRes.truncated).toBe(false);
      expect(exactRes.body?.length).toBe(BODY_CAP_BYTES);

      const oneMore = new Uint8Array(BODY_CAP_BYTES + 1);
      oneMore.fill(97);
      const oneMoreRes = encodeBody(oneMore, 'text/plain');
      expect(oneMoreRes.truncated).toBe(true);
      expect(oneMoreRes.body).toBeNull();
    });
  });

  describe('capBody', () => {
    it('keeps multi-byte UTF-8 character ending exactly at maxBytes and drops it when crossing', () => {
      const input = new TextEncoder().encode('abéextra');
      const kept = capBody(input, 4);
      expect(kept).toEqual(new TextEncoder().encode('abé'));
      expect(kept.byteLength).toBe(4);

      const dropped = capBody(input, 3);
      expect(dropped).toEqual(new TextEncoder().encode('ab'));
      expect(dropped.byteLength).toBe(2);
    });
  });

  describe('mockBodyBytes', () => {
    const baseResp: MockResponse = {
      status: 200,
      headers: {},
      body: '',
      bodyEncoding: 'text',
      delayMs: 0,
    };

    it('decodes text body', () => {
      expect(mockBodyBytes({ ...baseResp, body: 'hé', bodyEncoding: 'text' })).toEqual(
        new TextEncoder().encode('hé'),
      );
    });

    it('decodes base64 body', () => {
      const png = new Uint8Array([137, 80, 78, 71, 0, 255]);
      const b64 = bytesToBase64(png);
      expect(mockBodyBytes({ ...baseResp, body: b64, bodyEncoding: 'base64' })).toEqual(png);
    });
  });
});
