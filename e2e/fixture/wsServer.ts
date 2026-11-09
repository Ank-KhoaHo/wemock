import { createHash } from 'node:crypto';
import type http from 'node:http';
import type { Duplex } from 'node:stream';

// A6: a minimal real WebSocket server for the fixture, so tests can record real traffic.
// /ws/real   plain: sends "tick 1" after 50 ms; answers a text frame "x" with "echo:x".
// /hubs/real SignalR JSON hub: handshake, a "Receive" push after 100 ms, and invocations
//            answered with { n: first argument * 2 }.

const RS = '\u001e';
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function sendText(socket: Duplex, text: string): void {
  const payload = Buffer.from(text, 'utf8');
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

/** Reads complete client frames (always masked) from the buffer; returns text frames and the rest. */
function readFrames(buf: Buffer): { texts: string[]; close: boolean; rest: Buffer } {
  const texts: string[] = [];
  let close = false;
  let offset = 0;
  while (buf.length - offset >= 2) {
    const opcode = buf[offset]! & 0x0f;
    let len = buf[offset + 1]! & 0x7f;
    let pos = offset + 2;
    if (len === 126) {
      if (buf.length < pos + 2) break;
      len = buf.readUInt16BE(pos);
      pos += 2;
    } else if (len === 127) {
      if (buf.length < pos + 8) break;
      len = Number(buf.readBigUInt64BE(pos));
      pos += 8;
    }
    if (buf.length < pos + 4 + len) break;
    const mask = buf.subarray(pos, pos + 4);
    const data = Buffer.alloc(len);
    for (let i = 0; i < len; i++) data[i] = buf[pos + 4 + i]! ^ mask[i % 4]!;
    if (opcode === 0x1) texts.push(data.toString('utf8'));
    if (opcode === 0x8) close = true;
    offset = pos + 4 + len;
  }
  return { texts, close, rest: buf.subarray(offset) };
}

export function attachWsServer(server: http.Server, sockets: Set<Duplex>): void {
  server.on('upgrade', (req: http.IncomingMessage, socket: Duplex) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const key = req.headers['sec-websocket-key'];
    if ((path !== '/ws/real' && path !== '/hubs/real') || typeof key !== 'string') {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );

    const timers: NodeJS.Timeout[] = [];
    socket.on('close', () => timers.forEach(clearTimeout));
    let pending: Buffer = Buffer.alloc(0);
    let handshaken = false;

    if (path === '/ws/real') timers.push(setTimeout(() => sendText(socket, 'tick 1'), 50));

    socket.on('data', (chunk: Buffer) => {
      const { texts, close, rest } = readFrames(Buffer.concat([pending, chunk]));
      pending = rest;
      for (const text of texts) {
        if (path === '/ws/real') {
          sendText(socket, `echo:${text}`);
          continue;
        }
        for (const m of text.split(RS).filter(Boolean)) {
          if (!handshaken) {
            handshaken = true;
            sendText(socket, `{}${RS}`);
            timers.push(setTimeout(() => sendText(socket, `{"type":1,"target":"Receive","arguments":["srv","hello"]}${RS}`), 100));
            continue;
          }
          const msg = JSON.parse(m) as { type: number; invocationId?: string; arguments?: unknown[] };
          if (msg.type === 1 && msg.invocationId !== undefined) {
            const n = Number(msg.arguments?.[0] ?? 0) * 2;
            sendText(socket, `{"type":3,"invocationId":"${msg.invocationId}","result":{"n":${n}}}${RS}`);
          }
        }
      }
      if (close) socket.end(Buffer.from([0x88, 0x00]));
    });
  });
}
