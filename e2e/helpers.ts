import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import path from 'node:path';
import type { WemockState } from '../src/core/types';

declare const chrome: {
  storage: {
    local: {
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
  tabs: {
    query(queryInfo: Record<string, unknown>): Promise<Array<{ id?: number; url?: string }>>;
  };
  scripting: {
    getRegisteredContentScripts(): Promise<Array<{ id: string }>>;
  };
};

export const EXTENSION_PATH = path.resolve('.output/chrome-mv3');

export interface Launched {
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
}

/** Chromium with the unpacked build loaded. Run `npm run build` first. */
export async function launchExtension(): Promise<Launched> {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
  const worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  return { context, worker, extensionId };
}

export interface WemockSession {
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
  fixtureUrl: string;
  setState(s: WemockState): Promise<void>;
  tabIdOf(page: Page): Promise<number>;
}

export async function launchWemock(fixtureUrl = ''): Promise<WemockSession> {
  const { context, worker, extensionId } = await launchExtension();

  // A fresh install registers the page scripts asynchronously; a page loaded before that
  // gets no patch at all. Wait for both registrations, as a real user would by never
  // being this fast.
  await worker.evaluate(async () => {
    for (let i = 0; i < 100; i++) {
      const ids = (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id);
      if (ids.includes('wemock-page') && ids.includes('wemock-bridge')) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('wemock content scripts were never registered');
  });

  return {
    context,
    worker,
    extensionId,
    fixtureUrl,
    async setState(state: WemockState): Promise<void> {
      await worker.evaluate((s) => {
        return chrome.storage.local.set({ 'wemock.state': s });
      }, state);
    },
    async tabIdOf(page: Page): Promise<number> {
      const pageUrl = page.url();
      return await worker.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({});
        const match = tabs.find((t) => t.url === url);
        return match?.id ?? -1;
      }, pageUrl);
    },
  };
}
