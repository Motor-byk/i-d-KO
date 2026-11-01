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

test('position history keeps just enough ticks to rewind, for living fighters', () => {
  const history = new PositionHistory();
  const f = fighter(1, 1, 0, 0);
  const dead = { ...fighter(2, 2, 0, 0), alive: false };
  const last = MAX_REWIND_TICKS + 3;
  for (let tick = 1; tick <= last; tick++) {
    f.body.x = tick;
    history.record(tick, [f, dead]);
  }
  assert.equal(history.at(last - MAX_REWIND_TICKS - 1, 1), null, 'evicted');
  assert.deepEqual(history.at(last - MAX_REWIND_TICKS, 1), { x: last - MAX_REWIND_TICKS, y: 0 });
  assert.equal(history.at(last, 2), null);
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

test('a grace parry takes back the jab string credit and its dash recharge', () => {
  const a = fighter(1, 1, 500, 500);
  const b = fighter(2, 2, 560, 500);
  a.cs.chain = COMBAT.JAB_CHAIN_WINDOW;
  a.cs.jab = COMBAT.JAB.length - 2; // the next jab is the finisher
  a.cs.stringHits = COMBAT.JAB.length - 1;
  a.cs.dashCooldown = 40;
  jabActive(a);
  resolveHits([a, b], { tick: 10 });
  assert.equal(a.cs.dashCooldown, 0, 'the full string recharged the dash');
  parryGrace(b, 11);
  assert.equal(a.cs.stringHits, COMBAT.JAB.length - 1);
  assert.ok(a.cs.dashCooldown >= 40 - 1 - 5, `cooldown ${a.cs.dashCooldown} restored`);
});

test('a grace parry keeps presses buffered after the hit', () => {
  const { b } = hitAt10();
  stepCombat(b.cs, { pressed: BUTTONS.DASH });
  parryGrace(b, 11);
  assert.equal(b.cs.buffer, BUTTONS.DASH);
});

test('a grace parry gives back only the damage of the hits it undoes', () => {
  const { b } = hitAt10();
  b.hp -= 7; // something else (the ring, later) hurt b in the meantime
  parryGrace(b, 11);
  assert.equal(b.hp, PLAYER.BASE_HP - 7);
});

test('view ticks never go backwards, jump ahead or into the future', () => {
  const players = new Map([[1, { id: 1, teamId: 1 }], [2, { id: 2, teamId: 2 }]]);
  const match = new Match({ room: { players, options: [{ id: 1 }, { id: 2 }] }, emit: () => {}, onEmpty: () => {} });
  for (let i = 0; i < 20; i++) match.step();
  const f = match.byId.get(1);
  const send = (seq, tick) => {
    match.input(1, { seq, tick, move: { x: 0, y: 0 }, aim: 0, buttons: 0 });
    return f.queue.at(-1).tick;
  };
  assert.equal(send(1, 10), 10);
  assert.equal(send(2, 5), 10, 'not backwards');
  assert.equal(send(3, 18), 10 + NET.MAX_STAMP_STEP, 'not a big jump');
  match.step();
  match.step();
  assert.equal(send(4, 999), Math.min(match.tick, 12 + NET.MAX_STAMP_STEP), 'not past now');
  match.resetInput(1);
  assert.equal(send(1, 3), 3, 'a rejoined client starts over');
});
