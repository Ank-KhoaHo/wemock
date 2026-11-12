import type { HandlerInput, WorkerOutcome } from '../../core/handler';
import { OFFSCREEN_TARGET } from '../../core/messages';

// Spec A2. The offscreen document only relays: background <-> sandbox iframe.

// The frame is made here, after the listener, so its 'ready' message is never missed.
const frame = document.createElement('iframe');
const pending = new Map<string, (o: WorkerOutcome) => void>();
let next = 0;

const ready = new Promise<void>((resolve) => {
  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow) return;
    const d = event.data as { kind?: string; id?: string; outcome?: WorkerOutcome };
    if (d?.kind === 'wemock-sandbox-ready') {
      resolve();
    } else if (d?.kind === 'wemock-ran' && typeof d.id === 'string') {
      pending.get(d.id)?.(d.outcome as WorkerOutcome);
      pending.delete(d.id);
    }
  });
  frame.title = 'wemock sandbox';
  frame.src = browser.runtime.getURL('/sandbox.html');
  document.body.append(frame);
});

async function runInSandbox(code: string, input: HandlerInput, timeoutMs: number): Promise<WorkerOutcome> {
  await ready;
  const id = `r${++next}`;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    // The sandbox origin is opaque, so '*' is the only target that reaches it.
    frame.contentWindow?.postMessage({ kind: 'wemock-run', id, code, input, timeoutMs }, '*');
  });
}

browser.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
  if (sender?.id !== browser.runtime.id) return undefined;
  const m = msg as { target?: string; code?: unknown; input?: HandlerInput; timeoutMs?: unknown };
  if (m?.target !== OFFSCREEN_TARGET || typeof m.code !== 'string' || !m.input || typeof m.timeoutMs !== 'number') {
    return undefined;
  }
  runInSandbox(m.code, m.input, m.timeoutMs).then(sendResponse, (err) =>
    sendResponse({ ok: false, error: String(err) } satisfies WorkerOutcome),
  );
  return true;
});
