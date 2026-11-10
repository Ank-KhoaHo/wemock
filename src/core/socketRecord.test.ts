import { describe, expect, it } from 'vitest';
import { withoutPings } from './signalr';
import { socketFromLogs } from './socketRecord';
import type { LogEntry } from './types';

const RS = '\u001e';

function ids() {
  let n = 0;
  return () => `id${++n}`;
}

function row(method: string, startedAt: number, part: Partial<LogEntry> = {}): LogEntry {
  return {
    id: `${method}-${startedAt}`,
    method,
    url: 'ws://app.test/hubs/chat?id=abc',
    status: method === 'WS' ? 101 : 0,
    responseHeaders: {},
    responseBody: null,
    responseEncoding: 'text',
    truncated: false,
    durationMs: 0,
    badge: 'real',
    connectionId: 'c1',
    startedAt,
    ...part,
  };
}

const signalrLog: LogEntry[] = [
  row('WS', 1000),
  row('WS ↑', 1001, { requestBody: `{"protocol":"json","version":1}${RS}` }),
  row('WS ↓', 1010, { responseBody: `{}${RS}` }),
  row('WS ↓', 1510, { responseBody: `{"type":1,"target":"Receive","arguments":["bot","hi"]}${RS}` }),
  row('WS ↑', 2000, { requestBody: `{"type":1,"invocationId":"0","target":"Send","arguments":["x"]}${RS}` }),
  row('WS ↓', 2020, { responseBody: `{"type":3,"invocationId":"0","result":{"ok":true}}${RS}{"type":1,"target":"Echo","arguments":[1]}${RS}` }),
  row('WS ↑', 3000, { requestBody: `{"type":1,"invocationId":"1","target":"Send","arguments":["y"]}${RS}` }),
  row('WS ↓', 3020, { responseBody: `{"type":3,"invocationId":"1","result":{"ok":false}}${RS}` }),
  row('WS ↑', 3100, { requestBody: `{"type":1,"invocationId":"2","target":"Boom","arguments":[]}${RS}` }),
  row('WS ↓', 3120, { responseBody: `{"type":3,"invocationId":"2","error":"bad"}${RS}` }),
  row('WS ↑', 3200, { requestBody: `{"type":1,"invocationId":"3","target":"Ping","arguments":[]}${RS}` }),
  row('WS ↓', 3220, { responseBody: `{"type":3,"invocationId":"3"}${RS}` }),
  row('WS ↓', 9999, { connectionId: 'other', responseBody: `{"type":1,"target":"Nope","arguments":[]}${RS}` }),
];

describe('socketFromLogs (A6)', () => {
  it('rebuilds a SignalR hub: timeline from the handshake, first completion per target', () => {
    const s = socketFromLogs(signalrLog, 'c1', 'http://app.test', ids(), 5);
    expect(s).toEqual({
      id: expect.any(String),
      enabled: true,
      kind: 'signalr',
      urlPattern: '/hubs/chat',
      createdAt: 5,
      // A30: Echo came in the same frame as Send's answer, so it is Send's push.
      onConnect: [
        { id: expect.any(String), afterMs: 500, target: 'Receive', data: '["bot","hi"]' },
      ],
      replies: [
        { id: expect.any(String), when: 'Send', respond: 'fixed', result: '{"ok":true}',
          pushes: [{ id: expect.any(String), afterMs: 0, target: 'Echo', data: '[1]' }] },
        // A31: an error completion is kept as an error reply.
        { id: expect.any(String), when: 'Boom', respond: 'error', result: 'bad', pushes: [] },
        { id: expect.any(String), when: 'Ping', respond: 'fixed', result: '', pushes: [] },
      ],
    });
  });

  it('rebuilds a plain socket: server text on a timeline from the open, no replies, binary skipped', () => {
    const log = [
      row('WS', 100, { url: 'wss://feed.test/ticker' }),
      row('WS ↓', 150, { responseBody: 'tick 1' }),
      row('WS ↑', 160, { requestBody: 'hello' }),
      row('WS ↓', 400, { responseBody: '[binary 12 bytes]' }),
      row('WS ↓', 900, { responseBody: 'tick 2' }),
    ];
    const s = socketFromLogs(log, 'c1', 'http://app.test', ids(), 0)!;
    expect(s.kind).toBe('plain');
    expect(s.urlPattern).toBe('https://feed.test/ticker');
    expect(s.onConnect.map((p) => [p.afterMs, p.data])).toEqual([[50, 'tick 1'], [800, 'tick 2']]);
    expect(s.replies).toEqual([]);
  });

  it('gives null without a real open row, and ignores mocked rows', () => {
    expect(socketFromLogs(signalrLog, 'missing', '', ids(), 0)).toBeNull();
    const mocked = signalrLog.map((e) => ({ ...e, badge: 'MOCK' as const }));
    expect(socketFromLogs(mocked, 'c1', '', ids(), 0)).toBeNull();
  });

  it('keeps at most 200 timeline messages', () => {
    const log = [row('WS', 0)];
    for (let i = 1; i <= 250; i++) log.push(row('WS ↓', i, { responseBody: `m${i}` }));
    expect(socketFromLogs(log, 'c1', '', ids(), 0)!.onConnect).toHaveLength(200);
  });
});

describe('withoutPings', () => {
  it('drops SignalR pings and keeps the rest and plain text', () => {
    expect(withoutPings(`{"type":6}${RS}`)).toBe('');
    expect(withoutPings(`{"type":6}${RS}{"type":1,"target":"A","arguments":[]}${RS}`)).toBe(`{"type":1,"target":"A","arguments":[]}${RS}`);
    expect(withoutPings('{"type":6}')).toBe('{"type":6}');
  });
});
