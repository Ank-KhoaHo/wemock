import { bytesToBase64 } from '../../core/bodies';
import type { HandlerInput, WorkerOutcome } from '../../core/handler';
import { WORKER_SOURCE } from '../../sandbox/workerSource';

// Spec A2. A sandboxed page: no extension APIs, an opaque origin, and a CSP that
// allows eval. It lives inside the offscreen document and runs each code mock
// in a fresh Worker, terminated after the time limit.

interface RunMessage {
  kind: 'wemock-run';
  id: string;
  code: string;
  input: HandlerInput;
  timeoutMs: number;
}

function isRunMessage(d: unknown): d is RunMessage {
  if (!d || typeof d !== 'object') return false;
  const m = d as Record<string, unknown>;
  return m.kind === 'wemock-run' && typeof m.id === 'string' && typeof m.code === 'string' && typeof m.timeoutMs === 'number';
}

const workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));

function run(code: string, input: HandlerInput, timeoutMs: number): Promise<WorkerOutcome> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(workerUrl);
    } catch (err) {
      resolve({ ok: false, error: `The sandbox could not start: ${String(err)}` });
      return;
    }
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ ok: false, error: `The code took longer than ${timeoutMs} ms` });
    }, timeoutMs);
    worker.onmessage = (e: MessageEvent) => {
      clearTimeout(timer);
      worker.terminate();
      const out = e.data as { ok?: boolean; kind?: string; value?: unknown };
      if (out && out.ok && out.kind === 'bytes' && out.value instanceof Uint8Array) {
        resolve({ ...(out as WorkerOutcome), value: bytesToBase64(out.value) } as WorkerOutcome);
      } else {
        resolve(out as WorkerOutcome);
      }
    };
    worker.onerror = (e: ErrorEvent) => {
      clearTimeout(timer);
      worker.terminate();
      e.preventDefault();
      resolve({ ok: false, error: e.message || 'The code failed' });
    };
    worker.postMessage({ code, input });
  });
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || !isRunMessage(event.data)) return;
  const { id, code, input, timeoutMs } = event.data;
  void run(code, input, timeoutMs).then((outcome) => {
    window.parent.postMessage({ kind: 'wemock-ran', id, outcome }, '*');
  });
});

window.parent.postMessage({ kind: 'wemock-sandbox-ready' }, '*');
