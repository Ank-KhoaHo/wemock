import { patternFromUrl } from './record';
import { handshakeError, MessageType, parseMessage, splitMessages } from './signalr';
import { toHttpUrl } from './sockets';
import { SOCKET_LOG_CAP, type LogEntry, type SocketMock, type SocketPush, type SocketReply } from './types';

// Spec A6. "Mock this socket": one logged real connection becomes a socket mock.

function httpUrl(url: string): string {
  try {
    return toHttpUrl(new URL(url)).href;
  } catch {
    return url;
  }
}

function isBinaryNote(text: string): boolean {
  return /^\[binary \d+ bytes\]$/.test(text);
}

/** The socket mock for `connectionId`, or null when no real open row is logged for it. */
export function socketFromLogs(
  entries: LogEntry[],
  connectionId: string,
  pageOrigin: string,
  newId: () => string,
  now: number,
): SocketMock | null {
  const rows = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.connectionId === connectionId && e.badge !== 'MOCK')
    .sort((a, b) => a.e.startedAt - b.e.startedAt || a.i - b.i)
    .map(({ e }) => e);
  const open = rows.find((e) => e.method === 'WS' && e.status === 101);
  if (!open) return null;

  const sent = rows.filter((e) => e.method === 'WS ↑' && typeof e.requestBody === 'string');
  const received = rows.filter((e) => e.method === 'WS ↓' && typeof e.responseBody === 'string');
  const firstSent = sent[0]?.requestBody ? splitMessages(sent[0].requestBody)[0] : undefined;
  const kind: SocketMock['kind'] = firstSent !== undefined && handshakeError(firstSent) === null ? 'signalr' : 'plain';

  const onConnect: SocketPush[] = [];
  const replies: SocketReply[] = [];

  if (kind === 'plain') {
    for (const r of received) {
      const text = r.responseBody!;
      if (isBinaryNote(text)) continue;
      onConnect.push({ id: newId(), afterMs: Math.max(0, r.startedAt - open.startedAt), target: '', data: text });
    }
  } else {
    // The timeline starts at the handshake answer, as the fake hub sends it after the handshake.
    const handshake = received.find((r) => splitMessages(r.responseBody!).some((m) => m.trim() === '{}'));
    const t0 = handshake ? handshake.startedAt : open.startedAt;
    const targetOf = new Map<string, string>();
    const streamInvocations = new Set<string>();
    const itemsByInvocationId = new Map<string, unknown[]>();
    const seen = new Set<string>();
    let pendingReply: { reply: SocketReply; completionTime: number } | null = null;
    // A30: server messages that arrive while a client call waits for its answer belong to that call
    // (a real hub's Join sends GroupMsg before Join returns). Held per call, oldest call first.
    type Held = { at: number; target: string; data: string };
    const openCalls = new Map<string, Held[]>();
    const toTimeline = (h: Held) =>
      onConnect.push({ id: newId(), afterMs: Math.max(0, h.at - t0), target: h.target, data: h.data });

    for (const r of rows) {
      if (r.method === 'WS ↑' && typeof r.requestBody === 'string') {
        for (const m of splitMessages(r.requestBody)) {
          const msg = parseMessage(m);
          if (msg?.type !== MessageType.Ping) {
            pendingReply = null;
          }
          if (!msg) continue;
          if (
            (msg.type === MessageType.Invocation || msg.type === MessageType.StreamInvocation) &&
            msg.invocationId !== undefined &&
            msg.target
          ) {
            targetOf.set(msg.invocationId, msg.target);
            openCalls.set(msg.invocationId, []);
            if (msg.type === MessageType.StreamInvocation) {
              streamInvocations.add(msg.invocationId);
            }
          }
        }
      } else if (r.method === 'WS ↓' && typeof r.responseBody === 'string') {
        for (const m of splitMessages(r.responseBody)) {
          const msg = parseMessage(m);
          if (!msg) continue;
          if (msg.type === MessageType.StreamItem && msg.invocationId !== undefined) {
            try {
              const raw = JSON.parse(m) as { item?: unknown };
              let list = itemsByInvocationId.get(msg.invocationId);
              if (!list) {
                list = [];
                itemsByInvocationId.set(msg.invocationId, list);
              }
              list.push(raw.item);
            } catch {
              // ignore invalid json
            }
          } else if (msg.type === MessageType.Completion && msg.invocationId !== undefined) {
            const target = targetOf.get(msg.invocationId);
            const held = openCalls.get(msg.invocationId) ?? [];
            openCalls.delete(msg.invocationId);
            if (!target || seen.has(target)) {
              held.forEach(toTimeline);
              pendingReply = null;
              continue;
            }
            try {
              const raw = JSON.parse(m) as { result?: unknown; error?: unknown };
              seen.add(target);
              const isStream =
                streamInvocations.has(msg.invocationId) ||
                itemsByInvocationId.has(msg.invocationId);
              let respond: SocketReply['respond'] = 'fixed';
              let result = '';
              if (raw.error !== undefined) {
                respond = 'error';
                result = typeof raw.error === 'string' ? raw.error : String(raw.error);
              } else if (isStream) {
                respond = 'stream';
                const items = itemsByInvocationId.get(msg.invocationId) ?? [];
                result = JSON.stringify(items);
              } else {
                respond = 'fixed';
                result = 'result' in raw ? JSON.stringify(raw.result) : '';
              }
              const rep: SocketReply = {
                id: newId(),
                when: target,
                respond,
                result,
                pushes: held.map((h) => ({ id: newId(), afterMs: 0, target: h.target, data: h.data })),
              };
              replies.push(rep);
              pendingReply = { reply: rep, completionTime: r.startedAt };
            } catch {
              pendingReply = null;
            }
          } else if (msg.type === MessageType.Invocation && msg.target) {
            const waiting = [...openCalls.values()].at(-1);
            if (waiting) {
              waiting.push({ at: r.startedAt, target: msg.target, data: JSON.stringify(msg.arguments ?? []) });
            } else if (
              pendingReply !== null &&
              r.startedAt - pendingReply.completionTime <= 1000 &&
              r.startedAt >= pendingReply.completionTime
            ) {
              pendingReply.reply.pushes.push({
                id: newId(),
                afterMs: r.startedAt - pendingReply.completionTime,
                target: msg.target,
                data: JSON.stringify(msg.arguments ?? []),
              });
            } else {
              pendingReply = null;
              onConnect.push({
                id: newId(),
                afterMs: Math.max(0, r.startedAt - t0),
                target: msg.target,
                data: JSON.stringify(msg.arguments ?? []),
              });
            }
          }
        }
      }
    }
    // Calls never answered (or cancelled): their messages stay on the timeline.
    for (const held of openCalls.values()) held.forEach(toTimeline);
    onConnect.sort((a, b) => a.afterMs - b.afterMs);
  }

  return {
    id: newId(),
    enabled: true,
    kind,
    urlPattern: patternFromUrl(httpUrl(open.url), pageOrigin),
    onConnect: onConnect.slice(0, SOCKET_LOG_CAP),
    replies,
    createdAt: now,
  };
}
