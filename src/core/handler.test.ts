import { describe, expect, it } from 'vitest';
import { buildInput, errorReply, matchParams, toReply } from './handler';
import type { Mock } from './types';

const mock: Mock = {
  id: 'm1',
  enabled: true,
  method: 'GET',
  urlPattern: '/doc/:id',
  reply: 'code',
  code: 'return 1',
  response: { status: 201, headers: { 'x-a': '1' }, body: 'ignored', bodyEncoding: 'text', delayMs: 30 },
  source: 'manual',
  createdAt: 0,
};

describe('matchParams', () => {
  it('reads named params', () => {
    expect(matchParams('/doc/:id', 'https://app.test/doc/42?x=1')).toEqual({ id: '42' });
  });
  it('reads params from a host-bound pattern', () => {
    expect(matchParams('https://api.test/u/:user/p/:post', 'https://api.test/u/a/p/b')).toEqual({
      user: 'a',
      post: 'b',
    });
  });
  it('reads params from a host-bound pattern with escapes or an optional group', () => {
    expect(matchParams('https://api.test/v1/:name\\:cancel', 'https://api.test/v1/op7:cancel')).toEqual({
      name: 'op7',
    });
    expect(matchParams('https://api.test/users{/:id}', 'https://api.test/users/5')).toEqual({ id: '5' });
  });
  it('reads a wildcard as a list of segments', () => {
    expect(matchParams('/files/*rest', 'https://app.test/files/a/b')).toEqual({ rest: ['a', 'b'] });
  });
  it('decodes params and gives {} for no match or a bad pattern', () => {
    expect(matchParams('/doc/:id', 'https://app.test/doc/a%20b')).toEqual({ id: 'a b' });
    expect(matchParams('/doc/:id', 'https://app.test/other')).toEqual({});
    expect(matchParams('/doc/(', 'https://app.test/doc/1')).toEqual({});
  });
});

describe('buildInput', () => {
  it('fills req from the request and res from the mock', () => {
    const input = buildInput(mock, {
      method: 'post',
      url: 'https://app.test/doc/7?q=a&q=b&n=1',
      headers: { authorization: 'x' },
      body: '{"name":"n"}',
    });
    expect(input.req).toEqual({
      method: 'POST',
      url: 'https://app.test/doc/7?q=a&q=b&n=1',
      path: '/doc/7',
      params: { id: '7' },
      query: { q: 'a', n: '1' },
      headers: { authorization: 'x' },
      body: { name: 'n' },
      bodyText: '{"name":"n"}',
      callCount: 1,
    });
    expect(input.res).toEqual({ status: 201, headers: { 'x-a': '1' }, delayMs: 30 });
  });
  it('keeps a non-JSON body as text, and no body as undefined', () => {
    expect(buildInput(mock, { method: 'GET', url: 'https://a.test/doc/1', headers: {}, body: 'a=1' }).req.body).toBe('a=1');
    expect(buildInput(mock, { method: 'GET', url: 'https://a.test/doc/1', headers: {} }).req.body).toBeUndefined();
  });
  it('does not share the mock headers object', () => {
    const input = buildInput(mock, { method: 'GET', url: 'https://a.test/doc/1', headers: {} });
    input.res.headers['x-b'] = '2';
    expect(mock.response.headers).toEqual({ 'x-a': '1' });
  });
});

describe('toReply', () => {
  const res = { status: 200, headers: {}, delayMs: 0 };
  it('a JSON value gets content-type application/json unless one is set', () => {
    expect(toReply({ ok: true, kind: 'json', value: '{"a":1}', res }).response).toEqual({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
      bodyEncoding: 'text',
      delayMs: 0,
    });
    const own = toReply({ ok: true, kind: 'json', value: '1', res: { ...res, headers: { 'Content-Type': 'text/x' } } });
    expect(own.response.headers).toEqual({ 'Content-Type': 'text/x' });
  });
  it('a string is the body as-is with no added header', () => {
    const r = toReply({ ok: true, kind: 'string', value: 'hi', res });
    expect(r.response.body).toBe('hi');
    expect(r.response.headers).toEqual({});
  });
  it('undefined is an empty body; bytes are base64', () => {
    expect(toReply({ ok: true, kind: 'undefined', res }).response.body).toBe('');
    const b = toReply({ ok: true, kind: 'bytes', value: 'AAE=', res }).response;
    expect(b.body).toBe('AAE=');
    expect(b.bodyEncoding).toBe('base64');
  });
  it('takes status, delay and stringified headers from res', () => {
    const r = toReply({ ok: true, kind: 'string', value: '', res: { status: 404, delayMs: 5, headers: { n: 3, gone: null } } });
    expect(r.response.status).toBe(404);
    expect(r.response.delayMs).toBe(5);
    expect(r.response.headers).toEqual({ n: '3' });
    expect(r.error).toBeUndefined();
  });
  it('rejects a bad status or delay with the error reply', () => {
    for (const status of [199, 600, 200.5, 'x', undefined]) {
      const r = toReply({ ok: true, kind: 'string', value: '', res: { status } });
      expect(r.response.status).toBe(500);
      expect(r.error).toMatch(/res\.status/);
    }
    expect(toReply({ ok: true, kind: 'string', value: '', res: { status: 200, delayMs: -1 } }).error).toMatch(/delayMs/);
  });
  it('a failed outcome becomes the error reply', () => {
    expect(toReply({ ok: false, error: 'boom' })).toEqual(errorReply('boom'));
  });
});

describe('errorReply', () => {
  it('is status 500 with the marker header and the message in JSON', () => {
    expect(errorReply('bad')).toEqual({
      error: 'bad',
      response: {
        status: 500,
        headers: { 'content-type': 'application/json', 'x-wemock-error': '1' },
        body: '{"wemockError":"bad"}',
        bodyEncoding: 'text',
        delayMs: 0,
      },
    });
  });
});
