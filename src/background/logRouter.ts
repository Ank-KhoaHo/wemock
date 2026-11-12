import { LogBuffer } from '../core/logBuffer';
import { sanitizeLogDraft } from '../core/logSanitize';
import { LOG_CAP, type LogEntry } from '../core/types';
import { newId } from '../shared/ids';

interface PanelPort {
  name: string;
  sender?: {
    id?: string;
    url?: string;
  };
  postMessage(msg: unknown): void;
  onMessage: {
    addListener(fn: (msg: unknown) => void): void;
  };
  onDisconnect: {
    addListener(fn: () => void): void;
  };
}

export class LogRouter {
  private buffers = new Map<number, LogBuffer>();
  private loads = new Map<number, Promise<void>>();
  private loaded = new Set<number>();
  private saveQueues = new Map<number, Promise<void>>();
  private tabSubscribers = new Map<number, Set<PanelPort>>();
  private portSubscriptions = new Map<PanelPort, number>();

  getBuffer(tabId: number): LogBuffer | undefined {
    return this.buffers.get(tabId);
  }

  /** Loads the tab's stored rows once; every caller waits for the same load. */
  private ensureTabLoaded(tabId: number): Promise<void> {
    let load = this.loads.get(tabId);
    if (!load) {
      load = this.loadTab(tabId);
      this.loads.set(tabId, load);
    }
    return load;
  }

  private async loadTab(tabId: number): Promise<void> {
    try {
      await this.readStored(tabId);
    } finally {
      this.loaded.add(tabId);
    }
  }

  private async readStored(tabId: number): Promise<void> {
    try {
      if (typeof browser !== 'undefined' && browser.storage?.session) {
        const key = `wemock.log.${tabId}`;
        const res = await browser.storage.session.get(key);
        const stored = res?.[key];
        if (Array.isArray(stored)) {
          let buffer = this.buffers.get(tabId);
          if (!buffer) {
            buffer = new LogBuffer();
            this.buffers.set(tabId, buffer);
            for (const item of stored) {
              buffer.push(item as LogEntry);
            }
          } else {
            const existingIds = new Set(buffer.entries().map((e) => e.id));
            const toPrepend = (stored as LogEntry[]).filter((e) => !existingIds.has(e.id));
            if (toPrepend.length > 0) {
              const combined = [...toPrepend, ...buffer.entries()];
              buffer.clear();
              for (const e of combined.slice(-LOG_CAP)) {
                buffer.push(e);
              }
            }
          }
        }
      }
    } catch {}
  }

  private saveBuffer(tabId: number): Promise<void> {
    const run = async () => {
      await this.ensureTabLoaded(tabId);
      const buffer = this.buffers.get(tabId);
      if (!buffer) return;
      const key = `wemock.log.${tabId}`;
      try {
        if (typeof browser !== 'undefined' && browser.storage?.session) {
          await browser.storage.session.set({ [key]: buffer.entries() });
        }
      } catch {}
    };
    const prev = this.saveQueues.get(tabId) ?? Promise.resolve();
    const next = prev.then(run, run);
    this.saveQueues.set(tabId, next.catch(() => {}));
    return next;
  }

  handleMessage(message: unknown, sender: { tab?: { id?: number } }): void {
    if (typeof message !== 'object' || message === null) return;
    const msg = message as { type?: unknown; entry?: unknown };
    if (msg.type !== 'log') return;

    const tabId = sender?.tab?.id;
    if (typeof tabId !== 'number') return;

    const draft = sanitizeLogDraft(msg.entry);
    if (!draft) return;

    const entry: LogEntry = {
      ...draft,
      id: newId(),
    };

    let buffer = this.buffers.get(tabId);
    if (!buffer) {
      buffer = new LogBuffer();
      this.buffers.set(tabId, buffer);
    }
    buffer.push(entry);

    this.saveBuffer(tabId);

    const subscribers = this.tabSubscribers.get(tabId);
    if (subscribers) {
      for (const port of subscribers) {
        try {
          port.postMessage({ type: 'log', entry });
        } catch {
          // Port may have disconnected
        }
      }
    }
  }

  handleConnect(port: PanelPort): void {
    if (port.name !== 'wemock-panel') return;

    const extId = typeof browser !== 'undefined' ? browser.runtime?.id : undefined;
    if (!extId || !port.sender?.url?.startsWith(`chrome-extension://${extId}/`)) {
      return;
    }

    port.onMessage.addListener(async (message: unknown) => {
      if (typeof message !== 'object' || message === null) return;
      const msg = message as { type?: unknown; tabId?: unknown };

      if (typeof msg.tabId !== 'number') return;
      const tabId = msg.tabId;

      if (msg.type === 'subscribe') {
        const prevTabId = this.portSubscriptions.get(port);
        if (prevTabId !== undefined) {
          this.tabSubscribers.get(prevTabId)?.delete(port);
        }

        this.portSubscriptions.set(port, tabId);
        let set = this.tabSubscribers.get(tabId);
        if (!set) {
          set = new Set();
          this.tabSubscribers.set(tabId, set);
        }
        set.add(port);

        // Answer at once when the stored rows are in; otherwise wait for them.
        if (!this.loaded.has(tabId)) await this.ensureTabLoaded(tabId);
        let buffer = this.buffers.get(tabId);
        if (!buffer) {
          buffer = new LogBuffer();
          this.buffers.set(tabId, buffer);
        }
        port.postMessage({ type: 'snapshot', entries: buffer.entries() });
      } else if (msg.type === 'clear') {
        this.loads.set(tabId, Promise.resolve());
        this.loaded.add(tabId);
        const buffer = this.buffers.get(tabId);
        if (buffer) {
          buffer.clear();
        }
        const key = `wemock.log.${tabId}`;
        try {
          if (typeof browser !== 'undefined' && browser.storage?.session) {
            browser.storage.session.remove(key).catch(() => {});
          }
        } catch {}
        const subscribers = this.tabSubscribers.get(tabId);
        if (subscribers) {
          for (const p of subscribers) {
            try {
              p.postMessage({ type: 'snapshot', entries: [] });
            } catch {}
          }
        }
      }
    });

    port.onDisconnect.addListener(() => {
      const tabId = this.portSubscriptions.get(port);
      if (tabId !== undefined) {
        this.tabSubscribers.get(tabId)?.delete(port);
        this.portSubscriptions.delete(port);
      }
    });
  }

  handleTabRemoved(tabId: number): void {
    this.buffers.delete(tabId);
    this.loads.delete(tabId);
    this.loaded.delete(tabId);
    const key = `wemock.log.${tabId}`;
    try {
      if (typeof browser !== 'undefined' && browser.storage?.session) {
        browser.storage.session.remove(key).catch(() => {});
      }
    } catch {}
  }
}

export function initLogRouter(): LogRouter {
  const router = new LogRouter();

  if (typeof browser !== 'undefined') {
    if (browser.runtime?.onMessage?.addListener) {
      browser.runtime.onMessage.addListener((message, sender) => {
        router.handleMessage(message, sender);
      });
    }

    if (browser.runtime?.onConnect?.addListener) {
      browser.runtime.onConnect.addListener((port) => {
        router.handleConnect(port as unknown as PanelPort);
      });
    }

    if (browser.tabs?.onRemoved?.addListener) {
      browser.tabs.onRemoved.addListener((tabId) => {
        router.handleTabRemoved(tabId);
      });
    }
  }

  return router;
}
