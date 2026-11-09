// Reads the BUILT manifest, so run `npm run build` first. scripts/check.sh does.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const OUT = '.output/chrome-mv3';

describe('built manifest', () => {
  it('exists (run npm run build first)', () => {
    expect(existsSync(`${OUT}/manifest.json`)).toBe(true);
  });

  const m = existsSync(`${OUT}/manifest.json`)
    ? JSON.parse(readFileSync(`${OUT}/manifest.json`, 'utf8'))
    : {};

  it('is Manifest V3 named wemock', () => {
    expect(m.manifest_version).toBe(3);
    expect(m.name).toBe('wemock');
  });

  it('asks for exactly storage, unlimitedStorage, scripting and offscreen (A2)', () => {
    expect(new Set(m.permissions)).toEqual(new Set(['storage', 'unlimitedStorage', 'scripting', 'offscreen']));
  });

  it('is granted localhost only; every other site is optional', () => {
    expect(m.host_permissions).toEqual(['http://localhost/*', 'http://127.0.0.1/*']);
    expect(m.optional_host_permissions).toEqual(['<all_urls>']);
  });

  it('registers content scripts at runtime only, never in the manifest', () => {
    expect(m.content_scripts ?? []).toEqual([]);
    expect(existsSync(`${OUT}/content-scripts/page.js`)).toBe(true);
    expect(existsSync(`${OUT}/content-scripts/bridge.js`)).toBe(true);
  });

  it('has a devtools page, a panel page and a popup', () => {
    expect(m.devtools_page).toBe('devtools.html');
    expect(existsSync(`${OUT}/panel.html`)).toBe(true);
    expect(m.action?.default_popup).toBe('popup.html');
  });
});

describe('release manifest (task 10)', () => {
  const m = existsSync(`${OUT}/manifest.json`)
    ? JSON.parse(readFileSync(`${OUT}/manifest.json`, 'utf8'))
    : {};

  it('is version 1.0.0', () => {
    expect(m.version).toBe('1.0.0');
  });

  it('has icons at 16, 32, 48 and 128, and every file exists', () => {
    expect(Object.keys(m.icons ?? {}).sort()).toEqual(['128', '16', '32', '48']);
    for (const file of Object.values(m.icons ?? {}) as string[]) {
      expect(existsSync(`${OUT}/${file}`)).toBe(true);
    }
  });

  it('has a Store-sized description (at most 132 characters)', () => {
    expect(typeof m.description).toBe('string');
    expect(m.description.length).toBeLessThanOrEqual(132);
  });

  it('lets only the sandbox page eval, and keeps extension pages strict (A2)', () => {
    expect(m.sandbox).toEqual({ pages: ['sandbox.html'] });
    const csp = m.content_security_policy ?? {};
    expect(csp.sandbox).toContain("'unsafe-eval'");
    expect(csp.extension_pages ?? '').not.toContain('unsafe-eval');
  });
});
