import { expect, test, type Page } from '@playwright/test';
import { emptyState, newProject, type Mock, type WemockState } from '../src/core/types';
import { type FixtureServer, startFixtureServer } from './fixture/server';
import { type WemockSession, launchWemock } from './helpers';

// A4: one Console line per mocked call, with a switch.
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

const goals: Mock = {
  id: 'm1',
  name: 'Goals',
  enabled: true,
  method: 'GET',
  urlPattern: '/api/goals',
  response: {
    status: 404,
    headers: { 'content-type': 'application/json' },
    body: '{"source":"mocked"}',
    bodyEncoding: 'text',
    delayMs: 0,
  },
  source: 'manual',
  createdAt: 0,
};

function stateWith(consoleLog?: boolean): WemockState {
  const project = newProject('p1', fixture.origin);
  project.scenarios[0]!.mocks.push(goals);
  const base = emptyState();
  const settings = { enabled: true, recording: true, ...(consoleLog === undefined ? {} : { consoleLog }) };
  return { ...base, settings, projects: [project], enabledOrigins: [fixture.origin] };
}

function wemockLines(page: Page): string[] {
  const lines: string[] = [];
  page.on('console', (m) => {
    if (m.text().startsWith('[wemock]')) lines.push(`${m.type()} ${m.text()}`);
  });
  return lines;
}

for (const button of ['#btn-fetch', '#btn-xhr']) {
  test(`${button}: a mocked call writes one info line`, async () => {
    const page = await session.context.newPage();
    try {
      await session.setState(stateWith());
      const lines = wemockLines(page);
      await page.goto(`${fixture.url}/index.html`);
      await page.click(button);
      await expect(page.locator('#out')).toContainText('mocked');
      await expect.poll(() => lines.length).toBe(1);
      expect(lines[0]).toMatch(/^info \[wemock\] GET \/api\/goals → 404 mock "Goals" \(\d+ ms\)$/);
    } finally {
      await page.close();
    }
  });
}

test('the switch off writes nothing, and a real call never writes', async () => {
  const page = await session.context.newPage();
  try {
    await session.setState(stateWith(false));
    const lines = wemockLines(page);
    await page.goto(`${fixture.url}/index.html`);
    await page.click('#btn-fetch');
    await expect(page.locator('#out')).toContainText('mocked');
    await page.click('#btn-echo');
    await expect(page.locator('#out')).not.toContainText('mocked');
    await page.waitForTimeout(200);
    expect(lines).toEqual([]);
  } finally {
    await page.close();
  }
});

test('the panel Console switch turns the line off and on', async () => {
  const page = await session.context.newPage();
  const panel = await session.context.newPage();
  try {
    await session.setState(stateWith());
    const lines = wemockLines(page);
    await page.goto(`${fixture.url}/index.html`);
    const tabId = await session.tabIdOf(page);
    await panel.goto(`chrome-extension://${session.extensionId}/panel.html?tabId=${tabId}`);
    const toggle = panel.getByTestId('console-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect
      .poll(() => session.worker.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = (await (globalThis as any).chrome.storage.local.get('wemock.state'))['wemock.state'];
        return s.settings.consoleLog;
      }))
      .toBe(false);
    await page.click('#btn-fetch');
    await expect(page.locator('#out')).toContainText('mocked');
    await page.waitForTimeout(200);
    expect(lines).toEqual([]);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await page.click('#btn-xhr');
    await expect.poll(() => lines.length).toBe(1);
  } finally {
    await panel.close();
    await page.close();
  }
});
