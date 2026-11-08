import { GATE_TIMEOUT_MS, type Mock, type Settings } from '../core/types';

export interface Gate {
  open(cfg: { mocks: Mock[]; settings: Settings }): void;
  wait(): Promise<{ mocks: Mock[]; settings: Settings; late: boolean }>;
}

export function createGate(timeoutMs: number = GATE_TIMEOUT_MS): Gate {
  let isOpen = false;
  let isTimedOut = false;
  let currentConfig: { mocks: Mock[]; settings: Settings } = {
    mocks: [],
    settings: { enabled: true, recording: true },
  };

  type Waiter = (res: { mocks: Mock[]; settings: Settings; late: boolean }) => void;
  const waiters: Waiter[] = [];

  const timer = setTimeout(() => {
    isTimedOut = true;
    while (waiters.length > 0) {
      const resolve = waiters.shift()!;
      resolve({
        mocks: currentConfig.mocks,
        settings: currentConfig.settings,
        late: true,
      });
    }
  }, timeoutMs);

  if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') {
    timer.unref();
  }

  return {
    open(cfg: { mocks: Mock[]; settings: Settings }) {
      isOpen = true;
      isTimedOut = false;
      currentConfig = cfg;
      clearTimeout(timer);
      while (waiters.length > 0) {
        const resolve = waiters.shift()!;
        resolve({
          mocks: cfg.mocks,
          settings: cfg.settings,
          late: false,
        });
      }
    },
    wait(): Promise<{ mocks: Mock[]; settings: Settings; late: boolean }> {
      if (isOpen) {
        return Promise.resolve({
          mocks: currentConfig.mocks,
          settings: currentConfig.settings,
          late: false,
        });
      }
      if (isTimedOut) {
        return Promise.resolve({
          mocks: currentConfig.mocks,
          settings: currentConfig.settings,
          late: true,
        });
      }
      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },
  };
}
