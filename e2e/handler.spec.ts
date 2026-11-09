import { expect, test, type Page } from '@playwright/test';
import { emptyState, newProject, type Mock, type WemockState } from '../src/core/types';
import { type FixtureServer, startFixtureServer } from './fixture/server';
import { type WemockSession, launchWemock } from './helpers';

// Spec A2: code mocks, run in the sandbox, on a real page.
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

function codeMock(id: string, urlPattern: string, code: string, method: Mock['method'] = 'ANY'): Mock {
  return {
    id,
    name: id,
    enabled: true,
    method,
    urlPattern,
    reply: 'code',
    code,
    response: { status: 200, headers: { 'x-from': 'mock' }, body: 'unused', bodyEncoding: 'text', delayMs: 0 },
    source: 'manual',
    createdAt: 0,
  };
}

async function useMocks(mocks: Mock[], extra: Partial<WemockState> = {}): Promise<void> {
  const project = newProject('p1', fixture.origin);
  project.scenarios[0]!.mocks.push(...mocks);
  await session.setState({ ...emptyState(), projects: [project], enabledOrigins: [fixture.origin], ...extra });
}

type Got = { status: number; text: string; headers: Record<string, string> };

function fetchIn(page: Page, url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) {
  return page.evaluate(
    async ([u, i]) => {
      const r = await fetch(u, i ?? undefined);
      const headers: Record<string, string> = {};
      r.headers.forEach((v, k) => (headers[k] = v));
      return { status: r.status, text: await r.text(), headers } as Got;
    },
    [url, init ?? null] as const,
  );
}

function xhrIn(page: Page, url: string, method = 'GET', body?: string, headers: Record<string, string> = {}) {
  return page.evaluate(
    ([u, m, b, h]) =>
      new Promise<Got>((resolve) => {
        const x = new XMLHttpRequest();
        x.open(m, u);
        for (const [k, v] of Object.entries(h)) x.setRequestHeader(k, v);
        x.onload = () => resolve({ status: x.status, text: x.responseText, headers: { 'x-wemock-error': x.getResponseHeader('x-wemock-error') ?? '' } });
        x.send(b ?? null);
      }),
    [url, method, body, headers] as const,
  );
}

const echo = codeMock(
  'echo',
  '/doc/:id',
  `res.status = params.id === '404' ? 404 : 201;
   return { id: params.id, q: query.q, name: body && body.name, token: req.headers['x-token'] || null, method: req.method };`,
);

test('fetch: code reads params, query, body and headers, and sets the status', async () => {
  await useMocks([echo]);
  const page = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const got = await fetchIn(page, '/doc/7?q=x', {
      method: 'POST',
      body: '{"name":"n"}',
      headers: { 'content-type': 'application/json', 'x-token': 't1' },
    });
    expect(got.status).toBe(201);
    expect(JSON.parse(got.text)).toEqual({ id: '7', q: 'x', name: 'n', token: 't1', method: 'POST' });
    expect(got.headers['content-type']).toBe('application/json');
    expect(got.headers['x-from']).toBe('mock');
    expect((await fetchIn(page, '/doc/404')).status).toBe(404);
  } finally {
    await page.close();
  }
});

test('XHR: the same code mock answers, with request headers', async () => {
  await useMocks([echo]);
  const page = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const got = await xhrIn(page, '/doc/9?q=y', 'PUT', '{"name":"m"}', { 'X-Token': 't2' });
    expect(got.status).toBe(201);
    expect(JSON.parse(got.text)).toEqual({ id: '9', q: 'y', name: 'm', token: 't2', method: 'PUT' });
  } finally {
    await page.close();
  }
});

test('a page whose CSP blocks eval still gets code mocks', async () => {
  await useMocks([echo]);
  const page = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/strict.html`);
    expect(await page.evaluate(() => (window as unknown as { evalBlocked: boolean }).evalBlocked)).toBe(true);
    const got = await fetchIn(page, '/doc/3');
    expect(got.status).toBe(201);
    expect(JSON.parse(got.text).id).toBe('3');
  } finally {
    await page.close();
  }
});

test('a throwing handler answers 500 with the message, warns in the Console, and logs the error', async () => {
  await useMocks([codeMock('bad', '/api/bad', "throw new Error('boom')")]);
  const page = await session.context.newPage();
  const panel = await session.context.newPage();
  const warns: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning' && m.text().startsWith('[wemock]')) warns.push(m.text());
  });
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panel.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);
    const got = await fetchIn(page, '/api/bad');
    expect(got.status).toBe(500);
    expect(got.headers['x-wemock-error']).toBe('1');
    expect(JSON.parse(got.text)).toEqual({ wemockError: 'boom' });
    await expect.poll(() => warns.length).toBe(1);
    expect(warns[0]).toMatch(/→ 500 mock "bad" \(\d+ ms\): code failed: boom$/);

    await panel.getByTestId('log-row').first().click();
    await expect(panel.getByTestId('detail-error')).toHaveText('Code failed: boom');
  } finally {
    await panel.close();
    await page.close();
  }
});

test('an endless handler is stopped after 1 s, and the next call still works', async () => {
  await useMocks([codeMock('loop', '/api/loop', 'while (true) {}'), echo]);
  const page = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const t0 = Date.now();
    const got = await xhrIn(page, '/api/loop');
    expect(got.status).toBe(500);
    expect(got.text).toContain('longer than 1000 ms');
    expect(Date.now() - t0).toBeLessThan(2900);
    expect((await fetchIn(page, '/doc/1')).status).toBe(201);
  } finally {
    await page.close();
  }
});

test('async code, bytes, a delay from res, and a text body all work', async () => {
  await useMocks([
    codeMock('wait', '/api/wait', "await new Promise((r) => setTimeout(r, 20)); res.delayMs = 150; return 'plain';"),
    codeMock('bin', '/api/bin', 'res.headers["content-type"] = "application/octet-stream"; return new Uint8Array([0, 1, 255]);'),
  ]);
  const page = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const t0 = Date.now();
    const got = await fetchIn(page, '/api/wait');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(150);
    expect(got.text).toBe('plain');
    expect(got.headers['content-type']).toBeUndefined();
    const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch('/api/bin')).arrayBuffer())));
    expect(bytes).toEqual([0, 1, 255]);
  } finally {
    await page.close();
  }
});

test('a page cannot run a code mock of another project', async () => {
  const other = newProject('p2', 'http://other.test');
  other.scenarios[0]!.mocks.push(codeMock('secret', '/x', "return 'secret'"));
  const mine = newProject('p1', fixture.origin);
  await session.setState({ ...emptyState(), projects: [mine, other], enabledOrigins: [fixture.origin] });
  const page = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    await page.waitForTimeout(100);
    const reply = await page.evaluate(
      () =>
        new Promise<{ error?: string; body: string }>((resolve) => {
          window.addEventListener('message', (e) => {
            const d = e.data as { type?: string; callId?: string; reply?: { error?: string; response: { body: string } } };
            if (d?.type === 'handler-result' && d.callId === 'forged') resolve({ error: d.reply?.error, body: d.reply!.response.body });
          });
          window.postMessage(
            { source: 'wemock-page', type: 'run-handler', callId: 'forged', mockId: 'secret', request: { method: 'GET', url: 'http://other.test/x', headers: {} } },
            '*',
          );
        }),
    );
    expect(reply.error).toMatch(/not found/);
    expect(reply.body).not.toContain('secret"');
  } finally {
    await page.close();
  }
});

test('the editor: switch a new mock to Code, save, and the page gets its answer', async () => {
  await useMocks([]);
  const page = await session.context.newPage();
  const panel = await session.context.newPage();
  try {
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panel.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);
    await panel.getByTestId('tab-mocks').click();
    await panel.getByTestId('mock-new').click();
    await expect(panel.getByTestId('field-pattern')).toHaveValue('/');
    await panel.getByTestId('field-pattern').fill('/items/:id');
    await panel.getByTestId('reply-code').click();
    await expect(panel.getByTestId('reply-code')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('[data-testid="code-view"] .cm-content')).toContainText('return { id: params.id };');
    await panel.locator('[data-testid="code-view"] .cm-content').fill('return { item: Number(params.id) * 2 };');
    await panel.getByTestId('mock-save').click();
    await expect(panel.getByTestId('code-chip')).toBeVisible();

    await expect.poll(async () => (await fetchIn(page, '/items/21')).text).toBe('{"item":42}');

    // Back to a fixed body: the code stays saved but no longer answers.
    await panel.getByTestId('reply-fixed').click();
    await panel.locator('.cm-content').fill('{"fixed":true}');
    await panel.getByTestId('mock-save').click();
    await expect(panel.getByTestId('code-chip')).toHaveCount(0);
    await expect.poll(async () => (await fetchIn(page, '/items/21')).text).toBe('{"fixed":true}');
  } finally {
    await panel.close();
    await page.close();
  }
});
