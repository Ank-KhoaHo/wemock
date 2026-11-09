import { describe, expect, it, vi } from 'vitest';
import type { Mock } from '../core/types';
import { createRunHandler, resolveReply } from './reply';

const fixed: Mock = {
  id: 'm1',
  enabled: true,
  method: 'GET',
  urlPattern: '/a',
  response: { status: 203, headers: {}, body: 'x', bodyEncoding: 'text', delayMs: 0 },
  source: 'manual',
  createdAt: 0,
};
const code: Mock = { ...fixed, id: 'm2', reply: 'code', code: 'return 1' };
const facts = { method: 'GET', url: 'https://a.test/a', headers: { h: '1' }, body: 'b' };

describe('resolveReply', () => {
  it('a fixed mock answers its own response without running anything', async () => {
    const run = vi.fn();
    expect(await resolveReply(run, fixed, facts)).toEqual({ response: fixed.response });
    expect(await resolveReply(run, { ...fixed, reply: 'fixed', code: 'x' }, facts)).toEqual({ response: fixed.response });
    expect(run).not.toHaveBeenCalled();
  });
  it('a code mock sends only the id and the request facts', async () => {
    const run = vi.fn(async () => ({ response: { ...fixed.response, status: 299 } }));
    const r = await resolveReply(run, code, facts);
    expect(run).toHaveBeenCalledWith('m2', { method: 'GET', url: 'https://a.test/a', headers: { h: '1' }, body: 'b', callCount: 1 });
    expect(r.response.status).toBe(299);
  });
  it('no runner or a throwing runner gives the error reply', async () => {
    expect((await resolveReply(undefined, code, facts)).response.status).toBe(500);
    const r = await resolveReply(async () => { throw new Error('x'); }, code, facts);
    expect(r.error).toMatch(/x/);
  });
});

describe('createRunHandler', () => {
  function fakeWin() {
    const listeners: Array<(e: MessageEvent) => void> = [];
    const posted: unknown[] = [];
    const win = {
      addEventListener: (_t: string, fn: (e: MessageEvent) => void) => listeners.push(fn),
      postMessage: (d: unknown) => posted.push(d),
    } as unknown as Window;
    const deliver = (data: unknown, source: unknown = win) => listeners.forEach((l) => l({ data, source } as MessageEvent));
    return { win, posted, deliver };
  }
  const reply = { response: { status: 201, headers: {}, body: 'ok', bodyEncoding: 'text', delayMs: 0 } };

  it('posts run-handler and resolves with the matching answer only', async () => {
    const { win, posted, deliver } = fakeWin();
    const p = createRunHandler(win, 1000)('m2', facts);
    const sent = posted[0] as { callId: string; mockId: string; source: string; type: string };
    expect(sent).toMatchObject({ source: 'wemock-page', type: 'run-handler', mockId: 'm2' });
    deliver({ source: 'wemock-bridge', type: 'handler-result', callId: 'other', reply: { ...reply, response: { ...reply.response, status: 299 } } });
    deliver({ source: 'wemock-bridge', type: 'handler-result', callId: sent.callId, reply }, {});
    deliver({ source: 'wemock-bridge', type: 'handler-result', callId: sent.callId, reply });
    expect((await p).response.status).toBe(201);
  });
  it('times out with the error reply', async () => {
    vi.useFakeTimers();
    try {
      const { win } = fakeWin();
      const p = createRunHandler(win, 3000)('m2', facts);
      vi.advanceTimersByTime(3000);
      const r = await p;
      expect(r.response.status).toBe(500);
      expect(r.error).toBe('No answer from wemock in 3000 ms');
    } finally {
      vi.useRealTimers();
    }
  });
  it('ignores a malformed answer', async () => {
    vi.useFakeTimers();
    try {
      const { win, posted, deliver } = fakeWin();
      const p = createRunHandler(win, 50)('m2', facts);
      const { callId } = posted[0] as { callId: string };
      deliver({ source: 'wemock-bridge', type: 'handler-result', callId, reply: { response: { status: 99 } } });
      vi.advanceTimersByTime(50);
      expect((await p).error).toMatch(/No answer/);
    } finally {
      vi.useRealTimers();
    }
  });
});
