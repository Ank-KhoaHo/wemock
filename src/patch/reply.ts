import { errorReply, HANDLER_WAIT_MS, isCodeMock, type HandlerReply, type HandlerRequest } from '../core/handler';
import { isBridgeHandlerResult, PAGE_SOURCE, type PageRunHandler } from '../core/messages';
import type { Mock, RequestFacts } from '../core/types';

// Spec A2. What a matched mock answers: its fixed response, or what its code returns.

export type RunHandler = (mockId: string, request: HandlerRequest) => Promise<HandlerReply>;

export async function resolveReply(
  runHandler: RunHandler | undefined,
  mock: Mock,
  facts: RequestFacts,
): Promise<HandlerReply> {
  if (!isCodeMock(mock)) return { response: mock.response };
  if (!runHandler) return errorReply('Code mocks cannot run here');
  try {
    return await runHandler(mock.id, {
      method: facts.method,
      url: facts.url,
      headers: { ...(facts.headers ?? {}) },
      body: facts.body,
    });
  } catch (err) {
    return errorReply(`wemock could not run the code: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** The page half of the run-handler round trip: page -> bridge -> background -> sandbox. */
export function createRunHandler(win: Window, waitMs: number = HANDLER_WAIT_MS): RunHandler {
  const pending = new Map<string, (r: HandlerReply) => void>();
  let n = 0;
  win.addEventListener('message', (event: MessageEvent) => {
    try {
      if (event.source !== win || !isBridgeHandlerResult(event.data)) return;
      const done = pending.get(event.data.callId);
      if (!done) return;
      pending.delete(event.data.callId);
      done(event.data.reply);
    } catch {
      // never break the page
    }
  });
  return (mockId, request) =>
    new Promise<HandlerReply>((resolve) => {
      const callId = `h${++n}-${Math.random().toString(36).slice(2)}`;
      const timer = setTimeout(() => {
        pending.delete(callId);
        resolve(errorReply(`No answer from wemock in ${waitMs} ms`));
      }, waitMs);
      pending.set(callId, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      const msg: PageRunHandler = { source: PAGE_SOURCE, type: 'run-handler', callId, mockId, request };
      win.postMessage(msg, '*');
    });
}
