export const LOCALHOST_MATCHES = ['http://localhost/*', 'http://127.0.0.1/*'];

export function originToMatch(origin: string): string {
  try {
    const url = new URL(origin);
    return `${url.origin}/*`;
  } catch {
    const clean = origin.replace(/\/+$/, '');
    return `${clean}/*`;
  }
}

let syncQueue: Promise<void> = Promise.resolve();

export function syncRegistrations(enabledOrigins: string[]): Promise<void> {
  const run = async (): Promise<void> => {
    const permittedMatches: string[] = [];
    for (const origin of enabledOrigins) {
      const match = originToMatch(origin);
      let hasPermission = false;
      try {
        hasPermission = await browser.permissions.contains({ origins: [match] });
      } catch {
        hasPermission = false;
      }
      if (hasPermission && !permittedMatches.includes(match)) {
        permittedMatches.push(match);
      }
    }

    const matches = [...LOCALHOST_MATCHES];
    for (const match of permittedMatches) {
      if (!matches.includes(match)) {
        matches.push(match);
      }
    }

    try {
      await browser.scripting.unregisterContentScripts({
        ids: ['wemock-page', 'wemock-bridge'],
      });
    } catch {
      // Ignore if not previously registered
    }

    await browser.scripting.registerContentScripts([
      {
        id: 'wemock-page',
        matches,
        runAt: 'document_start',
        world: 'MAIN',
        js: ['content-scripts/page.js'],
      },
      {
        id: 'wemock-bridge',
        matches,
        runAt: 'document_start',
        world: 'ISOLATED',
        js: ['content-scripts/bridge.js'],
      },
    ]);
  };

  const next = syncQueue.then(run, run);
  syncQueue = next.catch(() => {});
  return next;
}
