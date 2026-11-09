import { describe, expect, it, vi } from 'vitest';
import type { Mock, Settings } from '../core/types';
import { announce, announceLine, shortUrl } from './announce';

const mock: Mock = {
  id: 'm1',
  name: 'Doc one',
  enabled: true,
  method: 'GET',
  urlPattern: '/doc/:id',
  response: { status: 200, headers: {}, body: '', bodyEncoding: 'text', delayMs: 0 },
  source: 'manual',
  createdAt: 0,
};
const on: Settings = { enabled: true, recording: true };
const call = { method: 'get', url: 'https://app.test/doc/1?x=2', status: 200, mock, durationMs: 12.4 };

describe('announce (A4)', () => {
  it('formats the spec line with path and query for the same origin', () => {
    expect(announceLine(call, 'https://app.test')).toBe(
      '[wemock] GET /doc/1?x=2 → 200 mock "Doc one" (12 ms)',
    );
  });

  it('shows the full URL for another origin', () => {
    expect(shortUrl('https://api.other/doc/1', 'https://app.test')).toBe('https://api.other/doc/1');
  });

  it('falls back to the pattern when the mock has no name', () => {
    const line = announceLine({ ...call, mock: { ...mock, name: '  ' } }, 'https://app.test');
    expect(line).toBe('[wemock] GET /doc/1?x=2 → 200 mock /doc/:id (12 ms)');
  });

  it('writes info by default, and nothing when consoleLog is false', () => {
    const con = { info: vi.fn(), warn: vi.fn() };
    announce(con, on, call, 'https://app.test');
    expect(con.info).toHaveBeenCalledTimes(1);
    announce(con, { ...on, consoleLog: false }, call, 'https://app.test');
    expect(con.info).toHaveBeenCalledTimes(1);
    announce(con, { ...on, consoleLog: true }, call, 'https://app.test');
    expect(con.info).toHaveBeenCalledTimes(2);
    expect(con.warn).not.toHaveBeenCalled();
  });

  it('warns with the message when a code mock failed', () => {
    const con = { info: vi.fn(), warn: vi.fn() };
    announce(con, on, { ...call, status: 500, error: 'boom' }, 'https://app.test');
    expect(con.warn).toHaveBeenCalledWith('[wemock] GET /doc/1?x=2 → 500 mock "Doc one" (12 ms): code failed: boom');
    expect(con.info).not.toHaveBeenCalled();
  });

  it('never throws when the page console throws', () => {
    const con = { info: () => { throw new Error('x'); }, warn: vi.fn() };
    expect(() => announce(con, on, call, 'https://app.test')).not.toThrow();
  });
});
