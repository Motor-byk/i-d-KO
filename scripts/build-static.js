// Builds the static client for the Render Static Site: public/ + shared/ + socket.io client -> dist/,
// with config.js pointing at the game server.
import { cp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}dist`;
const serverUrl = (process.env.GAME_SERVER_URL || '').replace(/\/+$/, '');

if (!serverUrl) {
  // On Render the client and server are different origins, so a missing URL is a broken deploy.
  if (process.env.RENDER) throw new Error('GAME_SERVER_URL must be set for the static site build.');
  console.warn('GAME_SERVER_URL is not set; the client will use its own origin.');
}

await rm(dist, { recursive: true, force: true });
await cp(`${root}public`, dist, { recursive: true });
await cp(`${root}shared`, `${dist}/shared`, { recursive: true });
await cp(`${root}node_modules/socket.io-client/dist/socket.io.esm.min.js`, `${dist}/vendor/socket.io.esm.min.js`);
await writeFile(`${dist}/config.js`, `window.GAME_SERVER_URL = ${JSON.stringify(serverUrl)};\n`);
console.log(`Built ${dist} (server: ${serverUrl || 'same origin'})`);
