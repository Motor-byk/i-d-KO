import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { BUTTONS, PLAYER, ROOM } from '../shared/constants.js';
import { call, fakeMatch, input, nextEvent, startedMatch } from './helpers.js';

// Resolves with the first room:update that passes the check.
async function roomUpdate(socket, check) {
  for (;;) {
    const room = await nextEvent(socket, 'room:update');
    if (check(room)) return room;
  }
}

const isConnected = (room, id) => room.players.find((p) => p.id === id)?.connected;

test('a dropped fighter stands still and can be hit, and a rejoin takes it back', async (t) => {
  const { a, b, client, rooms, code, playerId, token } = await startedMatch(t);
  const { match } = rooms.getRoom(code);
  const dropped = match.byId.get(playerId);
  const [attacker] = match.fighters.filter((f) => f !== dropped);

  a.emit('match:input', input(1, { move: { x: 1, y: 0 } }));
  while (dropped.ackSeq < 1) await sleep(5);
  assert.deepEqual(dropped.move, { x: 1, y: 0 });

  const away = roomUpdate(b, (room) => isConnected(room, playerId) === false);
  a.disconnect();
  await away;
  assert.deepEqual(dropped.move, { x: 0, y: 0 });
  assert.equal(dropped.alive, true);
  await sleep(100); // past the walking slowdown
  const { x } = dropped.body;
  await sleep(100);
  assert.equal(dropped.body.x, x, 'stands still');

  attacker.body.x = dropped.body.x + PLAYER.RADIUS * 2 + 20;
  attacker.body.y = dropped.body.y;
  b.emit('match:input', input(1, { aim: Math.PI, aimed: true, buttons: BUTTONS.JAB }));
  while (dropped.hp === dropped.maxHp) await sleep(5);

  const back = roomUpdate(b, (room) => isConnected(room, playerId) === true);
  const a2 = await client();
  const rejoined = await call(a2, 'room:rejoin', { code, token });
  assert.equal(rejoined.playerId, playerId);
  await back;
  assert.equal(rooms.getRoom(code).players.get(playerId).graceUntil, null);

  // The new client counts seq from scratch, and the fighter answers to it.
  a2.emit('match:input', input(1, { move: { x: -1, y: 0 } }));
  while (dropped.ackSeq !== 1) await sleep(5);
  assert.deepEqual(dropped.move, { x: -1, y: 0 });
});

test('grace running out is a KO that can decide the match, and the seat is gone', async (t) => {
  const { a, b, client, rooms, code, options, token, playerId } = await startedMatch(t);
  let lastAlive = null;
  b.on('match:snapshot', (snap) => { lastAlive = snap.fighters.find((f) => f.id === playerId).alive; });

  a.disconnect();
  await roomUpdate(b, (room) => isConnected(room, playerId) === false);
  assert.ok(rooms.getRoom(code).players.has(playerId), 'keeps the seat during grace');

  const realNow = rooms.now;
  rooms.now = () => realNow() + ROOM.MATCH_GRACE_MS;
  const results = await roomUpdate(b, (room) => room.state === 'results');
  assert.deepEqual(results.result, { optionId: options[1].id });
  assert.equal(lastAlive, false, 'the deciding KO was on screen before the results');

  const a2 = await client();
  assert.equal((await call(a2, 'room:rejoin', { code, token })).error, 'BAD_TOKEN');
});

test('a grace KO leaves the match running while the team has someone left', () => {
  const { match, players, ended } = fakeMatch([2, 1]);
  players.delete(1);
  match.step();
  assert.equal(match.byId.get(1).alive, false);
  assert.equal(match.byId.get(2).alive, true);
  assert.equal(match.result, null);
  assert.deepEqual(ended, []);
});
