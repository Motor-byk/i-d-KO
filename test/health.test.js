import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server/index.js';

test('GET /health returns ok', async (t) => {
  const { httpServer, io } = createAppServer();
  await new Promise((r) => httpServer.listen(0, r));
  t.after(() => io.close());
  const { port } = httpServer.address();
  const res = await fetch(`http://localhost:${port}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});
