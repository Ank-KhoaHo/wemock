import { describe, it, expect } from 'vitest';
import { STATUS_TEXT, statusTextFor, isValidStatus } from './statusText';

describe('statusText', () => {
  it('returns reason phrase for known status codes', () => {
    expect(statusTextFor(200)).toBe('OK');
    expect(statusTextFor(404)).toBe('Not Found');
    expect(statusTextFor(418)).toBe("I'm a Teapot");
    expect(statusTextFor(429)).toBe('Too Many Requests');
    expect(statusTextFor(451)).toBe('Unavailable For Legal Reasons');
    expect(statusTextFor(520)).toBe('');
  });

  it('validates status code range and integer constraint', () => {
    expect([199, 600, 101, 200.5].map(isValidStatus)).toEqual([false, false, false, false]);
    expect([200, 304, 418, 599].map(isValidStatus)).toEqual([true, true, true, true]);
  });

  it('STATUS_TEXT contains IANA status codes between 200 and 599', () => {
    expect(STATUS_TEXT[200]).toBe('OK');
    expect(STATUS_TEXT[201]).toBe('Created');
    expect(STATUS_TEXT[204]).toBe('No Content');
    expect(STATUS_TEXT[301]).toBe('Moved Permanently');
    expect(STATUS_TEXT[304]).toBe('Not Modified');
    expect(STATUS_TEXT[400]).toBe('Bad Request');
    expect(STATUS_TEXT[401]).toBe('Unauthorized');
    expect(STATUS_TEXT[403]).toBe('Forbidden');
    expect(STATUS_TEXT[500]).toBe('Internal Server Error');
    expect(STATUS_TEXT[503]).toBe('Service Unavailable');

    for (const codeStr of Object.keys(STATUS_TEXT)) {
      const code = Number(codeStr);
      expect(isValidStatus(code)).toBe(true);
    }
  });
});
