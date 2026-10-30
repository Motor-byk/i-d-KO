import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, call, nextEvent } from './helpers.js';
import { createRateLimiter } from '../server/socket.js';

test('create and join over sockets broadcast room updates', async (t) => {
  const { client } = await startServer(t);
  const a = await client();
  const created = await call(a, 'room:create', { nickname: 'Ana' });
  assert.ok(created.token);
  assert.equal(created.room.players.length, 1);

  const b = await client();
  const update = nextEvent(a, 'room:update');
  const joined = await call(b, 'room:join', { code: created.room.code, nickname: 'Ben' });
  assert.equal(joined.room.players.length, 2);
  assert.equal((await update).players.length, 2);
  assert.ok(!('token' in joined.room.players[0]), 'tokens must never be broadcast');
});

test('cannot join twice from one socket; bad payloads get errors not crashes', async (t) => {
  const { client } = await startServer(t);
  const a = await client();
  await call(a, 'room:create', { nickname: 'Ana' });
  assert.equal((await call(a, 'room:create', { nickname: 'Ana' })).error, 'ALREADY_IN_ROOM');
  const b = await client();
  assert.equal((await call(b, 'room:join', null)).error, 'ROOM_NOT_FOUND');
});

test('rate limiter allows limit per window', () => {
  let t = 0;
  const allow = createRateLimiter(2, 1000, () => t);
  assert.equal(allow('ip'), true);
  assert.equal(allow('ip'), true);
  assert.equal(allow('ip'), false);
  t = 1000;
  assert.equal(allow('ip'), true);
});
