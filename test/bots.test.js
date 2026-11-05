import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { BUTTONS, PLAYER } from '../shared/constants.js';
import { createBrain, createDelayLine, startBot } from '../scripts/bots.js';
import { call, nextEvent, startServer } from './helpers.js';

const fighter = (x, y, over = {}) => ({ x, y, aim: 0, cs: { dashCooldown: 0 }, ...over });

test('the delay line waits at least the latency and never reorders under jitter', async () => {
  // Each draw is lower than the last, so without ordering these would come out reversed.
  const draws = [1, 0.5, 0];
  const delay = createDelayLine(20, 40, () => draws.shift());
  const start = Date.now();
  const out = [];
  [1, 2, 3].forEach((n) => delay(() => out.push([n, Date.now() - start])));
  assert.deepEqual(out, []);
  await sleep(90);
  assert.deepEqual(out.map(([n]) => n), [1, 2, 3]);
  assert.ok(out[0][1] >= 20);
});

test('the delay line runs at once when there is nothing to inject', () => {
  let ran = false;
  createDelayLine()(() => { ran = true; });
  assert.equal(ran, true);
});

test('a brain chases the nearest enemy, and jabs with a fresh press once in range', () => {
  const brain = createBrain(() => 1); // no random moves
  const far = brain.next(fighter(0, 0), [fighter(0, 500), fighter(400, 0)]);
  assert.equal(far.aim, 0);
  assert.deepEqual(far.move, { x: 1, y: 0 });
  assert.equal(far.buttons, 0);

  const near = fighter(PLAYER.RADIUS * 2 + 30, 0);
  const presses = [1, 2, 3, 4].map(() => brain.next(fighter(0, 0), [near]).buttons);
  assert.deepEqual(presses.filter((b) => b === BUTTONS.JAB).length, 2);
  assert.notEqual(presses[0], presses[1]);
});

test('a brain with nobody to fight stands still', () => {
  const brain = createBrain(() => 0);
  assert.deepEqual(brain.next(fighter(0, 0), []), { move: { x: 0, y: 0 }, aim: 0, buttons: 0 });
});

test('bots join, spread over the options, fight with latency, and leave when it is decided', async (t) => {
  const { client, rooms, url } = await startServer(t);
  const host = await client();
  const { room } = await call(host, 'room:create', { nickname: 'Host' });
  await call(host, 'option:add', { name: 'Tacos' });
  await call(host, 'option:add', { name: 'Sushi' });

  const bots = ['Bot1', 'Bot2'].map((nickname, index) => startBot({ url, code: room.code, nickname, index, latency: 30, jitter: 10 }));
  const live = rooms.getRoom(room.code);
  const teamsPicked = () => [...live.players.values()].filter((p) => p.teamId !== null).length === 2;
  while (!teamsPicked()) await sleep(5);
  assert.deepEqual((await call(host, 'match:start')), { ok: true });

  // Face to face, one hit from the end.
  const [a, b] = live.match.fighters;
  a.body.x = 300; a.body.y = 300;
  b.body.x = 300 + PLAYER.RADIUS * 2 + 30; b.body.y = 300;
  a.hp = b.hp = 1;

  const results = await new Promise((resolve) => {
    host.on('room:update', (r) => { if (r.state === 'results') resolve(r); });
  });
  const winner = results.result.optionId;
  assert.ok(live.options.some((o) => o.id === winner));
  const outcomes = await Promise.all(bots);
  outcomes.forEach((o) => assert.deepEqual(o, { result: { optionId: winner } }));
  while (live.players.size > 1) await nextEvent(host, 'room:update');
  assert.deepEqual([...live.players.values()].map((p) => p.nickname), ['Host']);
});

test('--team puts every bot on the named option', async (t) => {
  const { client, rooms, url } = await startServer(t);
  const host = await client();
  const { room } = await call(host, 'room:create', { nickname: 'Host' });
  await call(host, 'option:add', { name: 'Tacos' });
  await call(host, 'option:add', { name: 'Sushi' });
  ['Bot1', 'Bot2'].forEach((nickname, index) => startBot({ url, code: room.code, nickname, index, team: 'sushi' }));
  const live = rooms.getRoom(room.code);
  const sushi = live.options.find((o) => o.name === 'Sushi').id;
  const onSushi = () => [...live.players.values()].filter((p) => p.teamId === sushi).length;
  while (onSushi() < 2) await sleep(5);
  assert.equal(onSushi(), 2);
});

test('a bot that cannot get in reports why', async (t) => {
  const { url } = await startServer(t);
  assert.deepEqual(await startBot({ url, code: 'ZZZZ', nickname: 'Bot1' }), { error: 'ROOM_NOT_FOUND' });
});
