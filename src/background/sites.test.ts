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
    // A small working registry, so tests see the real end state, not only the calls.
    let registered: Map<string, RegisteredScript>;
    const calls: string[] = [];

    beforeEach(() => {
      registered = new Map();
      calls.length = 0;
      const slow = () => new Promise((r) => setTimeout(r, 5));
      (fakeBrowser as unknown as Record<string, unknown>).scripting = {
        getRegisteredContentScripts: vi.fn(async (filter?: { ids?: string[] }) => {
          calls.push('get');
          return [...registered.values()].filter((s) => !filter?.ids || filter.ids.includes(s.id));
        }),
        registerContentScripts: vi.fn(async (scripts: RegisteredScript[]) => {
          calls.push('register');
          await slow();
          for (const s of scripts) {
            if (registered.has(s.id)) throw new Error(`Duplicate script ID: ${s.id}`);
            registered.set(s.id, s);
          }
        }),
        updateContentScripts: vi.fn(async (scripts: RegisteredScript[]) => {
          calls.push('update');
          await slow();
          for (const s of scripts) {
            if (!registered.has(s.id)) throw new Error(`No script with ID: ${s.id}`);
            registered.set(s.id, { ...registered.get(s.id)!, ...s });
          }
        }),
        unregisterContentScripts: vi.fn(async (filter?: { ids?: string[] }) => {
          calls.push('unregister');
          await slow();
          for (const id of filter?.ids ?? []) registered.delete(id);
        }),
      };
    });

    const page = (matches: string[]) => ({
      id: 'wemock-page', matches, runAt: 'document_start', world: 'MAIN', js: ['content-scripts/page.js'],
    });
    const bridge = (matches: string[]) => ({
      id: 'wemock-bridge', matches, runAt: 'document_start', world: 'ISOLATED', js: ['content-scripts/bridge.js'],
    });

    it('registers both scripts for localhost plus each permitted origin', async () => {
      await syncRegistrations(['https://a.com']);
      const m = [...LOCALHOST_MATCHES, 'https://a.com/*'];
      expect(registered.get('wemock-page')).toEqual(page(m));
      expect(registered.get('wemock-bridge')).toEqual(bridge(m));
    });

    it('ignores origins it has no permission for', async () => {
      vi.mocked(browser.permissions.contains).mockImplementation(async (perm) =>
        Boolean(perm?.origins?.includes('https://allowed.com/*')));
      await syncRegistrations(['https://allowed.com', 'https://denied.com']);
      expect(registered.get('wemock-page')?.matches).toEqual([...LOCALHOST_MATCHES, 'https://allowed.com/*']);
    });

    it('does nothing when the same scripts are already registered (worker restart)', async () => {
      await syncRegistrations(['https://a.com']);
      calls.length = 0;
      await syncRegistrations(['https://a.com']);
      expect(calls).toEqual(['get']);
    });

    it('updates in place, never unregistering, when the site list changes', async () => {
      await syncRegistrations(['https://a.com']);
      calls.length = 0;
      await syncRegistrations(['https://a.com', 'https://b.com']);
      expect(calls).not.toContain('unregister');
      expect(calls).toContain('update');
      expect(registered.get('wemock-bridge')?.matches).toEqual(
        [...LOCALHOST_MATCHES, 'https://a.com/*', 'https://b.com/*']);
    });

    it('replaces a half registration (only one of the two ids present)', async () => {
      registered.set('wemock-page', page(LOCALHOST_MATCHES) as RegisteredScript);
      await syncRegistrations([]);
      expect(registered.size).toBe(2);
      expect(registered.get('wemock-bridge')).toEqual(bridge(LOCALHOST_MATCHES));
    });

    it('serializes overlapping calls: the last one wins, one registration per id', async () => {
      await Promise.all([syncRegistrations(['https://site1.com']), syncRegistrations(['https://site2.com'])]);
      expect(registered.size).toBe(2);
      expect(registered.get('wemock-page')?.matches).toEqual([...LOCALHOST_MATCHES, 'https://site2.com/*']);
    });
  });
});
