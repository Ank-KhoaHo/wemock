import { expect, test } from '@playwright/test';
import { base64ToBytes, bytesToBase64 } from '../src/core/bodies';
import { statusTextFor } from '../src/core/statusText';
import { emptyState, newProject, type Mock, type WemockState } from '../src/core/types';
import { type FixtureServer, startFixtureServer } from './fixture/server';
import { type WemockSession, launchWemock } from './helpers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

let fixture: FixtureServer;
let session: WemockSession;

test.beforeAll(async () => {
  fixture = await startFixtureServer();
  session = await launchWemock(fixture.url);
});

test.afterAll(async () => {
  await session?.context?.close();
  await fixture?.close();
});

test('raw XHR gets the mock', async () => {
  const page = await session.context.newPage();
  try {
    const project = newProject('p1', fixture.origin);
    const mock: Mock = {
      id: 'm-raw-xhr',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/goals',
      response: {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-custom': 'val' },
        body: '{"mocked":"raw"}',
        bodyEncoding: 'text',
        delayMs: 0,
      },
      source: 'manual',
      createdAt: Date.now(),
    };
    project.scenarios[0]!.mocks.push(mock);
    const state: WemockState = {
      ...emptyState(),
      projects: [project],
      enabledOrigins: [fixture.origin],
    };
    await session.setState(state);
    await page.goto(`${fixture.url}/index.html`);

    const result = await page.evaluate(async () => {
      return new Promise<{ status: number; text: string; header: string | null }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/goals');
        xhr.onload = () => {
          resolve({
            status: xhr.status,
            text: xhr.responseText,
            header: xhr.getResponseHeader('x-custom'),
          });
        };
        xhr.onerror = () => reject(new Error('XHR error'));
        xhr.send();
      });
    });

    expect(result.status).toBe(200);
    expect(result.text).toBe('{"mocked":"raw"}');
    expect(result.header).toBe('val');
  } finally {
    await page.close();
  }
});

test('axios gets the mock', async () => {
  const page = await session.context.newPage();
  try {
    const project = newProject('p1', fixture.origin);
    const mock: Mock = {
      id: 'm-axios',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/goals',
      response: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"mocked":"axios"}',
        bodyEncoding: 'text',
        delayMs: 0,
      },
      source: 'manual',
      createdAt: Date.now(),
    };
    project.scenarios[0]!.mocks.push(mock);
    const state: WemockState = {
      ...emptyState(),
      projects: [project],
      enabledOrigins: [fixture.origin],
    };
    await session.setState(state);
    await page.goto(`${fixture.url}/index.html`);

    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (window as any).axios.get('/api/goals');
      return { status: res.status, data: res.data };
    });

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ mocked: 'axios' });
  } finally {
    await page.close();
  }
});

test('readyState goes 1, 2, 3, 4 and onload, onloadend, addEventListener("load") all fire', async () => {
  const page = await session.context.newPage();
  try {
    const project = newProject('p1', fixture.origin);
    project.scenarios[0]!.mocks.push({
      id: 'm-states',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/goals',
      response: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"state":"ok"}',
        bodyEncoding: 'text',
        delayMs: 0,
      },
      source: 'manual',
      createdAt: Date.now(),
    });
    const state: WemockState = {
      ...emptyState(),
      projects: [project],
      enabledOrigins: [fixture.origin],
    };
    await session.setState(state);
    await page.goto(`${fixture.url}/index.html`);

    const result = await page.evaluate(async () => {
      return new Promise<{ states: number[]; events: string[] }>((resolve) => {
        const xhr = new XMLHttpRequest();
        const states: number[] = [];
        const events: string[] = [];

        states.push(xhr.readyState);
        xhr.open('GET', '/api/goals');
        states.push(xhr.readyState);

        xhr.onreadystatechange = () => {
          states.push(xhr.readyState);
          events.push(`readystatechange:${xhr.readyState}`);
        };
        xhr.onload = () => events.push('onload');
        xhr.onloadend = () => {
          events.push('onloadend');
          resolve({ states, events });
        };
        xhr.addEventListener('load', () => events.push('addEventListener:load'));

        xhr.send();
      });
    });

    expect(result.states).toEqual([0, 1, 2, 3, 4]);
    expect(result.events).toContain('onload');
    expect(result.events).toContain('onloadend');
    expect(result.events).toContain('addEventListener:load');
  } finally {
    await page.close();
  }
});

test('responseType json, blob and arraybuffer return the right types', async () => {
  const page = await session.context.newPage();
  try {
    const project = newProject('p1', fixture.origin);
    project.scenarios[0]!.mocks.push({
      id: 'm-types',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/types',
      response: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"a":1}',
        bodyEncoding: 'text',
        delayMs: 0,
      },
      source: 'manual',
      createdAt: Date.now(),
    });
    const state: WemockState = {
      ...emptyState(),
      projects: [project],
      enabledOrigins: [fixture.origin],
    };
    await session.setState(state);
    await page.goto(`${fixture.url}/index.html`);

    const result = await page.evaluate(async () => {
      // 1. json
      const jsonRes = await new Promise<{ val: unknown; threwInvalidState: boolean }>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/types');
        xhr.responseType = 'json';
        xhr.onload = () => {
          let threwInvalidState = false;
          try {
            void xhr.responseText;
          } catch (e: unknown) {
            threwInvalidState = (e as DOMException).name === 'InvalidStateError';
          }
          resolve({ val: xhr.response, threwInvalidState });
        };
        xhr.send();
      });

      // 2. blob
      const blobRes = await new Promise<{ isBlob: boolean; type: string; text: string; threwInvalidState: boolean }>(
        (resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', '/api/types');
          xhr.responseType = 'blob';
          xhr.onload = async () => {
            let threwInvalidState = false;
            try {
              void xhr.responseText;
            } catch (e: unknown) {
              threwInvalidState = (e as DOMException).name === 'InvalidStateError';
            }
            const blob = xhr.response as Blob;
            const text = blob ? await blob.text() : '';
            resolve({
              isBlob: blob instanceof Blob,
              type: blob ? blob.type : '',
              text,
              threwInvalidState,
            });
          };
          xhr.send();
        },
      );

      // 3. arraybuffer
      const abRes = await new Promise<{ isAB: boolean; text: string; threwInvalidState: boolean }>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/types');
        xhr.responseType = 'arraybuffer';
        xhr.onload = () => {
          let threwInvalidState = false;
          try {
            void xhr.responseText;
          } catch (e: unknown) {
            threwInvalidState = (e as DOMException).name === 'InvalidStateError';
          }
          const buf = xhr.response as ArrayBuffer;
          const text = buf ? new TextDecoder().decode(buf) : '';
          resolve({
            isAB: buf instanceof ArrayBuffer,
            text,
            threwInvalidState,
          });
        };
        xhr.send();
      });

      return { jsonRes, blobRes, abRes };
    });

    expect(result.jsonRes.val).toEqual({ a: 1 });
    expect(result.jsonRes.threwInvalidState).toBe(true);

    expect(result.blobRes.isBlob).toBe(true);
    expect(result.blobRes.type).toContain('application/json');
    expect(result.blobRes.text).toBe('{"a":1}');
    expect(result.blobRes.threwInvalidState).toBe(true);

    expect(result.abRes.isAB).toBe(true);
    expect(result.abRes.text).toBe('{"a":1}');
    expect(result.abRes.threwInvalidState).toBe(true);
  } finally {
    await page.close();
  }
});

test('abort() during a mock delay fires abort, not load', async () => {
  const page = await session.context.newPage();
  try {
    const project = newProject('p1', fixture.origin);
    project.scenarios[0]!.mocks.push({
      id: 'm-abort',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/goals',
      response: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"should":"not appear"}',
        bodyEncoding: 'text',
        delayMs: 300,
      },
      source: 'manual',
      createdAt: Date.now(),
    });
    const state: WemockState = {
      ...emptyState(),
      projects: [project],
      enabledOrigins: [fixture.origin],
    };
    await session.setState(state);
    await page.goto(`${fixture.url}/index.html`);

    const result = await page.evaluate(async () => {
      return new Promise<{ events: string[]; statesDuringAbort: number[]; readyStateAfter: number }>((resolve) => {
        const xhr = new XMLHttpRequest();
        const events: string[] = [];
        const statesDuringAbort: number[] = [];

        xhr.open('GET', '/api/goals');
        xhr.onreadystatechange = () => {
          statesDuringAbort.push(xhr.readyState);
          events.push(`readystatechange:${xhr.readyState}`);
        };
        xhr.onabort = () => {
          statesDuringAbort.push(xhr.readyState);
          events.push('abort');
        };
        xhr.onload = () => events.push('load');
        xhr.onloadend = () => {
          statesDuringAbort.push(xhr.readyState);
          events.push('loadend');
          setTimeout(() => {
            resolve({
              events,
              statesDuringAbort,
              readyStateAfter: xhr.readyState,
            });
          }, 10);
        };

        xhr.send();
        setTimeout(() => {
          xhr.abort();
        }, 50);
      });
    });

    expect(result.events).toContain('abort');
    expect(result.events).toContain('loadend');
    expect(result.events).not.toContain('load');
    expect(result.statesDuringAbort).toContain(4);
    expect(result.readyStateAfter).toBe(0);
  } finally {
    await page.close();
  }
});

test('timeout shorter than delay fires timeout', async () => {
  const page = await session.context.newPage();
  try {
    const project = newProject('p1', fixture.origin);
    project.scenarios[0]!.mocks.push({
      id: 'm-timeout',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/goals',
      response: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"should":"not appear"}',
        bodyEncoding: 'text',
        delayMs: 500,
      },
      source: 'manual',
      createdAt: Date.now(),
    });
    const state: WemockState = {
      ...emptyState(),
      projects: [project],
      enabledOrigins: [fixture.origin],
    };
    await session.setState(state);
    await page.goto(`${fixture.url}/index.html`);

    const result = await page.evaluate(async () => {
      return new Promise<{ events: string[] }>((resolve) => {
        const xhr = new XMLHttpRequest();
        const events: string[] = [];
        xhr.open('GET', '/api/goals');
        xhr.timeout = 100;
        xhr.ontimeout = () => events.push('timeout');
        xhr.onload = () => events.push('load');
        xhr.onloadend = () => {
          events.push('loadend');
          resolve({ events });
        };
        xhr.send();
      });
    });

    expect(result.events).toContain('timeout');
    expect(result.events).toContain('loadend');
    expect(result.events).not.toContain('load');
  } finally {
    await page.close();
  }
});

test('a 304 mock gives an empty responseText', async () => {
  const page = await session.context.newPage();
  try {
    const project = newProject('p1', fixture.origin);
    project.scenarios[0]!.mocks.push({
      id: 'm-304',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/not-modified',
      response: {
        status: 304,
        headers: { 'content-type': 'text/plain' },
        body: 'ignored body',
        bodyEncoding: 'text',
        delayMs: 0,
      },
      source: 'manual',
      createdAt: Date.now(),
    });
    const state: WemockState = {
      ...emptyState(),
      projects: [project],
      enabledOrigins: [fixture.origin],
    };
    await session.setState(state);
    await page.goto(`${fixture.url}/index.html`);

    const result = await page.evaluate(async () => {
      return new Promise<{ status: number; text: string; statusText: string }>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/not-modified');
        xhr.onload = () => {
          resolve({
            status: xhr.status,
            text: xhr.responseText,
            statusText: xhr.statusText,
          });
        };
        xhr.send();
      });
    });

    expect(result.status).toBe(304);
    expect(result.text).toBe('');
    expect(result.statusText).toBe('Not Modified');
  } finally {
    await page.close();
  }
});

test('statuses 201, 302, 404, 429, 503 and 520 reach raw XHR and axios unchanged', async () => {
  const page = await session.context.newPage();
  try {
    const statuses = [201, 302, 404, 429, 503, 520];
    const project = newProject('p1', fixture.origin);

    for (const status of statuses) {
      project.scenarios[0]!.mocks.push({
        id: `m-status-${status}`,
        enabled: true,
        method: 'GET',
        urlPattern: `/api/status/${status}`,
        response: {
          status,
          headers: { 'content-type': 'application/json' },
          body: `{"status":${status}}`,
          bodyEncoding: 'text',
          delayMs: 0,
        },
        source: 'manual',
        createdAt: Date.now(),
      });
    }

    const state: WemockState = {
      ...emptyState(),
      projects: [project],
      enabledOrigins: [fixture.origin],
    };
    await session.setState(state);
    await page.goto(`${fixture.url}/index.html`);

    for (const status of statuses) {
      const expectedStatusText = statusTextFor(status);

      // Raw XHR
      const rawResult = await page.evaluate(async (s) => {
        return new Promise<{ status: number; statusText: string }>((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', `/api/status/${s}`);
          xhr.onload = () => {
            resolve({ status: xhr.status, statusText: xhr.statusText });
          };
          xhr.send();
        });
      }, status);

      expect(rawResult.status).toBe(status);
      expect(rawResult.statusText).toBe(expectedStatusText);

      // Axios
      const axiosStatus = await page.evaluate(async (s) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const axios = (window as any).axios;
        try {
          const res = await axios.get(`/api/status/${s}`);
          return res.status;
        } catch (err: unknown) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (err as any).response?.status ?? -1;
        }
      }, status);

      expect(axiosStatus).toBe(status);
    }
  } finally {
    await page.close();
  }
});

test('a base64 PNG mock: responseType blob gives the exact bytes and type', async () => {
  const page = await session.context.newPage();
  try {
    const rawPngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]);
    const b64 = bytesToBase64(rawPngBytes);

    const project = newProject('p1', fixture.origin);
    project.scenarios[0]!.mocks.push({
      id: 'm-b64-blob',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/img.png',
      response: {
        status: 200,
        headers: { 'content-type': 'image/png' },
        body: b64,
        bodyEncoding: 'base64',
        delayMs: 0,
      },
      source: 'manual',
      createdAt: Date.now(),
    });

    const state: WemockState = {
      ...emptyState(),
      projects: [project],
      enabledOrigins: [fixture.origin],
    };
    await session.setState(state);
    await page.goto(`${fixture.url}/index.html`);

    const result = await page.evaluate(async () => {
      return new Promise<{ type: string; bytes: number[] }>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/img.png');
        xhr.responseType = 'blob';
        xhr.onload = async () => {
          const blob = xhr.response as Blob;
          const ab = await blob.arrayBuffer();
          resolve({
            type: blob.type,
            bytes: Array.from(new Uint8Array(ab)),
          });
        };
        xhr.send();
      });
    });

    expect(result.type).toBe('image/png');
    expect(new Uint8Array(result.bytes)).toEqual(rawPngBytes);
  } finally {
    await page.close();
  }
});

test('a base64 mock: axios with responseType arraybuffer gets the exact bytes', async () => {
  const page = await session.context.newPage();
  try {
    const rawBytes = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    const b64 = bytesToBase64(rawBytes);

    const project = newProject('p1', fixture.origin);
    project.scenarios[0]!.mocks.push({
      id: 'm-b64-axios',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/data.bin',
      response: {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
        body: b64,
        bodyEncoding: 'base64',
        delayMs: 0,
      },
      source: 'manual',
      createdAt: Date.now(),
    });

    const state: WemockState = {
      ...emptyState(),
      projects: [project],
      enabledOrigins: [fixture.origin],
    };
    await session.setState(state);
    await page.goto(`${fixture.url}/index.html`);

    const receivedBytes = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const axios = (window as any).axios;
      const res = await axios.get('/api/data.bin', { responseType: 'arraybuffer' });
      return Array.from(new Uint8Array(res.data));
    });

    expect(new Uint8Array(receivedBytes)).toEqual(rawBytes);
  } finally {
    await page.close();
  }
});

test('a non-matching XHR reaches the server and is logged real', async () => {
  const page = await session.context.newPage();
  const extPage = await session.context.newPage();
  try {
    const project = newProject('p1', fixture.origin);
    const state: WemockState = {
      ...emptyState(),
      projects: [project],
      enabledOrigins: [fixture.origin],
    };
    await session.setState(state);

    await page.goto(`${fixture.url}/index.html`);
    await extPage.goto(`chrome-extension://${session.extensionId}/panel.html`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tabId = await extPage.evaluate(async (url) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tabs = await (chrome as any).tabs.query({ url: url + '/*' });
      return tabs[0]?.id;
    }, fixture.url);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logPromise = extPage.evaluate((targetTabId) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout waiting for log')), 3000);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const port = (chrome as any).runtime.connect({ name: 'wemock-panel' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        port.onMessage.addListener((msg: any) => {
          if (msg.type === 'log' && msg.entry?.url?.includes('/api/goals')) {
            clearTimeout(timer);
            resolve(msg.entry);
          }
        });
        port.postMessage({ type: 'subscribe', tabId: targetTabId });
      });
    }, tabId);

    // Trigger non-matching XHR to /api/goals
    await page.click('#btn-xhr');
    await expect(page.locator('#out')).toHaveText('{"source":"server"}');

    const logEntry = await logPromise;
    expect(logEntry.badge).toBe('real');
    expect(logEntry.status).toBe(200);
  } finally {
    await page.close();
    await extPage.close();
  }
});

test('getAllResponseHeaders() uses CRLF lines, lower-case names', async () => {
  const page = await session.context.newPage();
  try {
    const project = newProject('p1', fixture.origin);
    project.scenarios[0]!.mocks.push({
      id: 'm-headers',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/goals',
      response: {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Custom-Header': 'CustomValue',
        },
        body: '{"ok":true}',
        bodyEncoding: 'text',
        delayMs: 0,
      },
      source: 'manual',
      createdAt: Date.now(),
    });
    const state: WemockState = {
      ...emptyState(),
      projects: [project],
      enabledOrigins: [fixture.origin],
    };
    await session.setState(state);
    await page.goto(`${fixture.url}/index.html`);

    const headersString = await page.evaluate(async () => {
      return new Promise<string>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/goals');
        xhr.onload = () => {
          resolve(xhr.getAllResponseHeaders());
        };
        xhr.send();
      });
    });

    expect(headersString.endsWith('\r\n')).toBe(true);
    expect(headersString).toContain('content-type: application/json\r\n');
    expect(headersString).toContain('x-custom-header: CustomValue\r\n');
  } finally {
    await page.close();
  }
});
