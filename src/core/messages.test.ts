import { describe, expect, it } from 'vitest';
import {
  PAGE_SOURCE,
  BRIDGE_SOURCE,
  isPageToBridge,
  isBridgeToPage,
} from './messages';
import type { LogDraft } from './types';

function createValidDraft(): LogDraft {
  return {
    method: 'GET',
    url: 'https://example.com/api',
    status: 200,
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: '{"ok":true}',
    responseEncoding: 'text',
    truncated: false,
    durationMs: 12,
    badge: 'real',
    startedAt: 123456789,
  };
}

describe('messages', () => {
  it('defines the correct source constants', () => {
    expect(PAGE_SOURCE).toBe('wemock-page');
    expect(BRIDGE_SOURCE).toBe('wemock-bridge');
  });

  describe('isPageToBridge', () => {
    it('accepts a valid PageToBridge log message', () => {
      const msg = {
        source: PAGE_SOURCE,
        type: 'log',
        entry: createValidDraft(),
      };
      expect(isPageToBridge(msg)).toBe(true);
    });

    it('accepts optional fields requestBody and mockId', () => {
      const msg = {
        source: PAGE_SOURCE,
        type: 'log',
        entry: {
          ...createValidDraft(),
          requestBody: '{"param":1}',
          mockId: 'mock-123',
        },
      };
      expect(isPageToBridge(msg)).toBe(true);
    });

    it('rejects wrong source', () => {
      const msg = {
        source: 'wemock-bridge',
        type: 'log',
        entry: createValidDraft(),
      };
      expect(isPageToBridge(msg)).toBe(false);
    });

    it('rejects forbidden types like "save" (trust boundary)', () => {
      const msg = {
        source: PAGE_SOURCE,
        type: 'save',
        entry: createValidDraft(),
      };
      expect(isPageToBridge(msg)).toBe(false);
    });

    it('rejects missing or non-object entry', () => {
      expect(isPageToBridge({ source: PAGE_SOURCE, type: 'log' })).toBe(false);
      expect(isPageToBridge({ source: PAGE_SOURCE, type: 'log', entry: null })).toBe(false);
      expect(isPageToBridge({ source: PAGE_SOURCE, type: 'log', entry: 'not-an-object' })).toBe(false);
    });

    it('rejects invalid field types in entry', () => {
      const base = createValidDraft();
      expect(isPageToBridge({ source: PAGE_SOURCE, type: 'log', entry: { ...base, status: '200' } })).toBe(false);
      expect(isPageToBridge({ source: PAGE_SOURCE, type: 'log', entry: { ...base, method: 123 } })).toBe(false);
      expect(isPageToBridge({ source: PAGE_SOURCE, type: 'log', entry: { ...base, url: null } })).toBe(false);
      expect(isPageToBridge({ source: PAGE_SOURCE, type: 'log', entry: { ...base, responseHeaders: null } })).toBe(false);
      expect(isPageToBridge({ source: PAGE_SOURCE, type: 'log', entry: { ...base, responseHeaders: { 'x': 123 } } })).toBe(false);
      expect(isPageToBridge({ source: PAGE_SOURCE, type: 'log', entry: { ...base, badge: 'UNKNOWN' } })).toBe(false);
      expect(isPageToBridge({ source: PAGE_SOURCE, type: 'log', entry: { ...base, responseEncoding: 'invalid' } })).toBe(false);
      expect(isPageToBridge({ source: PAGE_SOURCE, type: 'log', entry: { ...base, truncated: 'false' } })).toBe(false);
      expect(isPageToBridge({ source: PAGE_SOURCE, type: 'log', entry: { ...base, durationMs: '10' } })).toBe(false);
      expect(isPageToBridge({ source: PAGE_SOURCE, type: 'log', entry: { ...base, startedAt: '100' } })).toBe(false);
    });

    it('rejects null or non-object messages', () => {
      expect(isPageToBridge(null)).toBe(false);
      expect(isPageToBridge(undefined)).toBe(false);
      expect(isPageToBridge('string')).toBe(false);
      expect(isPageToBridge(123)).toBe(false);
      expect(isPageToBridge([])).toBe(false);
    });
  });

  describe('isBridgeToPage', () => {
    it('accepts a valid BridgeToPage config message', () => {
      const msg = {
        source: BRIDGE_SOURCE,
        type: 'config',
        mocks: [],
        settings: { enabled: true, recording: true },
      };
      expect(isBridgeToPage(msg)).toBe(true);
    });

    it('rejects message with wrong source or type', () => {
      expect(isBridgeToPage({ source: PAGE_SOURCE, type: 'config', mocks: [], settings: { enabled: true, recording: true } })).toBe(false);
      expect(isBridgeToPage({ source: BRIDGE_SOURCE, type: 'other', mocks: [], settings: { enabled: true, recording: true } })).toBe(false);
    });

    it('rejects message with missing or invalid mocks', () => {
      expect(isBridgeToPage({ source: BRIDGE_SOURCE, type: 'config', mocks: null, settings: { enabled: true, recording: true } })).toBe(false);
      expect(isBridgeToPage({ source: BRIDGE_SOURCE, type: 'config', settings: { enabled: true, recording: true } })).toBe(false);
    });

    it('rejects message with missing or invalid settings', () => {
      expect(isBridgeToPage({ source: BRIDGE_SOURCE, type: 'config', mocks: [], settings: null })).toBe(false);
      expect(isBridgeToPage({ source: BRIDGE_SOURCE, type: 'config', mocks: [], settings: { enabled: true } })).toBe(false);
      expect(isBridgeToPage({ source: BRIDGE_SOURCE, type: 'config', mocks: [], settings: { recording: true } })).toBe(false);
    });
  });
});
