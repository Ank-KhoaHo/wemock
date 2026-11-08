import { expect, test } from '@playwright/test';
import { emptyState, newProject, type Mock, type WemockState } from '../src/core/types';
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

test('a matching fetch mock is served', async () => {
  const page = await session.context.newPage();
  try {
    const project = newProject('p1', fixture.origin);
    const mock: Mock = {
      id: 'm1',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/goals',
      response: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"source":"mocked"}',
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
    await page.click('#btn-fetch');
    await expect(page.locator('#out')).toHaveText('{"source":"mocked"}');
  } finally {
    await page.close();
  }
});

test('a non-matching call reaches the server', async () => {
  const page = await session.context.newPage();
  try {
    const project = newProject('p1', fixture.origin);
    const state: WemockState = {
      ...emptyState(),
      projects: [project],
      enabledOrigins: [fixture.origin],
    };
    await session.setState(state);
    await page.goto(`${fixture.url}/index.html`);
    await page.click('#btn-fetch');
    await expect(page.locator('#out')).toHaveText('{"source":"server"}');
  } finally {
    await page.close();
  }
});

test('switching scenario changes the next response', async () => {
  const page = await session.context.newPage();
  try {
    const project = newProject('p1', fixture.origin);
    project.scenarios[0]!.mocks.push({
      id: 'm1',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/goals',
      response: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"source":"default"}',
        bodyEncoding: 'text',
        delayMs: 0,
      },
      source: 'manual',
      createdAt: Date.now(),
    });
    project.scenarios.push({
      id: 'alt',
      name: 'Alternative',
      mocks: [
        {
          id: 'm2',
          enabled: true,
          method: 'GET',
          urlPattern: '/api/goals',
          response: {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: '{"source":"scenario-2"}',
            bodyEncoding: 'text',
            delayMs: 0,
          },
          source: 'manual',
          createdAt: Date.now(),
        },
      ],
    });
    project.activeScenarioId = 'default';
    const state: WemockState = {
      ...emptyState(),
      projects: [project],
      enabledOrigins: [fixture.origin],
    };
    await session.setState(state);
    await page.goto(`${fixture.url}/index.html`);
    await page.click('#btn-fetch');
    await expect(page.locator('#out')).toHaveText('{"source":"default"}');

    // Switch scenario
    project.activeScenarioId = 'alt';
    await session.setState({
      ...state,
      projects: [project],
    });
    await page.reload();
    await page.click('#btn-fetch');
    await expect(page.locator('#out')).toHaveText('{"source":"scenario-2"}');
  } finally {
    await page.close();
  }
});

test('delay holds the call', async () => {
  const page = await session.context.newPage();
  try {
    const project = newProject('p1', fixture.origin);
    project.scenarios[0]!.mocks.push({
      id: 'm-delayed',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/goals',
      response: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"source":"delayed"}',
        bodyEncoding: 'text',
        delayMs: 600,
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

    const elapsed = await page.evaluate(async () => {
      const t0 = performance.now();
      await fetch('/api/goals');
      return performance.now() - t0;
    });

    expect(elapsed).toBeGreaterThanOrEqual(600);
    expect(elapsed).toBeLessThanOrEqual(650);
  } finally {
    await page.close();
  }
});

test('an early head-script call is still mocked', async () => {
  const page = await session.context.newPage();
  try {
    const project = newProject('p1', fixture.origin);
    project.scenarios[0]!.mocks.push({
      id: 'm-early',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/goals',
      response: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"source":"mock-early"}',
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
    await page.goto(`${fixture.url}/early.html`);
    await expect(page.locator('#out')).toHaveText('{"source":"mock-early"}');
  } finally {
    await page.close();
  }
});

test('an invalid pattern does not break later mocks or real calls', async () => {
  const page = await session.context.newPage();
  try {
    const project = newProject('p1', fixture.origin);
    // Bad pattern mock first:
    project.scenarios[0]!.mocks.push({
      id: 'm-bad',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/(',
      response: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"source":"broken"}',
        bodyEncoding: 'text',
        delayMs: 0,
      },
      source: 'manual',
      createdAt: Date.now(),
    });
    // Good mock second:
    project.scenarios[0]!.mocks.push({
      id: 'm-good',
      enabled: true,
      method: 'GET',
      urlPattern: '/api/goals',
      response: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"source":"valid-mock"}',
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

    // Call /api/goals -> served by the valid mock
    await page.click('#btn-fetch');
    await expect(page.locator('#out')).toHaveText('{"source":"valid-mock"}');

    // Call /api/echo (real call) -> reaches server and works
    await page.click('#btn-echo');
    await expect(page.locator('#out')).toHaveText('echo:hello');
  } finally {
    await page.close();
  }
});
