import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
// In production the client is a separate Render Static Site. Locally we serve it ourselves.
const SERVE_STATIC = process.env.NODE_ENV !== 'production';
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// Static mounts for local dev: URL prefix -> directory.
const STATIC_MOUNTS = [
  ['/shared/', join(ROOT, 'shared')],
  ['/', join(ROOT, 'public')],
];

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  for (const [prefix, dir] of STATIC_MOUNTS) {
    if (!url.pathname.startsWith(prefix)) continue;
    let rel = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
    const file = normalize(join(dir, rel));
    if (!file.startsWith(dir + sep)) break;
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
      return true;
    } catch {
      break;
    }
  }
  return false;
}

export function createAppServer() {
  const httpServer = createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': CLIENT_ORIGIN,
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (SERVE_STATIC && req.method === 'GET' && (await serveStatic(req, res))) return;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  const io = new Server(httpServer, {
    transports: ['websocket'],
    perMessageDeflate: false,
    cors: { origin: CLIENT_ORIGIN },
  });

  return { httpServer, io };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { httpServer } = createAppServer();
  httpServer.listen(PORT, () => console.log(`i-d-KO server listening on :${PORT}`));
}
