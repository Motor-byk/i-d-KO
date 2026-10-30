// Builds the static client for the Render Static Site: public/ + shared/ -> dist/,
// with config.js pointing at the game server.
import { cp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}dist`;
const serverUrl = (process.env.GAME_SERVER_URL || '').replace(/\/+$/, '');

if (!serverUrl) console.warn('GAME_SERVER_URL is not set; the client will use its own origin.');

await rm(dist, { recursive: true, force: true });
await cp(`${root}public`, dist, { recursive: true });
await cp(`${root}shared`, `${dist}/shared`, { recursive: true });
await writeFile(`${dist}/config.js`, `window.GAME_SERVER_URL = ${JSON.stringify(serverUrl)};\n`);
console.log(`Built ${dist} (server: ${serverUrl || 'same origin'})`);
