import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { RoomManager } from './rooms.js';
import { attachSocketHandlers } from './socket.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
// In production the client is a separate Render Static Site. Locally we serve it ourselves.
const SERVE_STATIC = process.env.NODE_ENV !== 'production';
const CLIENT_ORIGIN = (process.env.CLIENT_ORIGIN || '*').replace(/\/+$/, '');

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
  ['/vendor/', join(ROOT, 'node_modules', 'socket.io-client', 'dist')],
  ['/', join(ROOT, 'public')],
];

async function serveStatic(req, res) {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    const [prefix, dir] = STATIC_MOUNTS.find(([p]) => pathname.startsWith(p));
    const file = normalize(join(dir, decodeURIComponent(pathname.slice(prefix.length)) || 'index.html'));
    if (!file.startsWith(dir + sep)) return false;
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
    return true;
  } catch {
    // Missing file or malformed URL (bad percent-encoding): fall through to 404.
    return false;
  }
}

export function createAppServer({ clientOrigin = CLIENT_ORIGIN } = {}) {
  const httpServer = createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': clientOrigin,
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
    maxHttpBufferSize: 8 * 1024,
    // Detect dead mobile connections well inside the 20s match grace (default is ~45s).
    pingInterval: 10_000,
    pingTimeout: 5_000,
    cors: { origin: clientOrigin },
    // CORS doesn't apply to websocket upgrades, so check the Origin header ourselves.
    allowRequest: (req, cb) => cb(null, clientOrigin === '*' || req.headers.origin === clientOrigin),
  });
  const rooms = new RoomManager();
  attachSocketHandlers(io, rooms);

  return { httpServer, io, rooms };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!SERVE_STATIC && CLIENT_ORIGIN === '*') {
    console.error('CLIENT_ORIGIN must be set in production (the static site URL).');
    process.exit(1);
  }
  const { httpServer } = createAppServer();
  httpServer.listen(PORT, () => console.log(`i-d-KO server listening on :${PORT}`));
}
