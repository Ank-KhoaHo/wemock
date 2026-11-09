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
    for (const s of sent) {
      for (const m of splitMessages(s.requestBody!)) {
        const msg = parseMessage(m);
        if (msg?.type === MessageType.Invocation && msg.invocationId !== undefined && msg.target) {
          targetOf.set(msg.invocationId, msg.target);
        }
      }
    }
    const seen = new Set<string>();
    for (const r of received) {
      for (const m of splitMessages(r.responseBody!)) {
        const msg = parseMessage(m);
        if (!msg) continue;
        if (msg.type === MessageType.Invocation && msg.target) {
          onConnect.push({
            id: newId(),
            afterMs: Math.max(0, r.startedAt - t0),
            target: msg.target,
            data: JSON.stringify(msg.arguments ?? []),
          });
        } else if (msg.type === MessageType.Completion && msg.invocationId !== undefined) {
          const target = targetOf.get(msg.invocationId);
          if (!target || seen.has(target)) continue;
          const raw = JSON.parse(m) as { result?: unknown; error?: unknown };
          if (raw.error !== undefined) continue;
          seen.add(target);
          replies.push({
            id: newId(),
            when: target,
            respond: 'fixed',
            result: 'result' in raw ? JSON.stringify(raw.result) : '',
            pushes: [],
          });
        }
      }
    }
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
