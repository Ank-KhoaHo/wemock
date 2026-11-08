import { chromium, type BrowserContext, type Worker } from '@playwright/test';
import path from 'node:path';

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
