import { describe, expect, it } from 'vitest';
import { LogBuffer } from './logBuffer';
import { type LogEntry, LOG_CAP } from './types';

function createLogEntry(id: string): LogEntry {
  return {
    id,
    method: 'GET',
    url: `https://a.com/item/${id}`,
    status: 200,
    responseHeaders: {},
    responseBody: 'ok',
    responseEncoding: 'text',
    truncated: false,
    durationMs: 10,
    badge: 'real',
    startedAt: 1000,
  };
}

describe('LogBuffer', () => {
  it('defaults to cap of LOG_CAP (500)', () => {
    const buffer = new LogBuffer();
    for (let i = 0; i <= LOG_CAP; i++) {
      buffer.push(createLogEntry(`id-${i}`));
    }
    const entries = buffer.entries();
    expect(entries.length).toBe(LOG_CAP);
    // Oldest entry (id-0) should have been dropped; first entry should now be id-1
    expect(entries[0]?.id).toBe('id-1');
    expect(entries[entries.length - 1]?.id).toBe(`id-${LOG_CAP}`);
  });

  it('respects custom cap', () => {
    const buffer = new LogBuffer(3);
    buffer.push(createLogEntry('1'));
    buffer.push(createLogEntry('2'));
    buffer.push(createLogEntry('3'));
    buffer.push(createLogEntry('4'));

    const entries = buffer.entries();
    expect(entries.length).toBe(3);
    expect(entries.map((e) => e.id)).toEqual(['2', '3', '4']);
  });

  it('returns a copy of entries that cannot mutate internal state', () => {
    const buffer = new LogBuffer(5);
    buffer.push(createLogEntry('1'));
    const entries = buffer.entries();
    entries.pop();
    expect(buffer.entries().length).toBe(1);
  });

  it('clears all entries on clear()', () => {
    const buffer = new LogBuffer(5);
    buffer.push(createLogEntry('1'));
    buffer.push(createLogEntry('2'));
    expect(buffer.entries().length).toBe(2);

    buffer.clear();
    expect(buffer.entries().length).toBe(0);
  });
});
