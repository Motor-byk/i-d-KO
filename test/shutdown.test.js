import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';
import { call, nextEvent, startServer } from './helpers.js';

const SERVER_FILE = fileURLToPath(new URL('../server/index.js', import.meta.url));

async function freePort() {
  const probe = createServer().listen(0);
  await once(probe, 'listening');
  const { port } = probe.address();
  probe.close();
  await once(probe, 'close');
  return port;
}

test('once shutting down, no new rooms can be created but everyone is warned', async (t) => {
  const { client, announceShutdown } = await startServer(t);
  const a = await client();
  const warned = nextEvent(a, 'server:restarting');
  announceShutdown();
  await warned;
  assert.equal((await call(a, 'room:create', { nickname: 'Ana' })).error, 'SERVER_RESTARTING');
});

test('SIGTERM warns connected clients and exits cleanly', async (t) => {
  const port = await freePort();
  const server = spawn(process.execPath, [SERVER_FILE], {
    env: { ...process.env, PORT: String(port), NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => server.kill('SIGKILL'));
  await once(server.stdout, 'data'); // the listening line

  const socket = connect(`http://localhost:${port}`, { transports: ['websocket'], reconnection: false });
  t.after(() => socket.disconnect());
  await once(socket, 'connect');
  const warned = nextEvent(socket, 'server:restarting');
  const exited = once(server, 'exit');
  server.kill('SIGTERM');
  await warned;
  assert.deepEqual(await exited, [0, null]);
});
