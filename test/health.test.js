import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

test('GET /health returns ok', async (t) => {
  const { url } = await startServer(t);
  const res = await fetch(`${url}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('malformed URLs and traversal get 404 without crashing', async (t) => {
  const { url } = await startServer(t);
  assert.equal((await fetch(`${url}/%E0%A4%A`)).status, 404);
  assert.equal((await fetch(`${url}/..%2f..%2fpackage.json`)).status, 404);
  assert.equal((await fetch(`${url}/health`)).status, 200);
});
