import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { emptyState, newProject, STATE_KEY, type WemockState } from '../core/types';
import { loadState, onStateChange, updateState } from './store';

describe('store', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('missing key gives emptyState()', async () => {
    const state = await loadState();
    expect(state).toEqual(emptyState());
  });

  it('updateState writes through and returns updated state', async () => {
    const updated = await updateState((s) => ({
      ...s,
      settings: { ...s.settings, enabled: false },
    }));

    expect(updated.settings.enabled).toBe(false);
    const stored = await fakeBrowser.storage.local.get(STATE_KEY);
    expect(stored[STATE_KEY]).toEqual(updated);

    const loaded = await loadState();
    expect(loaded).toEqual(updated);
  });

  it('onStateChange notifies listeners on changes and unsubscribe stops notifications', async () => {
    const listener = vi.fn();
    const unsubscribe = onStateChange(listener);

    const newState: WemockState = {
      ...emptyState(),
      projects: [newProject('p1', 'http://localhost:3000')],
    };

    await fakeBrowser.storage.local.set({ [STATE_KEY]: newState });
    expect(listener).toHaveBeenCalledWith(newState);

    unsubscribe();
    await fakeBrowser.storage.local.set({
      [STATE_KEY]: { ...newState, enabledOrigins: ['http://localhost:3000'] },
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
