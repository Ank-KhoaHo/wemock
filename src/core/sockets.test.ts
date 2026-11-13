import { describe, expect, it } from 'vitest';
import {
  completionMessage,
  handshakeError,
  HANDSHAKE_OK,
  invocationMessage,
  negotiateBody,
  parseArguments,
  parseMessage,
  parseResult,
  PING_MESSAGE,
  RS,
  splitMessages,
} from './signalr';
import { activeSockets, findAnyMock, findSocket, negotiateSocket } from './sockets';
import { newProject, type Mock, type SocketMock } from './types';

function sock(id: string, urlPattern: string, extra: Partial<SocketMock> = {}): SocketMock {
  return { id, name: id, enabled: true, kind: 'signalr', urlPattern, onConnect: [], replies: [], createdAt: 0, ...extra };
}

describe('signalr messages', () => {
  it('frames end with 0x1E and split back', () => {
    expect(RS).toBe('\u001e');
    expect(HANDSHAKE_OK).toBe('{}\u001e');
    expect(PING_MESSAGE).toBe('{"type":6}\u001e');
    expect(splitMessages('{"a":1}\u001e{"b":2}\u001e')).toEqual(['{"a":1}', '{"b":2}']);
  });
  it('builds invocations and completions', () => {
    expect(invocationMessage('Receive', ['bot', 'hi'])).toBe('{"type":1,"target":"Receive","arguments":["bot","hi"]}\u001e');
    expect(completionMessage('3', { has: true, value: { ok: true } })).toBe('{"type":3,"invocationId":"3","result":{"ok":true}}\u001e');
    expect(completionMessage('3', { has: false })).toBe('{"type":3,"invocationId":"3"}\u001e');
    expect(completionMessage('3', { has: false }, 'bad')).toBe('{"type":3,"invocationId":"3","error":"bad"}\u001e');
  });
  it('reads arguments and results the user typed', () => {
    expect(parseArguments('["a",1]')).toEqual(['a', 1]);
    expect(parseArguments('{"x":1}')).toEqual([{ x: 1 }]);
    expect(parseArguments('  ')).toEqual([]);
    expect(parseArguments('not json')).toEqual(['not json']);
    expect(parseResult('')).toEqual({ has: false });
    expect(parseResult('null')).toEqual({ has: true, value: null });
    expect(parseResult('hi')).toEqual({ has: true, value: 'hi' });
  });
  it('accepts only the JSON protocol in the handshake', () => {
    expect(handshakeError('{"protocol":"json","version":1}')).toBeNull();
    expect(handshakeError('{"protocol":"messagepack","version":1}')).toMatch(/messagepack/);
    expect(handshakeError('nope')).toMatch(/not valid JSON/);
  });
  it('negotiate offers only WebSockets', () => {
    const v = JSON.parse(negotiateBody('c1'));
    expect(v).toMatchObject({ negotiateVersion: 1, connectionId: 'c1', connectionToken: 'c1' });
    expect(v.availableTransports).toEqual([{ transport: 'WebSockets', transferFormats: ['Text', 'Binary'] }]);
  });
  it('parses messages and rejects junk', () => {
    expect(parseMessage('{"type":1,"invocationId":"0","target":"Send","arguments":[1]}')).toEqual({
      type: 1, invocationId: '0', target: 'Send', arguments: [1],
    });
    expect(parseMessage('{"x":1}')).toBeNull();
    expect(parseMessage('nope')).toBeNull();
  });
});

describe('socket matching', () => {
  it('ws and wss URLs match plain and http(s) patterns', () => {
    const s = [sock('a', '/hubs/chat'), sock('b', 'https://api.test/hubs/news'), sock('c', 'wss://api.test/live')];
    expect(findSocket(s, 'ws://app.test/hubs/chat?id=1')?.id).toBe('a');
    expect(findSocket(s, 'wss://api.test/hubs/news')?.id).toBe('b');
    expect(findSocket(s, 'wss://other.test/hubs/news')).toBeNull();
    expect(findSocket(s, 'wss://api.test/live')?.id).toBe('c');
    expect(findSocket(s, 'ws://api.test/live')).toBeNull();
  });
  it('a host-bound socket pattern keeps its escapes', () => {
    const s = [sock('a', String.raw`wss://api.test/v1/live\:stream`)];
    expect(findSocket(s, 'wss://api.test/v1/live:stream')?.id).toBe('a');
    expect(findSocket(s, 'wss://api.test/v1/live/zzz')).toBeNull();
  });
  it('skips disabled sockets and bad URLs', () => {
    expect(findSocket([sock('a', '/x', { enabled: false })], 'ws://a.test/x')).toBeNull();
    expect(findSocket([sock('a', '/x')], 'not a url')).toBeNull();
  });
  it('the active scenario wins over Default', () => {
    const p = newProject('p', 'http://a.test');
    p.scenarios[0]!.sockets = [sock('def', '/x')];
    p.scenarios.push({ id: 's2', name: 'Two', mocks: [], sockets: [sock('two', '/x')] });
    expect(findSocket(activeSockets(p), 'ws://a.test/x')?.id).toBe('def');
    expect(findSocket(activeSockets({ ...p, activeScenarioId: 's2' }), 'ws://a.test/x')?.id).toBe('two');
    p.scenarios[0]!.sockets = undefined;
    expect(activeSockets(p)).toEqual([]);
  });
});

describe('negotiate', () => {
  const hubs = [sock('chat', '/hubs/chat'), sock('plain', '/plain', { kind: 'plain' })];
  it('answers POST <hub>/negotiate for a SignalR socket only', () => {
    expect(negotiateSocket(hubs, { method: 'POST', url: 'http://a.test/hubs/chat/negotiate?negotiateVersion=1' })?.id).toBe('chat');
    expect(negotiateSocket(hubs, { method: 'GET', url: 'http://a.test/hubs/chat/negotiate' })).toBeNull();
    expect(negotiateSocket(hubs, { method: 'POST', url: 'http://a.test/plain/negotiate' })).toBeNull();
    expect(negotiateSocket(hubs, { method: 'POST', url: 'http://a.test/hubs/other/negotiate' })).toBeNull();
  });
  it("the user's own mocks win over the negotiate answer", () => {
    const own: Mock = {
      id: 'own', enabled: true, method: 'POST', urlPattern: '/hubs/chat/negotiate',
      response: { status: 500, headers: {}, body: '', bodyEncoding: 'text', delayMs: 0 }, source: 'manual', createdAt: 0,
    };
    const facts = { method: 'POST', url: 'http://a.test/hubs/chat/negotiate' };
    expect(findAnyMock([own], hubs, facts)?.id).toBe('own');
    const virtual = findAnyMock([], hubs, facts);
    expect(virtual?.id).toBe('chat');
    expect(JSON.parse(virtual!.response.body).connectionToken).toBe('wemock-chat');
    expect(findAnyMock([], undefined, facts)).toBeNull();
  });
});
