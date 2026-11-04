import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARENA, BUTTONS, DT, MATCH, PLAYER, RING } from '../shared/constants.js';
import { eliminationMode } from '../server/game/modes/elimination.js';
import { call, nextEvent, input, fakeMatch, startedMatch } from './helpers.js';

const CX = ARENA.WIDTH / 2;
const CY = ARENA.HEIGHT / 2;
// About to burn out: one more tick outside the ring is a KO.
function burnNextTick(f) {
  f.body.x = PLAYER.RADIUS;
  f.body.y = PLAYER.RADIUS;
  f.hp = RING.DAMAGE_PER_SECOND * DT;
}

const closeRing = (match) => { match.tick = RING.CLOSE_TICK; };

test('the last team standing wins, and the match ends after a short delay', () => {
  const { match, sent, ended } = fakeMatch();
  const [a, b] = match.fighters;
  closeRing(match);
  a.body.x = CX - 150; a.body.y = CY;
  a.hp = 1e9;
  burnNextTick(b);
  match.step();
  assert.equal(b.alive, false);
  assert.deepEqual(match.result, { teamId: a.teamId });
  for (let i = 0; i < MATCH.END_DELAY_TICKS; i++) {
    assert.equal(ended.length, 0);
    match.step();
  }
  assert.deepEqual(ended, [{ teamId: a.teamId }]);
  assert.equal(sent.at(-1)[1].fighters.find((f) => f.id === b.id).alive, false);
});

test('the winner stops burning once the match is decided', () => {
  const { match } = fakeMatch();
  const [a, b] = match.fighters;
  closeRing(match);
  a.hp = 50;
  burnNextTick(b);
  match.step();
  const hp = a.hp;
  match.step();
  assert.equal(a.hp, hp);
  assert.equal(a.alive, true);
});

test('a team stays in while any member is alive', () => {
  const { match } = fakeMatch([2, 1]);
  const [a1, a2, b] = match.fighters;
  closeRing(match);
  burnNextTick(a1);
  a2.hp = 1e9;
  b.hp = 1e9;
  match.step();
  assert.equal(a1.alive, false);
  assert.equal(match.result, null);
});

test('all remaining teams falling on one tick is sudden death: revived at 1 HP in a tiny ring', () => {
  const { match, sent, ended } = fakeMatch();
  const [a, b] = match.fighters;
  closeRing(match);
  burnNextTick(a);
  burnNextTick(b);
  a.cs.state = 'hitstun'; // stale combat state must not survive the revive
  match.step();
  assert.equal(match.result, null);
  assert.deepEqual(ended, []);
  for (const f of [a, b]) {
    assert.equal(f.alive, true);
    assert.equal(f.hp, RING.SUDDEN_DEATH_HP);
    assert.equal(f.cs.state, 'idle');
    assert.ok(Math.hypot(f.body.x - CX, f.body.y - CY) < RING.SUDDEN_DEATH_RADIUS);
  }
  match.step();
  assert.equal(sent.at(-1)[1].suddenDeath, 1);
  assert.ok(sent.at(-1)[1].ring <= RING.SUDDEN_DEATH_RADIUS);
});

test('a hit and the ring KOing the last two on one tick is a tie too (ring runs after hits)', () => {
  // a stands in reach of b's jab; both are outside the closed ring.
  const setup = () => {
    const { match } = fakeMatch();
    const [a, b] = match.fighters;
    closeRing(match);
    a.hp = b.hp = 1e9;
    a.body.x = PLAYER.RADIUS; a.body.y = PLAYER.RADIUS;
    b.body.x = PLAYER.RADIUS + 70; b.body.y = PLAYER.RADIUS;
    match.input(b.id, input(1, { aim: Math.PI, aimed: true, buttons: BUTTONS.JAB }));
    return { match, a, b };
  };
  // How many ticks until the jab lands?
  const probe = setup();
  let ticks = 0;
  while (probe.a.cs.state !== 'hitstun') { probe.match.step(); ticks++; }

  const { match, a, b } = setup();
  for (let i = 1; i < ticks; i++) match.step();
  a.hp = 1;
  b.hp = RING.DAMAGE_PER_SECOND * DT;
  match.step();
  assert.equal(match.result, null);
  assert.equal(match.mode.publicState(match).suddenDeath, 1);
  assert.equal(a.alive && b.alive, true);
});

test('tied fighters on a team with a survivor elsewhere lose: the survivor wins, no sudden death', () => {
  const { match } = fakeMatch([1, 1, 1]);
  const [a, b, c] = match.fighters;
  closeRing(match);
  burnNextTick(a);
  burnNextTick(b);
  c.hp = 1e9;
  match.step();
  assert.deepEqual(match.result, { teamId: c.teamId });
  assert.equal(a.alive, false);
  assert.equal(b.alive, false);
});

test('only the tied fighters come back; earlier KOs stay out', () => {
  const { match } = fakeMatch([2, 1]);
  const [a1, a2, b] = match.fighters;
  closeRing(match);
  a2.hp = 1e9;
  b.hp = 1e9;
  burnNextTick(a1);
  match.step();
  burnNextTick(a2);
  burnNextTick(b);
  match.step();
  assert.equal(match.result, null);
  assert.equal(a1.alive, false);
  assert.equal(a2.alive, true);
  assert.equal(b.alive, true);
});

test('someone leaving on the tied tick is not tied: the team still in the room wins', () => {
  const { match, players } = fakeMatch([2, 1]);
  const [a1, a2, b] = match.fighters;
  closeRing(match);
  burnNextTick(a1);
  burnNextTick(a2);
  burnNextTick(b);
  players.delete(b.id); // left on the same tick: not tied, just gone
  match.step();
  assert.deepEqual(match.result, { teamId: a1.teamId });
  assert.equal(a2.alive, false);
});

test('sudden death repeats on another tie, then the first hit decides it', () => {
  const { match } = fakeMatch();
  const [a, b] = match.fighters;
  closeRing(match);
  for (let round = 1; round <= 2; round++) {
    burnNextTick(a);
    burnNextTick(b);
    match.step();
    assert.equal(match.mode.publicState(match).suddenDeath, round);
    assert.equal(match.result, null);
  }
  // Put them in reach, inside the ring: a's jab lands.
  a.body.x = CX - 150; a.body.y = CY;
  b.body.x = CX - 150 + 70; b.body.y = CY;
  match.input(a.id, input(1, { aim: 0, aimed: true, buttons: BUTTONS.JAB }));
  for (let i = 0; i < 10 && !match.result; i++) match.step();
  assert.deepEqual(match.result, { teamId: a.teamId });
});

test('tied again after the last sudden death: a random tied team wins, each team equally likely', () => {
  // Three teams, the first with two fighters: it must not get better odds for its size.
  const winnerFor = (roll) => {
    const { match } = fakeMatch([2, 1, 1], { mode: eliminationMode({ random: () => roll }) });
    closeRing(match);
    for (let round = 0; round <= RING.MAX_SUDDEN_DEATHS; round++) {
      assert.equal(match.result, null);
      assert.equal(match.mode.publicState(match).suddenDeath, round);
      match.fighters.forEach(burnNextTick);
      match.step();
    }
    assert.equal(match.mode.publicState(match).suddenDeath, RING.MAX_SUDDEN_DEATHS);
    assert.ok(match.fighters.every((f) => !f.alive), 'nobody revives this time');
    return match.result.teamId;
  };
  assert.equal(winnerFor(0), 1);
  assert.equal(winnerFor(0.49), 2);
  assert.equal(winnerFor(0.99), 3);
});

test('the sudden death ring closes, so a stall ends with whoever stays inside longest', () => {
  const { match } = fakeMatch();
  const [a, b] = match.fighters;
  closeRing(match);
  burnNextTick(a);
  burnNextTick(b);
  match.step();
  // a hugs the pillar; b stays out at its spawn.
  a.body.x = CX - 95; a.body.y = CY;
  for (let i = 0; i < RING.SUDDEN_DEATH_CLOSE_TICKS && !match.result; i++) match.step();
  assert.deepEqual(match.result, { teamId: a.teamId });
});

test('nobody left to win: a null result', () => {
  const { match, players } = fakeMatch();
  closeRing(match);
  players.delete(1);
  players.delete(2);
  players.set(3, { id: 3, teamId: null }); // a spectator keeps the room open
  match.step();
  assert.deepEqual(match.result, { teamId: null });
});

test('a revived fighter is not hit where it used to be (lag comp history is cleared)', () => {
  const { match } = fakeMatch();
  const [a, b] = match.fighters;
  closeRing(match);
  burnNextTick(a);
  burnNextTick(b);
  match.step();
  for (const f of [a, b]) assert.equal(match.history.at(match.tick, f.id), null);
});

test('a revive keeps the input stream: acks hold, and a button held through it is no new press', () => {
  const { match } = fakeMatch();
  const [a, b] = match.fighters;
  closeRing(match);
  a.hp = b.hp = 1e9;
  match.input(a.id, input(1, { buttons: BUTTONS.JAB }));
  match.step();
  burnNextTick(a);
  burnNextTick(b);
  match.step();
  assert.equal(match.mode.publicState(match).suddenDeath, 1);
  assert.equal(a.ackSeq, 1);
  assert.equal(match.input(a.id, input(1)), false, 'old seqs stay rejected');
  match.input(a.id, input(2, { buttons: BUTTONS.JAB }));
  assert.equal(a.queue[0].pressed, 0);
  match.step();
  assert.equal(a.cs.state, 'idle', 'no jab fired by itself');
});

test('over sockets: when the match is decided the room shows the winner and stays locked', async (t) => {
  const { client, rooms, loop, a, b, code, token, options } = await startedMatch(t);
  const { match } = rooms.getRoom(code);
  await call(b, 'room:leave');
  let update;
  do update = await nextEvent(a, 'room:update');
  while (update.state !== 'results');
  assert.deepEqual(update.result, { optionId: options[0].id });
  assert.equal(rooms.getRoom(code).match, null);
  assert.equal(loop.stats(match), undefined);

  // Locked: no new players, no lobby actions, no second match.
  const c = await client();
  assert.equal((await call(c, 'room:join', { code: code, nickname: 'Cy' })).error, 'ROOM_LOCKED');
  assert.equal((await call(a, 'match:start')).error, 'ROOM_LOCKED');

  // A reload lands back on the same result.
  a.disconnect();
  const again = await client();
  const rejoined = await call(again, 'room:rejoin', { code: code, token });
  assert.equal(rejoined.room.state, 'results');
  assert.deepEqual(rejoined.room.result, { optionId: options[0].id });

  // The last player out deletes the room.
  await call(again, 'room:leave');
  assert.equal(rooms.getRoom(code), undefined);
});
