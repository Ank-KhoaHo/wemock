import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { LOCALHOST_MATCHES, originToMatch, syncRegistrations } from './sites';

interface RegisteredScript {
  id: string;
  matches: string[];
  runAt: string;
  world: string;
  js: string[];
}

describe('sites', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    // fakeBrowser from wxt/testing does not implement browser.scripting or browser.permissions
    (fakeBrowser as unknown as Record<string, unknown>).scripting = {
      unregisterContentScripts: vi.fn().mockResolvedValue(undefined),
      registerContentScripts: vi.fn().mockResolvedValue(undefined),
    };
    (fakeBrowser as unknown as Record<string, unknown>).permissions = {
      contains: vi.fn().mockResolvedValue(true),
      request: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockResolvedValue(true),
    };
  });

  describe('originToMatch', () => {
    it('appends /* to origin', () => {
      expect(originToMatch('https://a.com')).toBe('https://a.com/*');
    });

    it('drops paths and query while keeping origin', () => {
      expect(originToMatch('https://a.com/foo/bar?baz=1#hash')).toBe('https://a.com/*');
    });

    it('keeps port number', () => {
      expect(originToMatch('https://a.com:8080/foo')).toBe('https://a.com:8080/*');
      expect(originToMatch('http://localhost:3000')).toBe('http://localhost:3000/*');
    });

    it('handles origin with trailing slash', () => {
      expect(originToMatch('https://a.com/')).toBe('https://a.com/*');
    });
  });

  describe('syncRegistrations', () => {
    it('unregisters ids wemock-page and wemock-bridge, then registers both with matches, runAt, worlds, and js', async () => {
      await syncRegistrations(['https://a.com']);

      expect(browser.scripting.unregisterContentScripts).toHaveBeenCalledWith({
        ids: ['wemock-page', 'wemock-bridge'],
      });

      expect(browser.scripting.registerContentScripts).toHaveBeenCalledWith([
        {
          id: 'wemock-page',
          matches: [...LOCALHOST_MATCHES, 'https://a.com/*'],
          runAt: 'document_start',
          world: 'MAIN',
          js: ['content-scripts/page.js'],
        },
        {
          id: 'wemock-bridge',
          matches: [...LOCALHOST_MATCHES, 'https://a.com/*'],
          runAt: 'document_start',
          world: 'ISOLATED',
          js: ['content-scripts/bridge.js'],
        },
      ]);
    });

    it('ignores origins it has no permission for', async () => {
      vi.mocked(browser.permissions.contains).mockImplementation(
        async (permissions) => {
          return Boolean(permissions?.origins?.includes('https://allowed.com/*'));
        },
      );

      await syncRegistrations(['https://allowed.com', 'https://denied.com']);

      expect(browser.permissions.contains).toHaveBeenCalledWith({
        origins: ['https://allowed.com/*'],
      });
      expect(browser.permissions.contains).toHaveBeenCalledWith({
        origins: ['https://denied.com/*'],
      });

      expect(browser.scripting.registerContentScripts).toHaveBeenCalledWith([
        {
          id: 'wemock-page',
          matches: [...LOCALHOST_MATCHES, 'https://allowed.com/*'],
          runAt: 'document_start',
          world: 'MAIN',
          js: ['content-scripts/page.js'],
        },
        {
          id: 'wemock-bridge',
          matches: [...LOCALHOST_MATCHES, 'https://allowed.com/*'],
          runAt: 'document_start',
          world: 'ISOLATED',
          js: ['content-scripts/bridge.js'],
        },
      ]);
    });

    it('ignores unregister errors when scripts were not previously registered', async () => {
      vi.mocked(browser.scripting.unregisterContentScripts).mockRejectedValueOnce(
        new Error('No script registered with id'),
      );

      await expect(syncRegistrations(['https://a.com'])).resolves.toBeUndefined();
      expect(browser.scripting.registerContentScripts).toHaveBeenCalledTimes(1);
    });

    it('serializes overlapping calls so they end with exactly one registration of each id', async () => {
      const registered = new Map<string, RegisteredScript>();

      vi.mocked(browser.scripting.unregisterContentScripts).mockImplementation(
        async (filter) => {
          await new Promise((r) => setTimeout(r, 15));
          for (const id of filter?.ids ?? []) {
            registered.delete(id);
          }
        },
      );

      // Cast needed as browser.scripting.registerContentScripts mock parameter type is generic
      vi.mocked(browser.scripting.registerContentScripts).mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (scripts: any) => {
          await new Promise((r) => setTimeout(r, 15));
          for (const s of (scripts as RegisteredScript[]) ?? []) {
            if (registered.has(s.id)) {
              throw new Error(`Duplicate script ID registration: ${s.id}`);
            }
            registered.set(s.id, s);
          }
        },
      );

      const p1 = syncRegistrations(['https://site1.com']);
      const p2 = syncRegistrations(['https://site2.com']);

      await Promise.all([p1, p2]);

      expect(registered.size).toBe(2);
      expect(registered.has('wemock-page')).toBe(true);
      expect(registered.has('wemock-bridge')).toBe(true);

      const pageScript = registered.get('wemock-page');
      expect(pageScript?.matches).toEqual([...LOCALHOST_MATCHES, 'https://site2.com/*']);
    });
  });
});
