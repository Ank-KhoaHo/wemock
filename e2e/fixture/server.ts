import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { attachWsServer } from './wsServer';

export interface FixtureServer {
  server: http.Server;
  port: number;
  origin: string;
  url: string;
  close(): Promise<void>;
}

export function startFixtureServer(host = '127.0.0.1', port = 0): Promise<FixtureServer> {
  const indexHtml = fs.readFileSync(new URL('index.html', import.meta.url), 'utf-8');
  const earlyHtml = fs.readFileSync(new URL('early.html', import.meta.url), 'utf-8');

  let axiosJs = '';
  try {
    const axiosPath = path.resolve('node_modules/axios/dist/axios.min.js');
    if (fs.existsSync(axiosPath)) {
      axiosJs = fs.readFileSync(axiosPath, 'utf-8');
    }
  } catch {
    // axios optional for Task 5
  }

  // 10 KB PNG buffer
  const logoPng = Buffer.alloc(10 * 1024);
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  pngHeader.copy(logoPng);

  // 2 MB octet-stream buffer
  const bigBin = Buffer.alloc(2 * 1024 * 1024, 0x42);

  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    const pathname = parsedUrl.pathname;

    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(indexHtml);
      return;
    }

    // A2: a page whose CSP blocks eval, like many real sites. Code mocks must still run.
    if (req.method === 'GET' && pathname === '/strict.html') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'",
      });
      res.end(
        indexHtml.replace(
          '</body>',
          "<script>window.evalBlocked = (() => { try { new Function('return 1')(); return false; } catch { return true; } })();</script></body>",
        ),
      );
      return;
    }

    if (req.method === 'GET' && pathname === '/early.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(earlyHtml);
      return;
    }

    // A5: the real SignalR browser client, to test the fake hub against it.
    if (req.method === 'GET' && pathname === '/signalr.js') {
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
      res.end(fs.readFileSync(path.resolve('node_modules/@microsoft/signalr/dist/browser/signalr.min.js'), 'utf-8'));
      return;
    }

    if (req.method === 'GET' && (pathname === '/axios.js' || pathname === '/axios.min.js')) {
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
      res.end(axiosJs);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/goals') {
      // CORS open, so a page on 127.0.0.1 can call it as localhost: another origin (A7).
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ source: 'server' }));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/echo') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const contentType = req.headers['content-type'] ?? 'application/json';
        res.writeHead(200, { 'content-type': contentType });
        res.end(body);
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/logo.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(logoPng);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/big.bin') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(bigBin);
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  });

  const wsSockets = new Set<Duplex>();
  attachWsServer(server, wsSockets);

  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to obtain server address'));
        return;
      }
      const port = addr.port;
      const origin = `http://${host}:${port}`;
      resolve({
        server,
        port,
        origin,
        url: origin,
        close() {
          return new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
            // Keep-alive sockets would hold close() open until they time out.
            server.closeAllConnections();
            // Upgraded WebSocket connections are not in closeAllConnections().
            for (const s of wsSockets) s.destroy();
          });
        },
      });
    });
  });
}
