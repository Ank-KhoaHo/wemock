import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEntry, WemockState } from '../core/types';
import { loadState, onStateChange, updateState } from '../shared/store';

export function useWemockState(): {
  state: WemockState | null;
  update: (fn: (s: WemockState) => WemockState) => Promise<void>;
} {
  const [state, setState] = useState<WemockState | null>(null);

  useEffect(() => {
    let mounted = true;
    loadState()
      .then((s) => {
        if (mounted) setState(s);
      })
      .catch(() => {});

    const unsubscribe = onStateChange((s) => {
      if (mounted) setState(s);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const update = useCallback(async (fn: (s: WemockState) => WemockState) => {
    const next = await updateState(fn);
    setState(next);
  }, []);

  return { state, update };
}

interface RuntimePort {
  name: string;
  postMessage: (msg: unknown) => void;
  disconnect: () => void;
  onMessage: {
    addListener: (fn: (msg: unknown) => void) => void;
    removeListener?: (fn: (msg: unknown) => void) => void;
  };
  onDisconnect: {
    addListener: (fn: () => void) => void;
    removeListener?: (fn: () => void) => void;
  };
}

export function useTabLog(tabId: number): {
  entries: LogEntry[];
  clear: () => void;
} {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const portRef = useRef<RuntimePort | null>(null);

  useEffect(() => {
    if (typeof tabId !== 'number' || tabId <= 0) {
      return;
    }

    let mounted = true;
    let hasReconnected = false;
    let activePort: RuntimePort | null = null;

    function connect() {
      if (!mounted) return;
      try {
        // browser.runtime.connect returns a RuntimePort
        const port = browser.runtime.connect({ name: 'wemock-panel' }) as unknown as RuntimePort;
        activePort = port;
        portRef.current = port;

        port.onMessage.addListener((msg: unknown) => {
          if (!mounted || !msg || typeof msg !== 'object') return;
          const m = msg as { type?: unknown; entries?: LogEntry[]; entry?: LogEntry };
          if (m.type === 'snapshot' && Array.isArray(m.entries)) {
            setEntries(m.entries);
          } else if (m.type === 'log' && m.entry) {
            setEntries((prev) => [...prev, m.entry!]);
          }
        });

        port.onDisconnect.addListener(() => {
          if (!mounted) return;
          portRef.current = null;
          if (!hasReconnected) {
            hasReconnected = true;
            connect();
          }
        });

        port.postMessage({ type: 'subscribe', tabId });
      } catch {
        // Ignore connection errors if background is unavailable
      }
    }

    connect();

    return () => {
      mounted = false;
      if (activePort) {
        try {
          activePort.disconnect();
        } catch {
          // ignore
        }
      }
      portRef.current = null;
    };
  }, [tabId]);

  const clear = useCallback(() => {
    if (typeof tabId === 'number' && tabId > 0 && portRef.current) {
      try {
        portRef.current.postMessage({ type: 'clear', tabId });
      } catch {
        // ignore
      }
    }
    setEntries([]);
  }, [tabId]);

  return { entries, clear };
}
