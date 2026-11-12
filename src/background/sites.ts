export const LOCALHOST_MATCHES = [
  'http://localhost/*',
  'http://127.0.0.1/*',
  'https://localhost/*',
  'https://127.0.0.1/*',
];

export function originToMatch(origin: string): string {
  try {
    const url = new URL(origin);
    return `${url.origin}/*`;
  } catch {
    const clean = origin.replace(/\/+$/, '');
    return `${clean}/*`;
  }
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
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

    const wanted = [
      { id: 'wemock-page', matches, runAt: 'document_start' as const, world: 'MAIN' as const,
        js: ['content-scripts/page.js'] },
      { id: 'wemock-bridge', matches, runAt: 'document_start' as const, world: 'ISOLATED' as const,
        js: ['content-scripts/bridge.js'] },
    ];
    const ids = wanted.map((s) => s.id);

    // Never unregister when both scripts exist: a page that loads in that gap gets no mocks.
    // Chrome keeps registrations across worker restarts, so a restart usually changes nothing.
    const existing = await browser.scripting.getRegisteredContentScripts({ ids });
    if (existing.length === wanted.length) {
      const same = wanted.every((w) => {
        const e = existing.find((x) => x.id === w.id);
        return e !== undefined && sameList(e.matches ?? [], w.matches);
      });
      if (!same) {
        await browser.scripting.updateContentScripts(wanted);
      }
      return;
    }
    if (existing.length > 0) {
      await browser.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
    }
    await browser.scripting.registerContentScripts(wanted);
  };

  const next = syncQueue.then(run, run);
  syncQueue = next.catch(() => {});
  return next;
}
