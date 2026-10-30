import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, call, nextEvent } from './helpers.js';
import { createRateLimiter, clientIp } from '../server/socket.js';

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

test('lobby actions broadcast and reject non-members', async (t) => {
  const { client } = await startServer(t);
  const a = await client();
  const { room } = await call(a, 'room:create', { nickname: 'Ana' });
  const update = nextEvent(a, 'room:update');
  assert.deepEqual(await call(a, 'option:add', { name: 'Tacos' }), { ok: true });
  assert.equal((await update).options[0].name, 'Tacos');
  const stranger = await client();
  assert.equal((await call(stranger, 'option:add', { name: 'x' })).error, 'ROOM_NOT_FOUND');
});

test('disconnect then rejoin with token restores the seat', async (t) => {
  const { client } = await startServer(t);
  const a = await client();
  const created = await call(a, 'room:create', { nickname: 'Ana' });
  a.disconnect();
  const a2 = await client();
  const back = await call(a2, 'room:rejoin', { code: created.room.code, token: created.token });
  assert.equal(back.playerId, created.playerId);
  assert.equal(back.room.players[0].connected, true);
});

test('rejoining from a second socket kicks the first', async (t) => {
  const { client } = await startServer(t);
  const a = await client();
  const created = await call(a, 'room:create', { nickname: 'Ana' });
  const kicked = nextEvent(a, 'room:kicked');
  const a2 = await client();
  await call(a2, 'room:rejoin', { code: created.room.code, token: created.token });
  assert.equal((await kicked).reason, 'REJOINED_ELSEWHERE');
  // The kicked socket's disconnect must not mark the player disconnected.
  await new Promise((r) => setTimeout(r, 30));
  const update = nextEvent(a2, 'room:update');
  await call(a2, 'option:add', { name: 'x' });
  assert.equal((await update).players[0].connected, true);
});

test('clientIp prefers the proxy-set header over client-controlled X-Forwarded-For', () => {
  const hs = (headers) => ({ headers, address: '10.0.0.1' });
  assert.equal(clientIp(hs({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '6.6.6.6' })), '1.2.3.4');
  assert.equal(clientIp(hs({ 'x-forwarded-for': '5.5.5.5, 9.9.9.9' })), '5.5.5.5');
  assert.equal(clientIp(hs({})), '10.0.0.1');
});

test('websocket connections from other origins are refused', async (t) => {
  const { client } = await startServer(t, { clientOrigin: 'https://good.example' });
  await assert.rejects(client({ extraHeaders: { origin: 'https://evil.example' } }));
  assert.ok(await client({ extraHeaders: { origin: 'https://good.example' } }));
});

test('lobby event flood gets rate limited', async (t) => {
  const { client } = await startServer(t);
  const a = await client();
  await call(a, 'room:create', { nickname: 'Ana' });
  const results = await Promise.all(Array.from({ length: 30 }, (_, i) => call(a, 'option:add', { name: `o${i}` })));
  assert.ok(results.some((r) => r.error === 'RATE_LIMITED'));
});
