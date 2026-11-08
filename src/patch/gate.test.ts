import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGate } from './gate';
import type { Mock, Settings } from '../core/types';

describe('gate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const dummyMocks: Mock[] = [
    {
      id: 'm1',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/test',
      response: {
        status: 200,
        headers: {},
        body: 'ok',
        bodyEncoding: 'text',
        delayMs: 0,
      },
      source: 'manual',
      createdAt: 100,
    },
  ];
  const dummySettings: Settings = { enabled: true, recording: true };

  it('resolves with late false when open() is called before wait()', async () => {
    const gate = createGate(200);
    gate.open({ mocks: dummyMocks, settings: dummySettings });

    const res = await gate.wait();
    expect(res).toEqual({
      mocks: dummyMocks,
      settings: dummySettings,
      late: false,
    });
  });

  it('resolves after 200 ms with late true, mocks [], settings { enabled: true, recording: true } when open() is not called', async () => {
    const gate = createGate(200);
    const waitPromise = gate.wait();

    await vi.advanceTimersByTimeAsync(199);
    let settled = false;
    waitPromise.then(() => {
      settled = true;
    });
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const res = await waitPromise;
    expect(res).toEqual({
      mocks: [],
      settings: { enabled: true, recording: true },
      late: true,
    });
  });

  it('resolves with late false when open() is called at 50 ms', async () => {
    const gate = createGate(200);
    const waitPromise = gate.wait();

    await vi.advanceTimersByTimeAsync(50);
    gate.open({ mocks: dummyMocks, settings: dummySettings });

    const res = await waitPromise;
    expect(res).toEqual({
      mocks: dummyMocks,
      settings: dummySettings,
      late: false,
    });
  });
});
