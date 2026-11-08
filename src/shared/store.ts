import { emptyState, STATE_KEY, type WemockState } from '../core/types';

export async function loadState(): Promise<WemockState> {
  const result = await browser.storage.local.get(STATE_KEY);
  const state = result[STATE_KEY];
  if (!state) {
    return emptyState();
  }
  return state as WemockState;
}

export async function updateState(fn: (s: WemockState) => WemockState): Promise<WemockState> {
  const current = await loadState();
  const next = fn(current);
  await browser.storage.local.set({ [STATE_KEY]: next });
  return next;
}

export function onStateChange(cb: (s: WemockState) => void): () => void {
  const listener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => {
    if (areaName === 'local' && STATE_KEY in changes) {
      const change = changes[STATE_KEY];
      const next = (change?.newValue ?? emptyState()) as WemockState;
      cb(next);
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => {
    browser.storage.onChanged.removeListener(listener);
  };
}
