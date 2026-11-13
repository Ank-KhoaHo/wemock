import { GATE_TIMEOUT_MS, type HeaderRule, type Mock, type Settings, type SocketMock } from '../core/types';

/** What the bridge sends: the page's mocks, socket mocks (A5) and settings. */
export interface GateConfig {
  mocks: Mock[];
  settings: Settings;
  sockets?: SocketMock[];
  headerRules?: HeaderRule[];
}

export type GateResult = GateConfig & { late: boolean };

export interface Gate {
  open(cfg: GateConfig): void;
  wait(): Promise<GateResult>;
  /** A5: the config if the bridge has sent it, else null. A WebSocket constructor cannot wait. */
  current(): GateConfig | null;
}

export function createGate(timeoutMs: number = GATE_TIMEOUT_MS): Gate {
  let isOpen = false;
  let isTimedOut = false;
  let currentConfig: GateConfig = {
    mocks: [],
    settings: { enabled: true, recording: true },
  };

  type Waiter = (res: GateResult) => void;
  const waiters: Waiter[] = [];

  const timer = setTimeout(() => {
    isTimedOut = true;
    while (waiters.length > 0) {
      const resolve = waiters.shift()!;
      resolve({ ...currentConfig, late: true });
    }
  }, timeoutMs);

  if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') {
    timer.unref();
  }

  return {
    open(cfg: GateConfig) {
      isOpen = true;
      isTimedOut = false;
      currentConfig = cfg;
      clearTimeout(timer);
      while (waiters.length > 0) {
        const resolve = waiters.shift()!;
        resolve({ ...cfg, late: false });
      }
    },
    current(): GateConfig | null {
      return isOpen ? currentConfig : null;
    },
    wait(): Promise<GateResult> {
      if (isOpen) {
        return Promise.resolve({ ...currentConfig, late: false });
      }
      if (isTimedOut) {
        return Promise.resolve({ ...currentConfig, late: true });
      }
      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },
  };
}
