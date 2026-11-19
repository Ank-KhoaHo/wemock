// The lab: every kind of mock, against a real ASP.NET Core shop and the real client libraries
// (fetch, XMLHttpRequest, axios, EventSource, WebSocket, @microsoft/signalr). Each test first sees
// the real answer, then makes wemock answer, and reads what the page got.
import { expect, test, type Page } from '@playwright/test';
import { emptyState, type Mock, type Project, type SocketMock, type WemockState } from '../src/core/types';
import { type WemockSession, launchWemock } from '../e2e/helpers';

const LAB = process.env.LAB_URL ?? 'http://localhost:5199';
const ORIGIN = new URL(LAB).origin;

let session: WemockSession;

test.beforeAll(async () => {
  session = await launchWemock(LAB);
});

test.afterAll(async () => {
  await session?.context?.close();
});

let seq = 0;
function mock(method: Mock['method'], urlPattern: string, body: unknown, extra: Partial<Mock> = {}): Mock {
  return {
    id: `m${++seq}`,
    name: `${method} ${urlPattern}`,
    enabled: true,
    method,
    urlPattern,
    response: {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      bodyEncoding: 'text',
      delayMs: 0,
    },
    source: 'manual',
    createdAt: 0,
    ...extra,
  };
}

function project(defaultMocks: Mock[], extra: Partial<Project> = {}, sockets: SocketMock[] = []): Project {
  return {
    id: 'lab',
    name: 'lab',
    origins: [ORIGIN],
    activeScenarioId: 'default',
    scenarios: [{ id: 'default', name: 'Default', mocks: defaultMocks, sockets }],
    ...extra,
  };
}

async function readState(): Promise<WemockState> {
  return session.worker.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await (globalThis as any).chrome.storage.local.get('wemock.state'))['wemock.state'];
  });
}

/** The lab page with these mocks in place, loaded after them so the page script sees them. */
async function labWith(p: Project | null): Promise<Page> {
  await session.setState({ ...emptyState(), enabledOrigins: [ORIGIN], projects: p ? [p] : [] });
  const page = await session.context.newPage();
  await page.goto(LAB);
  return page;
}

async function press(page: Page, id: string): Promise<string> {
  const out = page.locator(`[data-r="${id}"]`);
  await page.click(`#${id}`);
  await expect(out).not.toHaveText(/^(\.\.\.)?$/, { timeout: 15_000 });
  return (await out.textContent()) ?? '';
}

test('the real lab answers every button, through wemock, untouched', async () => {
  const page = await labWith(null);
  try {
    expect(await press(page, 'product')).toContain('"id":7');
    expect(await press(page, 'search')).toContain('"q":"green"');
    expect(await press(page, 'price')).toContain('"total":90.72');
    expect(await press(page, 'me')).toMatch(/^401 /);
    expect(await press(page, 'xhr')).toContain('"id":3');
    expect(await press(page, 'axios')).toContain('"id":5');
    expect(await press(page, 'image')).toMatch(/^200 image\/png \d+ bytes/);
    await page.click('#assistant');
    await expect(page.locator('[data-r="assistant"]')).toHaveText('Hello from the real assistant', { timeout: 10_000 });
    expect(await press(page, 'graphql-order')).toContain('"status":"placed"');
    await page.click('#ws');
    await expect(page.locator('[data-r="ws"]')).toHaveText('hello from the lab | echo:ping', { timeout: 10_000 });
    await page.click('#hub');
    await expect(page.locator('[data-r="hub"]')).toContainText('StatusChanged 1042 shipped', { timeout: 15_000 });
    await expect(page.locator('[data-r="hub"]')).toContainText('Fail HubException');
    await expect(page.locator('[data-r="hub"]')).toContainText('StreamPrices 2.6,2.7,2.8');
  } finally {
    await page.close();
  }
});

test('a fixed reply, URL parameters and a query condition', async () => {
  const page = await labWith(project([
    mock('GET', '/api/products', { mocked: 'list' }),
    mock('GET', '/api/products/:id', '{"mocked":true,"id":"{{params.id}}"}', { templates: true }),
    mock('GET', '/api/categories/:category/products/:id', '{"mocked":true,"category":"{{params.category}}","id":"{{params.id}}"}', { templates: true }),
    mock('GET', '/api/products/search', { mocked: 'green, page 1' }, { match: { query: { q: 'green', page: '1' } } }),
  ]));
  try {
    expect(await press(page, 'products')).toBe('200 {"mocked":"list"}');
    expect(await press(page, 'product')).toBe('200 {"mocked":true,"id":"7"}');
    expect(await press(page, 'category')).toBe('200 {"mocked":true,"category":"tea","id":"4"}');
    expect(await press(page, 'search')).toBe('200 {"mocked":"green, page 1"}');
    // The same mocks serve XMLHttpRequest and axios.
    expect(await press(page, 'xhr')).toBe('200 {"mocked":true,"id":"3"}');
    expect(await press(page, 'axios')).toBe('200 {"mocked":true,"id":"5"}');
  } finally {
    await page.close();
  }
});

test('a code mock, a sequence, and a scenario over Default', async () => {
  const code = mock('GET', '/api/price/:id', '', {
    reply: 'code',
    code: 'return { id: Number(params.id), qty: Number(query.qty), total: Number(query.qty) * 2, from: "code" };',
  });
  const sequence = mock('GET', '/api/orders/:id/status', '', {
    reply: 'sequence',
    sequence: {
      after: 'stay',
      steps: ['mock-pending', 'mock-pending', 'mock-shipped'].map((s) => ({
        status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: s }), bodyEncoding: 'text' as const, delayMs: 0,
      })),
    },
  });
  const p = project([code, sequence], {
    activeScenarioId: 'down',
    scenarios: [
      { id: 'default', name: 'Default', mocks: [code, sequence] },
      { id: 'down', name: 'Checkout down', mocks: [mock('POST', '/api/checkout', { error: 'Payments are down' }, { response: {
        status: 503, headers: { 'content-type': 'application/json' }, body: '{"error":"Payments are down"}', bodyEncoding: 'text', delayMs: 0,
      } })] },
    ],
  });
  const page = await labWith(p);
  try {
    expect(await press(page, 'price')).toBe('200 {"id":7,"qty":12,"total":24,"from":"code"}');
    expect(await press(page, 'status')).toBe('200 {"status":"mock-pending"}');
    expect(await press(page, 'status')).toBe('200 {"status":"mock-pending"}');
    expect(await press(page, 'status')).toBe('200 {"status":"mock-shipped"}');
    expect(await press(page, 'status')).toBe('200 {"status":"mock-shipped"}');
    expect(await press(page, 'checkout')).toBe('503 {"error":"Payments are down"}');

    // Back to Default only: checkout reaches the real shop again; Default's mocks still answer.
    await session.setState({ ...emptyState(), enabledOrigins: [ORIGIN], projects: [{ ...p, activeScenarioId: 'default' }] });
    await expect.poll(() => press(page, 'checkout')).toContain('"status":"placed"');
    expect(await press(page, 'price')).toContain('"from":"code"');
  } finally {
    await page.close();
  }
});

test('conditions on the body and on a header, and Change real', async () => {
  const page = await labWith(project([
    mock('POST', '/api/cart', { mocked: 'coupon taken', discount: 0.5 }, { match: { body: 'TEA10' } }),
    mock('GET', '/api/me', { id: 'mock-user', plan: 'free' }, { match: { headers: { authorization: '*' } } }),
    mock('GET', '/api/recommendations', '', { reply: 'patch', patch: { set: [{ path: 'items.*.visible', value: 'false' }], remove: ['token'] } }),
  ]));
  try {
    expect(await press(page, 'cart-coupon')).toBe('200 {"mocked":"coupon taken","discount":0.5}');
    expect(await press(page, 'cart')).toContain('"discount":0');
    expect(await press(page, 'me-auth')).toBe('200 {"id":"mock-user","plan":"free"}');
    expect(await press(page, 'me')).toMatch(/^401 /);
    const rec = await press(page, 'recommendations');
    expect(rec).toContain('"visible":false');
    expect(rec).not.toContain('"visible":true');
    expect(rec).not.toContain('real-token');
  } finally {
    await page.close();
  }
});

test('a binary body, a Server-Sent Events stream, and GraphQL by operation name', async () => {
  // A 1 x 1 PNG.
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const page = await labWith(project([
    mock('GET', '/api/products/:id/image', '', { response: { status: 200, headers: { 'content-type': 'image/png' }, body: png, bodyEncoding: 'base64', delayMs: 0 } }),
    mock('GET', '/api/assistant', '', { reply: 'stream', stream: { chunks: ['Mocked', 'reply', 'in', 'five', 'parts'], gapMs: 30, sse: true } }),
    mock('POST', '/graphql', { data: { order: { id: 1042, status: 'mocked' } } }, { graphqlOperation: 'GetOrder' }),
  ]));
  try {
    expect(await press(page, 'image')).toBe(`200 image/png ${Buffer.from(png, 'base64').length} bytes`);
    await page.click('#assistant');
    await expect(page.locator('[data-r="assistant"]')).toHaveText('Mocked reply in five parts', { timeout: 10_000 });
    expect(await press(page, 'graphql-order')).toBe('200 {"data":{"order":{"id":1042,"status":"mocked"}}}');
    // Another operation on the same URL still reaches the real server.
    expect(await press(page, 'graphql-products')).toContain('"products"');
  } finally {
    await page.close();
  }
});

test('a plain WebSocket mock and a SignalR hub mock, with the real clients', async () => {
  const plain: SocketMock = {
    id: 'ws1', name: 'Echo', enabled: true, kind: 'plain', urlPattern: '/ws/echo', createdAt: 0,
    onConnect: [{ id: 'p1', afterMs: 0, target: '', data: 'mock hello' }],
    replies: [{ id: 'r1', when: 'ping', respond: 'fixed', result: 'mock pong', pushes: [] }],
  };
  const hub: SocketMock = {
    id: 'h1', name: 'Orders hub', enabled: true, kind: 'signalr', urlPattern: '/hubs/orders', createdAt: 0,
    onConnect: [{ id: 'p2', afterMs: 0, target: 'Notify', data: '["Mocked hub", 9]' }],
    replies: [
      { id: 'r2', when: 'Subscribe', respond: 'fixed', result: '{"orderId":1042,"status":"mock"}',
        pushes: [{ id: 'p3', afterMs: 100, target: 'StatusChanged', data: '[1042, "mock-shipped"]' }] },
      { id: 'r3', when: 'GetPrice', respond: 'fixed', result: '{"id":7,"price":1}', pushes: [] },
      { id: 'r4', when: 'Fail', respond: 'error', result: 'The lab says no', pushes: [] },
      { id: 'r5', when: 'StreamPrices', respond: 'stream', result: '[{"price":9},{"price":8},{"price":7}]', pushes: [] },
    ],
  };
  const page = await labWith(project([], {}, [plain, hub]));
  try {
    await page.click('#ws');
    await expect(page.locator('[data-r="ws"]')).toHaveText('mock hello | mock pong', { timeout: 10_000 });
    await page.click('#hub');
    const out = page.locator('[data-r="hub"]');
    await expect(out).toContainText('Notify Mocked hub 9', { timeout: 15_000 });
    await expect(out).toContainText('Subscribe {"orderId":1042,"status":"mock"}');
    await expect(out).toContainText('GetPrice {"id":7,"price":1}');
    await expect(out).toContainText('Fail HubException');
    await expect(out).toContainText('StreamPrices 9,8,7');
    await expect(out).toContainText('StatusChanged 1042 mock-shipped');
  } finally {
    await page.close();
  }
});

test('900 mocks from the lab\'s OpenAPI file, imported through the panel, answer all 900 calls', async () => {
  test.setTimeout(240_000);
  const page = await labWith(null);
  const panel = await session.context.newPage();
  try {
    const tabId = await session.tabIdOf(page);
    await panel.setViewportSize({ width: 1280, height: 800 });
    await panel.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);
    await panel.getByTestId('tab-mocks').click();
    const spec = await (await fetch(`${LAB}/openapi.json`)).text();
    await panel.getByTestId('import-open').click();
    await panel.getByTestId('import').setInputFiles({ name: 'lab-items.openapi.json', mimeType: 'application/json', buffer: Buffer.from(spec) });
    // A site with nothing yet imports without asking.
    await expect.poll(async () => (await readState()).projects.flatMap((p) => p.scenarios.flatMap((s) => s.mocks)).length, { timeout: 30_000 }).toBe(900);

    // Mark each mock so the page can tell a mocked answer from the real one.
    const st = await readState();
    for (const p of st.projects) for (const s of p.scenarios) for (const m of s.mocks) {
      m.response = { ...m.response, body: m.response.body.replace(/^\{/, '{"mocked":true,') };
    }
    await session.setState(st);
    await page.reload();
    expect(await press(page, 'many')).toMatch(/^900 of 900 ok, 900 mocked, \d+ ms$/);
  } finally {
    await panel.close();
    await page.close();
  }
});
