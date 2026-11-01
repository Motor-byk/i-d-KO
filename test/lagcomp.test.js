import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_REWIND_TICKS, PositionHistory, rewindTicks } from '../server/game/lagcomp.js';
import { parryGrace, resolveHits } from '../server/game/combat.js';
import { Match } from '../server/game/match.js';
import { createCombat, stepCombat, phase, STATE } from '../shared/combat-state.js';
import { createBody } from '../shared/physics.js';
import { BUTTONS, COMBAT, NET, PLAYER, TICK_RATE } from '../shared/constants.js';

const fighter = (id, teamId, x, y) => ({
  id, teamId, body: createBody(x, y), cs: createCombat(), hp: PLAYER.BASE_HP, alive: true,
  hitIds: new Set(), grace: null, rewind: 0,
});

function jabActive(f, dir = 0) {
  stepCombat(f.cs, { pressed: BUTTONS.JAB, aim: dir });
  while (phase(f.cs) !== 'active') stepCombat(f.cs, {});
}

const reach = PLAYER.RADIUS * 2 + COMBAT.JAB[0].reach;

test('rewind is clamped to [0, LAG_COMP_MAX_MS]', () => {
  assert.equal(MAX_REWIND_TICKS, Math.round((NET.LAG_COMP_MAX_MS * TICK_RATE) / 1000));
  assert.equal(rewindTicks(100, 99), 1);
  assert.equal(rewindTicks(100, 0), MAX_REWIND_TICKS, 'never more than 100ms');
  assert.equal(rewindTicks(100, 120), 0, 'never into the future');
});

test('position history keeps the last HISTORY_TICKS ticks of living fighters', () => {
  const history = new PositionHistory();
  const f = fighter(1, 1, 0, 0);
  const dead = { ...fighter(2, 2, 0, 0), alive: false };
  for (let tick = 1; tick <= NET.HISTORY_TICKS + 2; tick++) {
    f.body.x = tick;
    history.record(tick, [f, dead]);
  }
  assert.equal(history.at(1, 1), null, 'evicted');
  assert.deepEqual(history.at(NET.HISTORY_TICKS + 2, 1), { x: NET.HISTORY_TICKS + 2, y: 0 });
  assert.equal(history.at(5, 2), null);
});

// a jabs right at b. b was in reach two ticks ago, but has since walked out of it.
function walkedAway(state = STATE.IDLE) {
  const a = fighter(1, 1, 500, 500);
  const b = fighter(2, 2, 500 + reach - 5, 500);
  const history = new PositionHistory();
  history.record(8, [a, b]);
  b.body.x += 20;
  history.record(9, [a, b]);
  history.record(10, [a, b]);
  b.cs.state = state;
  jabActive(a);
  return { a, b, history };
}

test('an attack hits the target where the attacker saw it', () => {
  const { a, b, history } = walkedAway();
  a.rewind = 2;
  const [hit] = resolveHits([a, b], { tick: 10, seen: history.seen(10) });
  assert.ok(hit, 'hit where it was 2 ticks ago');
  assert.ok(b.hp < PLAYER.BASE_HP);
});

test('with no rewind the target is judged where it is now', () => {
  const { a, b, history } = walkedAway();
  assert.deepEqual(resolveHits([a, b], { tick: 10, seen: history.seen(10) }), []);
});

for (const state of [STATE.DASH, STATE.PARRY, STATE.BURST]) {
  test(`a target that is in ${state} now is never rewound`, () => {
    const { a, b, history } = walkedAway(state);
    a.rewind = 2;
    assert.deepEqual(resolveHits([a, b], { tick: 10, seen: history.seen(10) }), []);
  });
}

// a jabs b (idle, in reach) at tick 10.
function hitAt10() {
  const a = fighter(1, 1, 500, 500);
  const b = fighter(2, 2, 560, 500);
  jabActive(a);
  resolveHits([a, b], { tick: 10 });
  assert.equal(b.cs.state, STATE.HITSTUN);
  return { a, b };
}

test(`a parry pressed up to ${COMBAT.PARRY.grace} ticks after the hit still parries it`, () => {
  const { a, b } = hitAt10();
  assert.equal(parryGrace(b, 10 + COMBAT.PARRY.grace), true);
  assert.equal(b.hp, PLAYER.BASE_HP, 'damage undone');
  assert.equal(b.cs.state, STATE.IDLE);
  assert.equal(b.cs.combo, 0);
  assert.equal(b.body.kx, 0, 'knockback undone');
  assert.equal(a.cs.state, STATE.STUNNED);
  assert.equal(parryGrace(b, 10 + COMBAT.PARRY.grace), false, 'used up');
});

test('a parry pressed later than the grace is just late', () => {
  const { a, b } = hitAt10();
  assert.equal(parryGrace(b, 11 + COMBAT.PARRY.grace), false);
  assert.equal(b.cs.state, STATE.HITSTUN);
  assert.equal(a.cs.state, STATE.JAB);
});

test('grace only covers hits on a fighter that could have parried', () => {
  const a = fighter(1, 1, 500, 500);
  const b = fighter(2, 2, 560, 500);
  stepCombat(b.cs, { pressed: BUTTONS.HEAVY }); // b is charging a heavy, not idle
  jabActive(a);
  resolveHits([a, b], { tick: 10 });
  assert.equal(parryGrace(b, 11), false);
});

test('grace never covers a KO or a teammate', () => {
  const { b } = hitAt10();
  b.alive = false;
  assert.equal(parryGrace(b, 11), false);
  const a = fighter(1, 1, 500, 500);
  const mate = fighter(2, 1, 560, 500);
  jabActive(a);
  resolveHits([a, mate], { tick: 10 });
  assert.equal(parryGrace(mate, 11), false);
});

test('in a match, a late parry press undoes the hit and stuns the attacker', () => {
  const players = new Map([[1, { id: 1, teamId: 1 }], [2, { id: 2, teamId: 2 }]]);
  const match = new Match({ room: { players, options: [{ id: 1 }, { id: 2 }] }, emit: () => {}, onEmpty: () => {} });
  const [a, b] = [match.byId.get(1), match.byId.get(2)];
  b.body.x = a.body.x + 60;
  b.body.y = a.body.y;
  const send = (f, seq, buttons, aim = 0) => match.input(f.id, { seq, tick: match.tick, move: { x: 0, y: 0 }, aim, aimed: true, buttons });
  let seq = 0;
  send(a, ++seq, BUTTONS.JAB);
  send(b, seq, 0);
  while (b.cs.state !== STATE.HITSTUN) {
    match.step();
    send(a, ++seq, 0);
    send(b, seq, 0);
  }
  assert.ok(b.hp < PLAYER.BASE_HP);
  match.step();          // one tick late
  send(b, ++seq, BUTTONS.PARRY);
  match.step();
  assert.equal(b.hp, PLAYER.BASE_HP);
  assert.equal(a.cs.state, STATE.STUNNED);
});
