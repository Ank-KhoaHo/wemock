import { afterEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getInspectedTabId } from './inspectedTab';

describe('getInspectedTabId', () => {
  const originalWindow = (globalThis as Record<string, unknown>).window;

  afterEach(() => {
    (globalThis as Record<string, unknown>).window = originalWindow;
    delete (fakeBrowser as unknown as Record<string, unknown>).devtools;
  });

  it('reads tabId from location.search when browser.devtools is not present', () => {
    (globalThis as Record<string, unknown>).window = {
      location: { search: '?tabId=42' },
    };

    expect(getInspectedTabId()).toBe(42);
  });

  it('returns 0 when no tabId is available', () => {
    (globalThis as Record<string, unknown>).window = {
      location: { search: '' },
    };

    expect(getInspectedTabId()).toBe(0);
  });

  it('reads tabId from browser.devtools.inspectedWindow if present', () => {
    (fakeBrowser as unknown as Record<string, unknown>).devtools = {
      inspectedWindow: {
        tabId: 99,
      },
    };

    expect(getInspectedTabId()).toBe(99);
  });
});
