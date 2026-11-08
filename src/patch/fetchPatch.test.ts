import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installFetchPatch, type PatchDeps } from './fetchPatch';
import { createGate, type Gate } from './gate';
import { bytesToBase64 } from '../core/bodies';
import { statusTextFor } from '../core/statusText';
import type { LogDraft, Mock, Settings } from '../core/types';

describe('fetchPatch', () => {
  let currentTime = 1000;
  const now = () => currentTime;

  function createTestWindow(cannedResponse?: () => Promise<Response>) {
    const nativeFetch = vi.fn(
      cannedResponse ??
        (async () =>
          new Response(JSON.stringify({ source: 'server' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })),
    );

    class StubRequest extends Request {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        if (typeof input === 'string' && !input.includes('://')) {
          super(new URL(input, 'https://app.test/page').href, init);
        } else {
          super(input, init);
        }
      }
    }

    const win = {
      fetch: nativeFetch,
      Request: StubRequest,
      Response,
      Headers,
      location: { href: 'https://app.test/page' },
    } as unknown as Window;

    return { win, nativeFetch };
  }

  function createTestDeps(gate: Gate): {
    deps: PatchDeps;
    reported: LogDraft[];
  } {
    const reported: LogDraft[] = [];
    const deps: PatchDeps = {
      gate,
      report: (d: LogDraft) => {
        reported.push(d);
      },
      now,
    };
    return { deps, reported };
  }

  const defaultSettings: Settings = { enabled: true, recording: true };

  it('serves a matching mock', async () => {
    const { win, nativeFetch } = createTestWindow();
    const gate = createGate(200);
    const mock: Mock = {
      id: 'mock-1',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/goals',
      response: {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-custom': 'val' },
        body: '{"goals":[1,2]}',
        bodyEncoding: 'text',
        delayMs: 0,
      },
      source: 'manual',
      createdAt: 100,
    };
    gate.open({ mocks: [mock], settings: defaultSettings });

    const { deps, reported } = createTestDeps(gate);
    const uninstall = installFetchPatch(win, deps);

    const res = await win.fetch('/api/goals');

    expect(nativeFetch).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.statusText).toBe('OK');
    expect(res.headers.get('x-custom')).toBe('val');
    expect(await res.text()).toBe('{"goals":[1,2]}');

    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({
      method: 'GET',
      url: 'https://app.test/api/goals',
      status: 200,
      badge: 'MOCK',
      mockId: 'mock-1',
      responseBody: '{"goals":[1,2]}',
    });

    uninstall();
  });

  it('passes a non-match through and reports badge real', async () => {
    const { win, nativeFetch } = createTestWindow();
    const gate = createGate(200);
    gate.open({ mocks: [], settings: defaultSettings });

    const { deps, reported } = createTestDeps(gate);
    const uninstall = installFetchPatch(win, deps);

    const res = await win.fetch('/api/unmocked');

    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ source: 'server' });

    // Allow background logging promise to resolve
    await new Promise((r) => setTimeout(r, 10));

    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({
      method: 'GET',
      url: 'https://app.test/api/unmocked',
      status: 200,
      badge: 'real',
    });

    uninstall();
  });

  it('waits delayMs before resolving', async () => {
    vi.useFakeTimers();
    try {
      const { win } = createTestWindow();
      const gate = createGate(200);
      const mock: Mock = {
        id: 'mock-delayed',
        enabled: true,
        method: 'GET',
        urlPattern: '/api/delayed',
        response: {
          status: 200,
          headers: {},
          body: 'slow',
          bodyEncoding: 'text',
          delayMs: 300,
        },
        source: 'manual',
        createdAt: 100,
      };
      gate.open({ mocks: [mock], settings: defaultSettings });

      const { deps } = createTestDeps(gate);
      installFetchPatch(win, deps);

      let resolved = false;
      const promise = win.fetch('/api/delayed').then((r) => {
        resolved = true;
        return r;
      });

      await vi.advanceTimersByTimeAsync(299);
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(resolved).toBe(true);

      const res = await promise;
      expect(await res.text()).toBe('slow');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects with AbortError when the signal aborts during the delay', async () => {
    vi.useFakeTimers();
    try {
      const { win } = createTestWindow();
      const gate = createGate(200);
      const mock: Mock = {
        id: 'mock-abort',
        enabled: true,
        method: 'GET',
        urlPattern: '/api/abortable',
        response: {
          status: 200,
          headers: {},
          body: 'never',
          bodyEncoding: 'text',
          delayMs: 300,
        },
        source: 'manual',
        createdAt: 100,
      };
      gate.open({ mocks: [mock], settings: defaultSettings });

      const { deps } = createTestDeps(gate);
      installFetchPatch(win, deps);

      const controller = new AbortController();
      const promise = win.fetch('/api/abortable', { signal: controller.signal });
      const errorPromise = promise.catch((err: unknown) => err);

      await vi.advanceTimersByTimeAsync(100);
      controller.abort();

      await vi.advanceTimersByTimeAsync(200);

      const err = await errorPromise;
      expect(err).toBeInstanceOf(DOMException);
      expect((err as DOMException).name).toBe('AbortError');
      await expect(promise).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it('serves 204 with a null body even when the mock has a body', async () => {
    const { win } = createTestWindow();
    const gate = createGate(200);
    const mock: Mock = {
      id: 'mock-204',
      enabled: true,
      method: 'DELETE',
      urlPattern: '/api/goals/:id',
      response: {
        status: 204,
        headers: { 'x-deleted': 'true' },
        body: 'non-empty-body-in-mock',
        bodyEncoding: 'text',
        delayMs: 0,
      },
      source: 'manual',
      createdAt: 100,
    };
    gate.open({ mocks: [mock], settings: defaultSettings });

    const { deps, reported } = createTestDeps(gate);
    installFetchPatch(win, deps);

    const res = await win.fetch('/api/goals/123', { method: 'DELETE' });

    expect(res.status).toBe(204);
    expect(res.ok).toBe(true);
    expect(res.statusText).toBe('No Content');
    expect(res.headers.get('x-deleted')).toBe('true');
    expect(await res.text()).toBe('');

    expect(reported[0]?.responseBody).toBeNull();
  });

  it('matches a Request object, a URL object and a relative URL', async () => {
    const { win } = createTestWindow();
    const gate = createGate(200);
    const mockGraphQL: Mock = {
      id: 'mock-gq',
      enabled: true,
      method: 'POST',
      urlPattern: '/api/x',
      graphqlOperation: 'A',
      response: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"data":"matched-A"}',
        bodyEncoding: 'text',
        delayMs: 0,
      },
      source: 'manual',
      createdAt: 100,
    };
    const mockUrlObj: Mock = {
      id: 'mock-url',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/url-obj',
      response: {
        status: 200,
        headers: {},
        body: 'matched-url',
        bodyEncoding: 'text',
        delayMs: 0,
      },
      source: 'manual',
      createdAt: 100,
    };
    const mockRel: Mock = {
      id: 'mock-rel',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/relative',
      response: {
        status: 200,
        headers: {},
        body: 'matched-rel',
        bodyEncoding: 'text',
        delayMs: 0,
      },
      source: 'manual',
      createdAt: 100,
    };
    gate.open({
      mocks: [mockGraphQL, mockUrlObj, mockRel],
      settings: defaultSettings,
    });

    const { deps } = createTestDeps(gate);
    installFetchPatch(win, deps);

    // 1. Request object with POST and GraphQL body
    const req = new win.Request('/api/x', {
      method: 'POST',
      body: '{"operationName":"A"}',
    });
    const res1 = await win.fetch(req);
    expect(await res1.text()).toBe('{"data":"matched-A"}');

    // 2. URL object
    const urlObj = new URL('https://app.test/api/url-obj');
    const res2 = await win.fetch(urlObj);
    expect(await res2.text()).toBe('matched-url');

    // 3. Relative URL string
    const res3 = await win.fetch('/api/relative');
    expect(await res3.text()).toBe('matched-rel');
  });

  it('passes through when settings.enabled is false', async () => {
    const { win, nativeFetch } = createTestWindow();
    const gate = createGate(200);
    const mock: Mock = {
      id: 'm-disabled-by-settings',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/disabled-setting',
      response: {
        status: 200,
        headers: {},
        body: 'mocked',
        bodyEncoding: 'text',
        delayMs: 0,
      },
      source: 'manual',
      createdAt: 100,
    };
    gate.open({ mocks: [mock], settings: { enabled: false, recording: true } });

    const { deps } = createTestDeps(gate);
    installFetchPatch(win, deps);

    const res = await win.fetch('/api/disabled-setting');

    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ source: 'server' });
  });

  it('passes through if gate.wait() throws', async () => {
    const { win, nativeFetch } = createTestWindow();
    const brokenGate: Gate = {
      open: vi.fn(),
      wait: vi.fn().mockRejectedValue(new Error('gate broken')),
    };

    const { deps } = createTestDeps(brokenGate);
    installFetchPatch(win, deps);

    const res = await win.fetch('/api/any');

    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ source: 'server' });
  });

  it('gives the page the full binary body untouched', async () => {
    const bigSize = 2 * 1024 * 1024; // 2 MB
    const bigBytes = new Uint8Array(bigSize);
    bigBytes[0] = 137;
    bigBytes[1] = 80;
    bigBytes[bigSize - 1] = 255;

    const { win } = createTestWindow(async () => {
      return new Response(bigBytes, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    });
    const gate = createGate(200);
    gate.open({ mocks: [], settings: defaultSettings });

    const { deps, reported } = createTestDeps(gate);
    installFetchPatch(win, deps);

    const res = await win.fetch('/real/large.png');
    const buf = await res.arrayBuffer();

    expect(buf.byteLength).toBe(bigSize);
    expect(new Uint8Array(buf)[0]).toBe(137);

    // Wait for background logging promise
    await new Promise((r) => setTimeout(r, 20));

    expect(reported).toHaveLength(1);
    expect(reported[0]?.truncated).toBe(true);
    expect(reported[0]?.responseBody).toBeNull();
    expect(reported[0]?.responseEncoding).toBe('base64');
  });

  it('logs a 10 KB real PNG as base64', async () => {
    const pngBytes = new Uint8Array(10 * 1024);
    for (let i = 0; i < pngBytes.length; i++) {
      pngBytes[i] = i % 256;
    }

    const { win } = createTestWindow(async () => {
      return new Response(pngBytes, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    });
    const gate = createGate(200);
    gate.open({ mocks: [], settings: defaultSettings });

    const { deps, reported } = createTestDeps(gate);
    installFetchPatch(win, deps);

    const res = await win.fetch('/real/logo.png');
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 20));

    expect(reported).toHaveLength(1);
    expect(reported[0]?.truncated).toBe(false);
    expect(reported[0]?.responseEncoding).toBe('base64');
    expect(reported[0]?.responseBody).toBe(bytesToBase64(pngBytes));
  });

  it('marks a text body over 1 MB truncated in the log only', async () => {
    const bigText = 'a'.repeat(1_200_000);
    const { win } = createTestWindow(async () => {
      return new Response(bigText, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const gate = createGate(200);
    gate.open({ mocks: [], settings: defaultSettings });

    const { deps, reported } = createTestDeps(gate);
    installFetchPatch(win, deps);

    const res = await win.fetch('/real/big.json');
    const text = await res.text();
    expect(text).toBe(bigText);

    await new Promise((r) => setTimeout(r, 20));

    expect(reported).toHaveLength(1);
    expect(reported[0]?.truncated).toBe(true);
    expect(reported[0]?.responseBody).toBeNull();
    expect(reported[0]?.responseEncoding).toBe('text');
  });

  it('serves a base64 mock: blob() has the exact bytes and the content-type', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const { win } = createTestWindow();
    const gate = createGate(200);
    const mock: Mock = {
      id: 'mock-png',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/icon.png',
      response: {
        status: 200,
        headers: { 'content-type': 'image/png' },
        body: bytesToBase64(png),
        bodyEncoding: 'base64',
        delayMs: 0,
      },
      source: 'manual',
      createdAt: 100,
    };
    gate.open({ mocks: [mock], settings: defaultSettings });

    const { deps } = createTestDeps(gate);
    installFetchPatch(win, deps);

    const res = await win.fetch('/api/icon.png');
    const blob = await res.blob();

    expect(blob.type).toBe('image/png');
    const buffer = await blob.arrayBuffer();
    expect(new Uint8Array(buffer)).toEqual(png);
  });

  it('serves a base64 mock: arrayBuffer() equals the decoded bytes', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 255]);
    const { win } = createTestWindow();
    const gate = createGate(200);
    const mock: Mock = {
      id: 'mock-bin',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/data.bin',
      response: {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
        body: bytesToBase64(data),
        bodyEncoding: 'base64',
        delayMs: 0,
      },
      source: 'manual',
      createdAt: 100,
    };
    gate.open({ mocks: [mock], settings: defaultSettings });

    const { deps } = createTestDeps(gate);
    installFetchPatch(win, deps);

    const res = await win.fetch('/api/data.bin');
    const ab = await res.arrayBuffer();
    expect(new Uint8Array(ab)).toEqual(data);
  });

  it('reports LATE when the gate timed out', async () => {
    vi.useFakeTimers();
    try {
      const { win } = createTestWindow();
      const gate = createGate(200);

      const { deps, reported } = createTestDeps(gate);
      installFetchPatch(win, deps);

      // Gate times out without open()
      await vi.advanceTimersByTimeAsync(200);

      const resPromise = win.fetch('/api/timed-out');
      await vi.advanceTimersByTimeAsync(1);
      const res = await resPromise;
      expect(res.status).toBe(200);

      await vi.advanceTimersByTimeAsync(10);

      expect(reported).toHaveLength(1);
      expect(reported[0]?.badge).toBe('LATE');
    } finally {
      vi.useRealTimers();
    }
  });

  it('response.url is the absolute request URL', async () => {
    const { win } = createTestWindow();
    const gate = createGate(200);
    const mock: Mock = {
      id: 'mock-url-check',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/url-check',
      response: {
        status: 200,
        headers: {},
        body: 'ok',
        bodyEncoding: 'text',
        delayMs: 0,
      },
      source: 'manual',
      createdAt: 100,
    };
    gate.open({ mocks: [mock], settings: defaultSettings });

    const { deps } = createTestDeps(gate);
    installFetchPatch(win, deps);

    const res = await win.fetch('/api/url-check');
    expect(res.url).toBe('https://app.test/api/url-check');
  });

  it.each([
    200, 201, 202, 204, 206, 301, 302, 304, 307, 400, 401, 403, 404, 409, 418, 422,
    429, 499, 500, 502, 503, 504, 520, 599,
  ])('serves status %i with the right ok and statusText', async (status) => {
    const { win } = createTestWindow();
    const gate = createGate(200);
    const mock: Mock = {
      id: `mock-${status}`,
      enabled: true,
      method: 'GET',
      urlPattern: `/api/status/${status}`,
      response: {
        status,
        headers: {},
        body: [204, 205, 304].includes(status) ? '' : 'status body',
        bodyEncoding: 'text',
        delayMs: 0,
      },
      source: 'manual',
      createdAt: 100,
    };
    gate.open({ mocks: [mock], settings: defaultSettings });

    const { deps } = createTestDeps(gate);
    installFetchPatch(win, deps);

    const res = await win.fetch(`/api/status/${status}`);

    expect(res.status).toBe(status);
    expect(res.ok).toBe(status >= 200 && status < 300);
    expect(res.statusText).toBe(statusTextFor(status));
  });

  it('restores native fetch on uninstall', async () => {
    const { win, nativeFetch } = createTestWindow();
    const gate = createGate(200);
    const { deps } = createTestDeps(gate);
    const uninstall = installFetchPatch(win, deps);

    expect(win.fetch).not.toBe(nativeFetch);

    uninstall();
    expect(win.fetch).toBe(nativeFetch);
  });

  it('supports this-free calling like fetch.call(undefined, ...)', async () => {
    const { win } = createTestWindow();
    const gate = createGate(200);
    const mock: Mock = {
      id: 'mock-this-free',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/this-free',
      response: {
        status: 200,
        headers: {},
        body: 'ok-this-free',
        bodyEncoding: 'text',
        delayMs: 0,
      },
      source: 'manual',
      createdAt: 100,
    };
    gate.open({ mocks: [mock], settings: defaultSettings });

    const { deps } = createTestDeps(gate);
    installFetchPatch(win, deps);

    const fetchFn = win.fetch;
    const res = await fetchFn.call(undefined, '/api/this-free');
    expect(await res.text()).toBe('ok-this-free');
  });
});
