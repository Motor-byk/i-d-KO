import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, validateInput, spawnPoints } from '../server/game/match.js';
import { ARENA, PLAYER, BUTTONS, NET, TICK_RATE, SNAPSHOT_RATE } from '../shared/constants.js';
import { startServer, call, nextEvent } from './helpers.js';

const input = (seq, over = {}) => ({ seq, tick: 0, move: { x: 0, y: 0 }, aim: 0, buttons: 0, ...over });

function fakeMatch(teamSizes = [1, 1]) {
  const players = new Map();
  let id = 1;
  const options = teamSizes.map((size, i) => {
    for (let k = 0; k < size; k++, id++) players.set(id, { id, teamId: i + 1 });
    return { id: i + 1 };
  });
  const sent = [];
  let empty = 0;
  const match = new Match({
    room: { players, options },
    emit: (event, payload) => sent.push([event, payload]),
    onEmpty: () => empty++,
  });
  return { match, players, sent, emptyCalls: () => empty };
}

test('validateInput rejects malformed input and normalizes the rest', () => {
  assert.ok(validateInput(input(1)));
  for (const bad of [
    null, 'x', input(-1), input(1.5), input(1, { tick: NaN }),
    input(1, { move: { x: NaN, y: 0 } }), input(1, { move: { x: 1, y: 1 } }), input(1, { move: null }),
    input(1, { aim: Infinity }), input(1, { buttons: 16 }), input(1, { buttons: -1 }), input(1, { buttons: 1.5 }),
  ]) {
    assert.equal(validateInput(bad), null, JSON.stringify(bad));
  }
  const v = validateInput(input(1, { move: { x: 1.0005, y: 0 }, aim: 3 * Math.PI }));
  assert.equal(v.move.x, 1, 'tiny float overshoot is clamped');
  assert.ok(Math.abs(Math.abs(v.aim) - Math.PI) < 1e-9, 'aim is wrapped to [-pi, pi]');
});

test('inputs need strictly increasing seq; dead or unknown players are ignored', () => {
  const { match } = fakeMatch();
  assert.equal(match.input(1, input(5)), true);
  assert.equal(match.input(1, input(5)), false);
  assert.equal(match.input(1, input(4)), false);
  assert.equal(match.input(99, input(1)), false);
});

test('an overfull queue merges the oldest inputs without losing presses', () => {
  const { match } = fakeMatch();
  match.input(1, input(1, { buttons: BUTTONS.JAB }));
  match.input(1, input(2, { buttons: 0 }));
  match.input(1, input(3, { buttons: BUTTONS.DASH }));
  match.input(1, input(4, { buttons: 0, move: { x: 1, y: 0 } }));
  const f = match.byId.get(1);
  assert.equal(f.queue.length, NET.INPUT_QUEUE_MAX);
  const pressed = f.queue.reduce((acc, i) => acc | i.pressed, 0);
  assert.equal(pressed, BUTTONS.JAB | BUTTONS.DASH);
  assert.deepEqual(f.queue.at(-1).move, { x: 1, y: 0 });
});

test('holding a button only counts as one press', () => {
  const { match } = fakeMatch();
  match.input(1, input(1, { buttons: BUTTONS.JAB }));
  match.input(1, input(2, { buttons: BUTTONS.JAB }));
  assert.deepEqual(match.byId.get(1).queue.map((i) => i.pressed), [BUTTONS.JAB, 0]);
});

test('step applies one input per tick, acks it, and keeps the last move when starved', () => {
  const { match } = fakeMatch();
  const f = match.byId.get(1);
  const x0 = f.body.x;
  match.input(1, input(1, { move: { x: 1, y: 0 } }));
  match.input(1, input(2, { move: { x: 1, y: 0 } }));
  match.step();
  assert.equal(f.ackSeq, 1);
  match.step();
  match.step(); // queue empty: keeps walking
  assert.equal(f.ackSeq, 2);
  assert.ok(f.body.x > x0 + 10);
});

test('snapshots go out at the snapshot rate with acks and fighter state', () => {
  const { match, sent } = fakeMatch([2, 1]);
  for (let i = 0; i < TICK_RATE; i++) match.step();
  assert.equal(sent.length, SNAPSHOT_RATE);
  const [event, snap] = sent.at(-1);
  assert.equal(event, 'match:snapshot');
  assert.equal(snap.tick, TICK_RATE);
  assert.deepEqual(Object.keys(snap.acks).sort(), ['1', '2', '3']);
  assert.equal(snap.fighters.length, 3);
  assert.equal(snap.fighters[0].hp, PLAYER.BASE_HP);
});

test('players who leave stop fighting; an empty room asks to be removed', () => {
  const { match, players, emptyCalls } = fakeMatch();
  players.delete(1);
  match.step();
  assert.equal(match.byId.get(1).alive, false);
  players.clear();
  match.step();
  assert.equal(emptyCalls(), 1);
});

test('spawn points stay inside the arena, clear of pillars, and do not overlap', () => {
  for (const sizes of [[1, 1], [5, 5], [3, 3, 2, 2], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]]) {
    const { match } = fakeMatch(sizes);
    const bodies = match.fighters.map((f) => f.body);
    for (const b of bodies) {
      assert.ok(b.x >= PLAYER.RADIUS && b.x <= ARENA.WIDTH - PLAYER.RADIUS);
      assert.ok(b.y >= PLAYER.RADIUS && b.y <= ARENA.HEIGHT - PLAYER.RADIUS);
      for (const p of ARENA.PILLARS) {
        const cx = Math.max(p.x, Math.min(b.x, p.x + p.w));
        const cy = Math.max(p.y, Math.min(b.y, p.y + p.h));
        assert.ok(Math.hypot(b.x - cx, b.y - cy) >= PLAYER.RADIUS - 1e-6, `inside pillar: ${sizes}`);
      }
    }
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        assert.ok(Math.hypot(bodies[i].x - bodies[j].x, bodies[i].y - bodies[j].y) > PLAYER.RADIUS, `overlap: ${sizes}`);
      }
    }
  }
  assert.equal(spawnPoints([2, 2]).length, 4);
});

// Two players on two teams, match started. Returns the server, both sockets, and ids.
async function startedMatch(t) {
  const server = await startServer(t);
  const a = await server.client();
  const b = await server.client();
  const { room, playerId } = await call(a, 'room:create', { nickname: 'Ana' });
  await call(b, 'room:join', { code: room.code, nickname: 'Ben' });
  await call(a, 'option:add', { name: 'Tacos' });
  const update = nextEvent(a, 'room:update');
  await call(a, 'option:add', { name: 'Sushi' });
  const { options } = await update;
  await call(a, 'team:pick', { optionId: options[0].id });
  await call(b, 'team:pick', { optionId: options[1].id });
  assert.deepEqual(await call(a, 'match:start'), { ok: true });
  return { ...server, a, b, code: room.code, playerId };
}

test('over sockets: starting a match streams snapshots that ack inputs', async (t) => {
  const { a, b, playerId } = await startedMatch(t);

  a.emit('match:input', input(7, { move: { x: 1, y: 0 } }));
  a.emit('match:input', { garbage: true });
  let snap;
  do snap = await nextEvent(b, 'match:snapshot');
  while (snap.acks[playerId] !== 7);
  assert.equal(snap.fighters.length, 2);
});

test('a match that throws is ended and its room goes back to the lobby', async (t) => {
  const { a, rooms, loop, code } = await startedMatch(t);
  const room = rooms.getRoom(code);
  const match = room.match;
  match.step = () => { throw new Error('boom'); };
  const errors = t.mock.method(console, 'error', () => {});
  let update;
  do update = await nextEvent(a, 'room:update');
  while (update.state !== 'lobby');
  assert.equal(room.match, null);
  assert.equal(loop.stats(match), undefined);
  assert.equal(errors.mock.callCount(), 1);
});

test('resetInput lets a rejoined client start its seq over', () => {
  const { match } = fakeMatch();
  match.input(1, input(500));
  match.step();
  match.resetInput(1);
  assert.equal(match.byId.get(1).ackSeq, -1);
  assert.equal(match.input(1, input(1)), true);
});

test('one snapshot a second carries the server tick time', () => {
  const players = new Map([[1, { id: 1, teamId: 1 }], [2, { id: 2, teamId: 2 }]]);
  const sent = [];
  const match = new Match({
    room: { players, options: [{ id: 1 }, { id: 2 }] },
    emit: (_e, snap) => sent.push(snap),
    onEmpty: () => {},
    perf: () => ({ avgMs: 0.1234, maxMs: 1.5 }),
  });
  for (let i = 0; i < TICK_RATE; i++) match.step();
  assert.deepEqual(sent.filter((s) => s.tickMs).map((s) => s.tickMs), [{ avg: 0.12, max: 1.5 }]);
});

test('a fighter whose inputs stop arriving stops walking', () => {
  const { match } = fakeMatch();
  const f = match.byId.get(1);
  match.input(1, input(1, { move: { x: 1, y: 0 } }));
  for (let i = 0; i < NET.INPUT_STARVE_TICKS; i++) match.step();
  assert.deepEqual(f.move, { x: 1, y: 0 }, 'a few missing inputs keep the last move');
  match.step();
  assert.deepEqual(f.move, { x: 0, y: 0 });
  match.input(1, input(2, { move: { x: 1, y: 0 }, buttons: BUTTONS.JAB }));
  match.resetInput(1); // disconnect
  match.step();
  assert.deepEqual(f.move, { x: 0, y: 0 });
  assert.equal(f.held, 0);
});

test('if the match cannot be started, the room unlocks', async (t) => {
  const { client, rooms, loop } = await startServer(t);
  const a = await client();
  const b = await client();
  const { room } = await call(a, 'room:create', { nickname: 'Ana' });
  await call(b, 'room:join', { code: room.code, nickname: 'Ben' });
  await call(a, 'option:add', { name: 'Tacos' });
  await call(a, 'option:add', { name: 'Sushi' });
  const { options } = rooms.getRoom(room.code);
  await call(a, 'team:pick', { optionId: options[0].id });
  await call(b, 'team:pick', { optionId: options[1].id });
  t.mock.method(loop, 'add', () => { throw new Error('boom'); });
  t.mock.method(console, 'error', () => {});
  assert.equal((await call(a, 'match:start')).error, 'SERVER_ERROR');
  assert.equal(rooms.getRoom(room.code).state, 'lobby');
  assert.equal(rooms.getRoom(room.code).match, null);
});

test('a jab input hits an enemy in front, and the snapshot shows the combat state', () => {
  const { match, sent } = fakeMatch();
  const [a, b] = match.fighters;
  a.body.x = 500; a.body.y = 500;
  b.body.x = 570; b.body.y = 500;
  match.input(a.id, input(1, { aim: 0, aimed: true, buttons: BUTTONS.JAB }));
  for (let i = 0; i < 10; i++) match.step();
  assert.ok(b.hp < PLAYER.BASE_HP);
  const snap = sent.at(-1)[1];
  assert.ok(snap.fighters.every((f) => typeof f.cs.state === 'string'));
});

test('aimed is only true when sent as true', () => {
  assert.equal(validateInput(input(1, { aimed: true })).aimed, true);
  assert.equal(validateInput(input(1, { aimed: 'yes' })).aimed, false);
  assert.equal(validateInput(input(1)).aimed, false);
});

test('release edges survive input merging', () => {
  const { match } = fakeMatch();
  match.input(1, input(1, { buttons: BUTTONS.HEAVY }));
  match.input(1, input(2, { buttons: 0 }));
  match.input(1, input(3, { buttons: 0 }));
  const released = match.byId.get(1).queue.reduce((acc, i) => acc | i.released, 0);
  assert.equal(released, BUTTONS.HEAVY);
});

test('a mashed jab string is a true combo: all three hits land in one combo', () => {
  const { match } = fakeMatch();
  const [a, b] = match.fighters;
  a.body.x = 500; a.body.y = 500;
  b.body.x = 575; b.body.y = 500;
  const combos = [];
  let hp = b.hp;
  for (let tick = 1; tick < 40; tick++) {
    match.input(a.id, input(tick, { move: { x: 1, y: 0 }, aim: 0, aimed: true, buttons: tick % 2 ? BUTTONS.JAB : 0 }));
    match.input(b.id, input(tick));
    match.step();
    if (b.hp !== hp) { combos.push(b.cs.combo); hp = b.hp; }
  }
  assert.deepEqual(combos.slice(0, 3), [1, 2, 3]);
});
