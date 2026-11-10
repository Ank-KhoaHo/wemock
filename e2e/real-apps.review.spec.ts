// A26: wemock against real apps: React 19 (fetch), axios 1.x (XHR, interceptors), Angular 22
// (HttpClient, which uses fetch by default since Angular 20; an interceptor). Removing the fetch patch
// fails React and Angular, removing the XHR patch fails axios. Sources in scripts/apps/, output in e2e/fixture/apps/.
import { expect, test } from '@playwright/test';
import { emptyState, type Mock, type MockResponse, type Project } from '../src/core/types';
import { type FixtureServer, startFixtureServer } from './fixture/server';
import { type WemockSession, launchWemock } from './helpers';

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

const json = { 'content-type': 'application/json' };
const res = (status: number, body: unknown, delayMs = 0): MockResponse =>
  ({ status, headers: json, body: JSON.stringify(body), bodyEncoding: 'text', delayMs });
const mk = (id: string, method: Mock['method'], urlPattern: string, response: MockResponse, extra: Partial<Mock> = {}): Mock =>
  ({ id, name: id, enabled: true, method, urlPattern, response, source: 'manual', createdAt: 0, ...extra });

function project(): Project {
  return {
    id: 'p1', name: 'shop', origins: [fixture.origin], activeScenarioId: 'default',
    scenarios: [{
      id: 'default', name: 'Default',
      mocks: [
        mk('products', 'GET', '/api/products', res(200, { items: [{ id: 7, name: 'Green tea' }] })),
        mk('user', 'GET', '/api/users/:id', res(200, {}), { reply: 'code', code: "return { id: Number(req.params.id), name: 'User ' + req.params.id };" }),
        mk('status', 'GET', '/api/orders/:id/status', res(202, {}), {
          reply: 'sequence',
          sequence: { after: 'stay', steps: [res(202, { state: 'packing' }), res(202, { state: 'shipped' }), res(200, { state: 'delivered' })] },
        }),
        mk('cart-tea', 'POST', '/api/cart', res(201, { added: 'tea' }), { match: { body: '{"sku":"tea"}' } }),
        mk('cart-other', 'POST', '/api/cart', res(400, { error: 'unknown sku' })),
        mk('me-signed-in', 'GET', '/api/me', res(200, { name: 'Anna' }), { match: { headers: { authorization: '*' } } }),
        mk('me-guest', 'GET', '/api/me', res(401, { error: 'sign in' })),
        mk('slow', 'GET', '/api/slow', res(200, { slow: true }, 2000)),
      ],
    }],
  };
}

const expected = {
  user: { status: 200, body: { id: 7, name: 'User 7' } },
  polls: [
    { status: 202, body: { state: 'packing' } },
    { status: 202, body: { state: 'shipped' } },
    { status: 200, body: { state: 'delivered' } },
  ],
  cart: { status: 201, body: { added: 'tea' } },
  me: { status: 200, body: { name: 'Anna' } },
  real: { status: 200, body: { source: 'server' } },
};

const APPS = [
  { name: 'react', path: '/apps/react/', slow: 'AbortError' },
  { name: 'axios', path: '/apps/axios/', slow: 'CanceledError' },
  { name: 'angular', path: '/apps/angular/', slow: 'unsubscribed' },
];

for (const app of APPS) {
  test(`${app.name}: mocks, code, sequence, conditions, abort and a real call`, async () => {
    await session.setState({ ...emptyState(), enabledOrigins: [fixture.origin], projects: [project()] });
    const page = await session.context.newPage();
    const tabId = await (async () => {
      await page.goto(`${fixture.url}${app.path}`);
      return session.tabIdOf(page);
    })();
    const panel = await session.context.newPage();
    try {
      await panel.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);
      // The call made on start-up, before anyone clicks.
      await expect(page.locator('#products')).toContainText('Green tea');

      await page.locator('#run').click();
      await expect(page.locator('#out')).not.toBeEmpty({ timeout: 10_000 });
      const out = await page.evaluate(() => (window as unknown as { __results: Record<string, unknown> }).__results);
      expect(out).toMatchObject(expected);
      expect(out.slow).toBe(app.slow);

      // The panel saw them: every mocked call as MOCK, the real one as real, the aborted one not served.
      const rows = panel.getByTestId('log-row');
      await expect(rows.filter({ hasText: '/api/goals' }).filter({ hasText: 'real' })).toHaveCount(1);
      await expect(rows.filter({ hasText: '/api/orders/1/status' }).filter({ hasText: 'MOCK' })).toHaveCount(3);
      await expect(rows.filter({ hasText: '/api/cart' }).filter({ hasText: '201' })).toHaveCount(1);
      await expect(rows.filter({ hasText: '/api/slow' }).filter({ hasText: '200' })).toHaveCount(0);

      // A reload starts the sequence over, as the A12 ticket says.
      await page.reload();
      await expect(page.locator('#products')).toContainText('Green tea');
      await page.locator('#run').click();
      await expect(page.locator('#out')).not.toBeEmpty({ timeout: 10_000 });
      const again = await page.evaluate(() => (window as unknown as { __results: Record<string, unknown> }).__results);
      expect(again.polls).toEqual(expected.polls);
    } finally {
      await panel.close();
      await page.close();
    }
  });
}
