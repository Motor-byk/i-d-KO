// Served from our own origin (copied from node_modules at build) so it always matches the server version.
import { io } from '../vendor/socket.io.esm.min.js';
import { NET } from '../shared/constants.js';

const SERVER = window.GAME_SERVER_URL || window.location.origin;
const SESSION_KEY = 'idko-session';
const WAKE_GIVE_UP_MS = 90_000;

// Opens and closes a bare websocket: the server is awake if the handshake completes.
// Not a fetch of /health: on Render, Chrome gets a 503 on cross-origin HTTP to the server
// while websockets go through, and websockets are all the game needs.
function serverAwake() {
  return new Promise((resolve) => {
    const url = `${SERVER.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      resolve(false);
      return;
    }
    const done = (ok) => {
      clearTimeout(timer);
      ws.onopen = ws.onerror = null;
      ws.close();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), 10_000);
    ws.onopen = () => done(true);
    ws.onerror = () => done(false);
  });
}

// Render free instances sleep; probe until the server answers. onAttempt(n) drives the UI.
// Resolves false after ~90s so a misconfigured URL doesn't look like an endless nap.
export async function wakeServer(onAttempt) {
  const deadline = Date.now() + WAKE_GIVE_UP_MS;
  for (let attempt = 1; Date.now() < deadline; attempt++) {
    onAttempt(attempt);
    if (await serverAwake()) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

// Keeps the instance from idling out while a tab is open; Render's own health checks don't count.
export function keepAwake() {
  setInterval(serverAwake, NET.HEALTH_PING_MS);
}

export function connect() {
  return io(SERVER, { transports: ['websocket'] });
}

// Never buffer while offline: socket.io would replay the emit after reconnecting,
// before our rejoin, and the server would act on a request the UI already gave up on.
export const call = (socket, event, payload = {}) => {
  if (!socket.connected) return Promise.resolve({ error: 'OFFLINE' });
  return new Promise((resolve) => socket.timeout(8000).emit(event, payload, (err, res) => {
    resolve(err ? { error: 'TIMEOUT' } : res);
  }));
};

export const session = {
  load() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY));
    } catch {
      return null;
    }
  },
  save(code, token) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code, token }));
    } catch { /* private mode: rejoin just won't survive a reload */ }
  },
  clear() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch { /* ignore */ }
  },
};
