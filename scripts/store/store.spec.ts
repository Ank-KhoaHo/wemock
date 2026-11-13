// A19: the Chrome Web Store screenshots (1280x800), the small promo tile (440x280) and the
// marquee (1400x560), taken from the real built extension with a made-up shop app's mocks.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { emptyState, type Mock, type MockResponse, type WemockState } from '../../src/core/types';
import { startFixtureServer } from '../../e2e/fixture/server';
import { launchWemock } from '../../e2e/helpers';

const OUT = path.resolve('docs/store/images');
const PORT = Number(process.env.STORE_PORT ?? 3000);
const json = { 'content-type': 'application/json' };
const res = (status: number, body: unknown, delayMs = 0): MockResponse => ({
  status, headers: json, body: typeof body === 'string' ? body : JSON.stringify(body, null, 2), bodyEncoding: 'text', delayMs,
});

function mk(id: string, name: string, method: Mock['method'], urlPattern: string, response: MockResponse, extra: Partial<Mock> = {}): Mock {
  return { id, name, enabled: true, method, urlPattern, response, source: 'manual', createdAt: 0, ...extra };
}

function state(origin: string): WemockState {
  const products = { items: [
    { id: 7, name: 'Green tea, 100 g', price: 4.5, stock: 12 },
    { id: 8, name: 'Oolong, 50 g', price: 6.9, stock: 0 },
    { id: 9, name: 'Teapot, glass', price: 24, stock: 3 },
  ] };
  return {
    ...emptyState(),
    enabledOrigins: [origin],
    projects: [{
      id: 'shop', name: new URL(origin).host, origins: [origin], activeScenarioId: 'default',
      scenarios: [
        {
          id: 'default', name: 'Default',
          mocks: [
            mk('m1', 'Product list', 'GET', '/api/products', res(200, products)),
            mk('m2', 'Product by id', 'GET', '/api/products/:id', res(200, ''), {
              reply: 'code',
              code: "// :id comes from the URL pattern\nconst id = Number(req.params.id);\nif (id > 100) {\n  res.status = 404;\n  return { error: `No product ${id}` };\n}\nreturn { id, name: `Product ${id}`, price: 4.5, stock: id % 3 ? 12 : 0 };",
            }),
            mk('m3', 'Add to cart', 'POST', '/api/cart', res(201, '{\n  "lineId": "{{uuid}}",\n  "sku": "{{body.sku}}",\n  "qty": {{body.qty}}\n}'), { templates: true }),
            mk('m4', 'Order status', 'GET', '/api/orders/:id/status', res(202, ''), {
              reply: 'sequence',
              sequence: { after: 'stay', steps: [
                res(202, { state: 'packing' }), res(202, { state: 'shipped' }), res(200, { state: 'delivered' }),
              ] },
            }),
            mk('m5', 'Signed-in user', 'GET', '/api/me', res(200, { id: 'u1', name: 'Anna', plan: 'pro' }), { match: { headers: { authorization: '*' } } }),
            mk('m6', 'Guest', 'GET', '/api/me', res(401, { error: 'Sign in first' })),
            // A36: the newer reply kinds, so the lists show them.
            mk('m7', 'Reviews, real but hidden', 'GET', '/api/reviews', res(200, ''), {
              reply: 'patch', patch: { set: [{ path: 'items.*.visible', value: 'false' }] },
            }),
            mk('m8', 'Assistant, streamed', 'GET', '/api/assistant', res(200, ''), {
              reply: 'stream', stream: { chunks: ['Green tea ', 'is in stock, ', '12 left.'], gapMs: 300, sse: true },
            }),
          ],
          sockets: [{
            id: 's1', name: 'Notifications hub', enabled: true, kind: 'signalr', urlPattern: '/hubs/notifications', createdAt: 0,
            onConnect: [
              { id: 'p1', afterMs: 0, target: 'Notify', data: '["Welcome back, Anna"]' },
              { id: 'p2', afterMs: 3000, target: 'StockChanged', data: '[8, 5]' },
            ],
            replies: [{
              id: 'r1', when: 'Subscribe', respond: 'fixed', result: '{"ok":true}',
              pushes: [{ id: 'p3', afterMs: 500, target: 'Notify', data: '["You will hear about order 1042"]' }],
            }],
          }],
        },
        {
          id: 'down', name: 'Checkout down',
          mocks: [
            mk('d1', 'Checkout 503', 'POST', '/api/checkout', res(503, { error: 'Payments are down' })),
            mk('d2', 'Cart 503', 'POST', '/api/cart', res(503, { error: 'Try again later' })),
          ],
        },
        {
          id: 'empty', name: 'Empty shop',
          mocks: [mk('e1', 'No products', 'GET', '/api/products', res(200, { items: [] }))],
        },
        {
          id: 'slow', name: 'Slow network',
          mocks: [mk('w1', 'Products, slow', 'GET', '/api/products', res(200, products, 3000))],
        },
      ],
    }],
  } as WemockState;
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

test('store images', async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const fixture = await startFixtureServer('127.0.0.1', PORT);
  const origin = `http://localhost:${fixture.port}`;
  const s = await launchWemock(origin);
  try {
    await s.setState(state(origin));
    const page = await s.context.newPage();
    await page.goto(`${origin}/index.html`);
    const tabId = await s.tabIdOf(page);
    const panel = await s.context.newPage();
    await panel.setViewportSize({ width: 1280, height: 800 });
    await panel.emulateMedia({ colorScheme: 'light' });
    await panel.goto(`chrome-extension://${s.extensionId}/panel.html?tabId=${tabId}`);
    await panel.waitForTimeout(500);

    await page.evaluate(async () => {
      const get = async (u: string, init?: RequestInit) => (await fetch(u, init)).text();
      await get('/api/products');
      await get('/api/me', { headers: { authorization: 'Bearer t' } });
      await get('/api/products/7');
      await get('/api/cart', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"sku":"tea-07","qty":2}' });
      await get('/api/orders/1042/status');
      await get('/api/orders/1042/status');
      await get('/api/echo', { method: 'POST', body: 'ping' });
      await get('/api/products/404');
      const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/ws/real`);
      await new Promise((r) => (ws.onopen = r));
      await new Promise((r) => setTimeout(r, 150));
      ws.send('hello');
      await new Promise((r) => setTimeout(r, 150));
      ws.close();
    });
    const rows = panel.getByTestId('log-row');
    await expect(rows.filter({ hasText: '/api/products/404' })).toHaveCount(1);

    // 1: the Log, with a code mock's reply and "Answered by".
    await rows.filter({ hasText: '/api/products/7' }).first().click();
    await expect(panel.getByTestId('answered-by')).toBeVisible();
    await shot(panel, 'screenshot-1-log');

    // 2: a mock that answers with code.
    await panel.getByTestId('tab-mocks').click();
    await panel.getByTestId('mock-row').filter({ hasText: 'Product by id' }).first().click();
    await expect(panel.locator('.cm-content').first()).toBeVisible();
    // Not Run: its answer sits below the 800 px frame, and running scrolls the editor's header away (A36).
    await shot(panel, 'screenshot-2-code-mock');

    // 4: a SignalR hub (taken before the Test bar runs, so no result shows).
    await panel.getByTestId('socket-row').first().click();
    await expect(panel.getByTestId('socket-name')).toHaveValue('Notifications hub');
    await shot(panel, 'screenshot-4-signalr');

    // 3: the Test bar.
    await panel.getByTestId('test-method').selectOption('GET');
    await panel.getByTestId('test-url').fill('/api/products/42');
    await panel.getByTestId('test-run').click();
    await expect(panel.getByTestId('test-status')).toBeVisible();
    await panel.getByTestId('mock-row').filter({ hasText: 'Product by id' }).first().click();
    await shot(panel, 'screenshot-3-test-bar');

    // 5: one click to another scenario.
    await panel.getByTestId('scenario-chip').filter({ hasText: 'Checkout down' }).first().click();
    await panel.getByTestId('mock-row').filter({ hasText: 'Checkout 503' }).first().click();
    await expect(panel.getByTestId('field-name')).toHaveValue('Checkout 503');
    await shot(panel, 'screenshot-5-scenarios');

    // Promo images, drawn from the icon and screenshot 1.
    // A44: the mockingbird, as SVG so it stays sharp at any size.
    const iconSvg = fs.readFileSync(path.resolve('.github/brand/icon.svg')).toString('base64');
    const log = fs.readFileSync(path.join(OUT, 'screenshot-1-log.png')).toString('base64');
    const art = await s.context.newPage();
    const promo = (w: number, h: number, body: string) => `<!doctype html><html><head><meta charset="utf-8"><style>
      *{box-sizing:border-box;margin:0}
      body{width:${w}px;height:${h}px;overflow:hidden;font-family:"Segoe UI",system-ui,sans-serif;color:#fff;
        background:linear-gradient(135deg,#0b57d0 0%,#1a73e8 55%,#4c8df6 100%)}
      .brand{display:flex;align-items:center;gap:14px}
      .brand img{border-radius:22%;box-shadow:0 0 0 3px rgba(255,255,255,.95),0 8px 22px rgba(0,0,0,.3)}
      .name{font-weight:800;letter-spacing:-.02em}
      .tag{opacity:.95;font-weight:600}
      .chips{display:flex;gap:8px;flex-wrap:wrap}
      .chip{background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:4px 12px;font-weight:600;font-size:15px}
      .shot{border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.4)}
    </style></head><body>${body}</body></html>`;

    await art.setViewportSize({ width: 440, height: 280 });
    await art.setContent(promo(440, 280, `
      <div style="padding:34px 32px;display:flex;flex-direction:column;gap:18px;height:100%">
        <div class="brand"><img src="data:image/svg+xml;base64,${iconSvg}" width="64" height="64"><span class="name" style="font-size:44px">wemock</span></div>
        <div class="tag" style="font-size:22px;line-height:1.25">Record real API calls.<br>Replay them as mocks.</div>
        <div class="chips" style="margin-top:auto"><span class="chip">Scenarios</span><span class="chip">Code replies</span><span class="chip">SignalR</span></div>
      </div>`));
    await art.screenshot({ path: path.join(OUT, 'promo-small-440x280.png') });

    await art.setViewportSize({ width: 1400, height: 560 });
    await art.setContent(promo(1400, 560, `
      <div style="display:flex;height:100%;align-items:center;padding:0 0 0 72px;gap:56px">
        <div style="flex:0 0 440px;display:flex;flex-direction:column;gap:22px">
          <div class="brand"><img src="data:image/svg+xml;base64,${iconSvg}" width="76" height="76"><span class="name" style="font-size:56px">wemock</span></div>
          <div class="tag" style="font-size:30px;line-height:1.25">Mock any API from Chrome DevTools.</div>
          <div style="font-size:19px;opacity:.92;line-height:1.45">Record calls, switch scenarios in one click, answer with code, and mock WebSocket and SignalR.</div>
          <div class="chips"><span class="chip">Free</span><span class="chip">Open source</span><span class="chip">Nothing leaves your browser</span></div>
        </div>
        <img class="shot" src="data:image/png;base64,${log}" style="width:820px;margin-top:60px;align-self:flex-start">
      </div>`));
    await art.screenshot({ path: path.join(OUT, 'promo-marquee-1400x560.png') });

    // Banners: the GitHub link preview (Settings > Social preview, 1280x640) and the README's top
    // banner (1280x320, committed as .github/banner.png).
    const mocks = fs.readFileSync(path.join(OUT, 'screenshot-2-code-mock.png')).toString('base64');
    await art.setViewportSize({ width: 1280, height: 640 });
    await art.setContent(promo(1280, 640, `
      <div style="display:flex;height:100%;align-items:center;padding:0 0 0 64px;gap:48px">
        <div style="flex:0 0 420px;display:flex;flex-direction:column;gap:22px">
          <div class="brand"><img src="data:image/svg+xml;base64,${iconSvg}" width="76" height="76"><span class="name" style="font-size:58px">wemock</span></div>
          <div class="tag" style="font-size:30px;line-height:1.25">Mock any API from Chrome DevTools.</div>
          <div class="chips"><span class="chip">Free</span><span class="chip">MIT</span><span class="chip">WebSocket and SignalR</span></div>
          <div style="font-size:18px;opacity:.9">github.com/Ank-KhoaHo/wemock</div>
        </div>
        <div style="position:relative;flex:1;height:100%">
          <img class="shot" src="data:image/png;base64,${mocks}" style="position:absolute;width:760px;top:70px;left:40px">
          <img class="shot" src="data:image/png;base64,${log}" style="position:absolute;width:640px;top:290px;left:0">
        </div>
      </div>`));
    await art.screenshot({ path: path.join(OUT, 'github-social-1280x640.png') });

    await art.setViewportSize({ width: 1280, height: 320 });
    await art.setContent(promo(1280, 320, `
      <div style="display:flex;height:100%;align-items:center;padding:0 0 0 64px;gap:48px">
        <div style="flex:0 0 520px;display:flex;flex-direction:column;gap:18px">
          <div class="brand"><img src="data:image/svg+xml;base64,${iconSvg}" width="72" height="72"><span class="name" style="font-size:56px">wemock</span></div>
          <div class="tag" style="font-size:26px;line-height:1.25">Record real API calls in DevTools.<br>Replay them as mocks.</div>
        </div>
        <img class="shot" src="data:image/png;base64,${log}" style="width:640px;margin-top:150px;align-self:flex-start">
      </div>`));
    await art.screenshot({ path: path.join(OUT, 'readme-banner-1280x320.png') });
  } finally {
    await s.context.close();
    await fixture.close();
  }
});
