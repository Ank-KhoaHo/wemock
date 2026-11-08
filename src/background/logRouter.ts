import { LogBuffer } from '../core/logBuffer';
import type { LogDraft, LogEntry } from '../core/types';
import { newId } from '../shared/ids';

interface PanelPort {
  name: string;
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
  private tabSubscribers = new Map<number, Set<PanelPort>>();
  private portSubscriptions = new Map<PanelPort, number>();

  getBuffer(tabId: number): LogBuffer | undefined {
    return this.buffers.get(tabId);
  }

  handleMessage(message: unknown, sender: { tab?: { id?: number } }): void {
    if (typeof message !== 'object' || message === null) return;
    const msg = message as { type?: unknown; entry?: unknown };
    if (msg.type !== 'log') return;

    const tabId = sender?.tab?.id;
    if (typeof tabId !== 'number') return;

    const draft = msg.entry as LogDraft;
    if (!draft || typeof draft !== 'object') return;

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

    port.onMessage.addListener((message: unknown) => {
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

        let buffer = this.buffers.get(tabId);
        if (!buffer) {
          buffer = new LogBuffer();
          this.buffers.set(tabId, buffer);
        }
        port.postMessage({ type: 'snapshot', entries: buffer.entries() });
      } else if (msg.type === 'clear') {
        const buffer = this.buffers.get(tabId);
        if (buffer) {
          buffer.clear();
        }
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
