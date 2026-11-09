// Spec A5. SignalR's JSON hub protocol, as far as wemock's fake server needs it.
// Every message is JSON followed by the record separator 0x1E.

export const RS = '\u001e';
export const PING_INTERVAL_MS = 15000;

export const MessageType = {
  Invocation: 1,
  StreamItem: 2,
  Completion: 3,
  StreamInvocation: 4,
  CancelInvocation: 5,
  Ping: 6,
  Close: 7,
} as const;

/** Splits a text frame into its JSON messages (the trailing empty part is dropped). */
export function splitMessages(text: string): string[] {
  return text.split(RS).filter((s) => s.length > 0);
}

export function frame(message: unknown): string {
  return JSON.stringify(message) + RS;
}

/** The arguments array from the data the user typed. Not an array: one argument. Bad JSON: the text. */
export function parseArguments(data: string): unknown[] {
  if (data.trim() === '') return [];
  try {
    const v: unknown = JSON.parse(data);
    return Array.isArray(v) ? v : [v];
  } catch {
    return [data];
  }
}

/** A completion result from the text the user typed: '' = none, bad JSON = the text. */
export function parseResult(result: string): { has: boolean; value?: unknown } {
  if (result.trim() === '') return { has: false };
  try {
    return { has: true, value: JSON.parse(result) };
  } catch {
    return { has: true, value: result };
  }
}

export function invocationMessage(target: string, args: unknown[]): string {
  return frame({ type: MessageType.Invocation, target, arguments: args });
}

export function completionMessage(invocationId: string, result: { has: boolean; value?: unknown }, error?: string): string {
  if (error !== undefined) return frame({ type: MessageType.Completion, invocationId, error });
  return result.has
    ? frame({ type: MessageType.Completion, invocationId, result: result.value })
    : frame({ type: MessageType.Completion, invocationId });
}

export const PING_MESSAGE = frame({ type: MessageType.Ping });
export const HANDSHAKE_OK = frame({});

/** The handshake request: `{"protocol":"json","version":1}`. Returns the error text, or null when fine. */
export function handshakeError(message: string): string | null {
  try {
    const v = JSON.parse(message) as { protocol?: unknown };
    if (v.protocol === 'json') return null;
    return `wemock mocks only the JSON hub protocol, not '${String(v.protocol)}'`;
  } catch {
    return 'The handshake is not valid JSON';
  }
}

/** The negotiate answer: only the WebSockets transport, so the client always picks it. */
export function negotiateBody(connectionId: string): string {
  return JSON.stringify({
    negotiateVersion: 1,
    connectionId,
    connectionToken: connectionId,
    availableTransports: [{ transport: 'WebSockets', transferFormats: ['Text', 'Binary'] }],
  });
}

export interface ParsedMessage {
  type: number;
  invocationId?: string;
  target?: string;
  arguments?: unknown[];
}

export function parseMessage(message: string): ParsedMessage | null {
  try {
    const v = JSON.parse(message) as Record<string, unknown>;
    if (!v || typeof v !== 'object' || typeof v.type !== 'number') return null;
    return {
      type: v.type,
      invocationId: typeof v.invocationId === 'string' ? v.invocationId : undefined,
      target: typeof v.target === 'string' ? v.target : undefined,
      arguments: Array.isArray(v.arguments) ? v.arguments : undefined,
    };
  } catch {
    return null;
  }
}

/** A6: a logged frame without its ping messages ('' when only pings). Non-SignalR text is kept. */
export function withoutPings(text: string): string {
  if (!text.includes(RS)) return text;
  const kept = splitMessages(text).filter((m) => parseMessage(m)?.type !== MessageType.Ping);
  return kept.length === 0 ? '' : kept.join(RS) + RS;
}
