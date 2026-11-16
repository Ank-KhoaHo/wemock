import React, { useEffect, useState } from 'react';
import { CheckIcon } from './icons';

export interface ToastOptions {
  undo?: () => void;
  tone?: 'error';
  testId?: string;
}

export interface ToastItem {
  id: number;
  text: string;
  undo?: () => void;
  tone?: 'error';
  testId?: string;
  duration: number;
}

type ToastListener = (toasts: ToastItem[]) => void;
let toastsState: ToastItem[] = [];
const listeners = new Set<ToastListener>();
let nextToastId = 1;

export function notify(text: string, options?: ToastOptions): void {
  const duration = options?.undo ? 10000 : 3000;
  const item: ToastItem = {
    id: nextToastId++,
    text,
    undo: options?.undo,
    tone: options?.tone,
    testId: options?.testId,
    duration,
  };

  // Only the newest change can be undone: an older snapshot would also undo every change since.
  const kept = options?.undo ? toastsState.filter((t) => !t.undo) : toastsState;
  let next = [...kept, item];
  if (next.length > 3) {
    next = next.slice(next.length - 3);
  }
  toastsState = next;
  listeners.forEach((l) => l(toastsState));

  setTimeout(() => {
    removeToast(item.id);
  }, duration);
}

/**
 * Withdraws the pending Undo. Undo puts back a whole project, so after any later change it would
 * also undo that change, without saying so.
 */
export function clearUndo(): void {
  const next = toastsState.filter((t) => !t.undo);
  if (next.length !== toastsState.length) {
    toastsState = next;
    listeners.forEach((l) => l(toastsState));
  }
}

export function removeToast(id: number): void {
  const next = toastsState.filter((t) => t.id !== id);
  if (next.length !== toastsState.length) {
    toastsState = next;
    listeners.forEach((l) => l(toastsState));
  }
}

export function ToastContainer(): React.JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>(toastsState);

  useEffect(() => {
    const l: ToastListener = (t) => setToasts([...t]);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  return (
    <div className="toasts" id="toasts" aria-live="polite">
      {toasts.map((t) => {
        const testId = t.testId ?? (t.undo ? 'undo-bar' : 'toast');
        return (
          <div
            key={t.id}
            data-testid={testId}
            className={`toast ${t.tone === 'error' ? 'toast-error' : ''}`}
          >
            {t.tone !== 'error' && (
              <span className="ok">
                <CheckIcon size={16} />
              </span>
            )}
            <span>{t.text}</span>
            {t.undo && (
              <button
                type="button"
                data-testid="undo"
                className="undo-btn"
                onClick={() => {
                  t.undo?.();
                  removeToast(t.id);
                }}
              >
                Undo
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default ToastContainer;
