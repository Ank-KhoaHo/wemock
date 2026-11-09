import { buildInput, errorReply, HANDLER_TIMEOUT_MS, isCodeMock, toReply, type HandlerReply, type HandlerRequest, type WorkerOutcome } from '../core/handler';
import { OFFSCREEN_TARGET, RUN_HANDLER } from '../core/messages';
import { projectForOrigin } from '../core/scenario';
import { normalizePattern } from '../core/sockets';
import type { Mock, WemockState } from '../core/types';

// Spec A2. Runs a code mock for a page (via the bridge) or for the panel's Test bar.
// The code always comes from storage, looked up by mock id inside the sender's own
// project; a message never carries code to run.

export { RUN_HANDLER };

export interface RunHandlerMessage {
  type: typeof RUN_HANDLER;
  mockId: string;
  request: HandlerRequest;
  /** Only honoured from extension pages (the panel), never from a tab. */
  projectId?: string;
}

export interface SenderFacts {
  id?: string;
  url?: string;
  origin?: string;
  tab?: unknown;
}

export interface RunnerIo {
  extensionId: string;
  loadState(): Promise<WemockState>;
  /** Sends to the offscreen document, creating it first if needed. */
  runInOffscreen(msg: { target: string; code: string; input: unknown; timeoutMs: number }): Promise<WorkerOutcome>;
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string');
}

export function isRunHandlerMessage(m: unknown): m is RunHandlerMessage {
  if (!m || typeof m !== 'object') return false;
  const o = m as Record<string, unknown>;
  if (o.type !== RUN_HANDLER || typeof o.mockId !== 'string') return false;
  if (o.projectId !== undefined && typeof o.projectId !== 'string') return false;
  const r = o.request as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') return false;
  if (typeof r.method !== 'string' || typeof r.url !== 'string' || !isStringRecord(r.headers)) return false;
  if (r.body !== undefined && typeof r.body !== 'string') return false;
  return true;
}

function senderOrigin(sender: SenderFacts): string | null {
  if (sender.origin) return sender.origin;
  try {
    return sender.url ? new URL(sender.url).origin : null;
  } catch {
    return null;
  }
}

/** The code mock this sender may run, or null. */
export function findCodeMock(state: WemockState, sender: SenderFacts, msg: RunHandlerMessage, extensionId: string): Mock | null {
  if (sender.id !== extensionId) return null;
  let project;
  if (sender.url?.startsWith(`chrome-extension://${extensionId}/`)) {
    // Our own page (the panel, even when opened in a tab) names its project.
    project = msg.projectId ? (state.projects.find((p) => p.id === msg.projectId) ?? null) : null;
  } else if (sender.tab) {
    // A content script: only the project of the page it runs in.
    const origin = senderOrigin(sender);
    project = origin ? projectForOrigin(state, origin) : null;
  }
  if (!project) return null;
  for (const s of project.scenarios) {
    const m = s.mocks.find((x) => x.id === msg.mockId);
    if (m) return isCodeMock(m) ? m : null;
    // A5: a socket reply rule with code runs the same way, as a mock-shaped stand-in.
    for (const socket of s.sockets ?? []) {
      const rule = socket.replies.find((r) => r.id === msg.mockId);
      if (rule) {
        if (rule.respond !== 'code') return null;
        return {
          id: rule.id,
          enabled: true,
          method: 'ANY',
          urlPattern: normalizePattern(socket.urlPattern),
          reply: 'code',
          code: rule.code ?? '',
          response: { status: 200, headers: {}, body: '', bodyEncoding: 'text', delayMs: 0 },
          source: 'manual',
          createdAt: socket.createdAt,
        };
      }
    }
  }
  return null;
}

export async function runHandler(msg: RunHandlerMessage, sender: SenderFacts, io: RunnerIo): Promise<HandlerReply> {
  try {
    const state = await io.loadState();
    const mock = findCodeMock(state, sender, msg, io.extensionId);
    if (!mock) return errorReply('This code mock was not found in the project for this page');
    const input = buildInput(mock, msg.request);
    const outcome = await io.runInOffscreen({
      target: OFFSCREEN_TARGET,
      code: mock.code ?? '',
      input,
      timeoutMs: HANDLER_TIMEOUT_MS,
    });
    return toReply(outcome);
  } catch (err) {
    return errorReply(`wemock could not run the code: ${err instanceof Error ? err.message : String(err)}`);
  }
}

let creating: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  const contexts = await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as Browser.runtime.ContextType] });
  if (contexts.length > 0) return;
  creating ??= browser.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: ['IFRAME_SCRIPTING' as Browser.offscreen.Reason],
      justification: 'Runs the mock handler code the user wrote, inside a sandboxed iframe.',
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

export function initHandlerRunner(loadState: () => Promise<WemockState>): void {
  const io: RunnerIo = {
    extensionId: browser.runtime.id,
    loadState,
    async runInOffscreen(msg) {
      await ensureOffscreen();
      return (await browser.runtime.sendMessage(msg)) as WorkerOutcome;
    },
  };
  browser.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    if (!isRunHandlerMessage(msg)) return undefined;
    runHandler(msg, sender as SenderFacts, io).then(sendResponse);
    return true;
  });
}
