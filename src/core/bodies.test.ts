import { describe, expect, it } from 'vitest';
import {
  isTextual,
  bytesToBase64,
  base64ToBytes,
  encodeBody,
  mockBodyBytes,
  capBody,
  formatJson,
  compactJson,
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

  describe('formatJson', () => {
    it('spreads one-line JSON over lines with 2-space indent', () => {
      expect(formatJson('{"id":"DOC-011","tags":["a","b"],"n":1}')).toBe(
        '{\n  "id": "DOC-011",\n  "tags": [\n    "a",\n    "b"\n  ],\n  "n": 1\n}',
      );
    });

    it('keeps numbers exactly as written', () => {
      expect(formatJson('{"big":12345678901234567890,"f":1.0,"e":1E+2}')).toBe(
        '{\n  "big": 12345678901234567890,\n  "f": 1.0,\n  "e": 1E+2\n}',
      );
    });

    it('leaves strings alone, including escapes and JSON-looking text', () => {
      expect(formatJson('{"s":"a, b: {c} [d] \\" \\\\","u":"\\u00e9 é"}')).toBe(
        '{\n  "s": "a, b: {c} [d] \\" \\\\",\n  "u": "\\u00e9 é"\n}',
      );
    });

    it('keeps empty objects and arrays on one line', () => {
      expect(formatJson('{"a":{},"b":[ ],"c":[{}]}')).toBe(
        '{\n  "a": {},\n  "b": [],\n  "c": [\n    {}\n  ]\n}',
      );
    });

    it('re-indents JSON that already has other whitespace', () => {
      expect(formatJson('{\n    "a" :  [1 ,2]\n}\n')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
    });

    it.each(['', 'hello', '{"a":', '{"id":{{params.id}}}', '"str"', '42', 'null', '<x/>'])(
      'returns %j unchanged',
      (text) => {
        expect(formatJson(text)).toBe(text);
      },
    );
  });

  describe('compactJson', () => {
    it('drops the whitespace between tokens and keeps it inside strings', () => {
      expect(compactJson('{\n  "s": "a, b: { c }",\n  "tags": [ 1 , 2 ],\n  "e": {}\n}\n')).toBe(
        '{"s":"a, b: { c }","tags":[1,2],"e":{}}',
      );
    });

    it('keeps numbers exactly as written', () => {
      expect(compactJson('{ "big": 12345678901234567890, "f": 1.0 }')).toBe('{"big":12345678901234567890,"f":1.0}');
    });

    it('undoes formatJson', () => {
      const text = '{"id":"DOC-011","items":[{"n":1},{"n":2}],"none":[],"ok":true}';
      expect(compactJson(formatJson(text))).toBe(text);
    });

    it.each(['', 'hello', '{"a":', '{ "id": {{params.id}} }', '"str"', ' 42 ', '<x/>'])(
      'returns %j unchanged',
      (text) => {
        expect(compactJson(text)).toBe(text);
      },
    );
  });
});
