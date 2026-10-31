import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCombat, stepCombat, phase, applyHit, applyHitstop, STATE } from '../shared/combat-state.js';
import { COMBAT, BUTTONS } from '../shared/constants.js';

const JAB = { pressed: BUTTONS.JAB };
const total = (m) => m.startup + m.active + m.recovery;

// Steps n idle ticks (no presses) and returns the states seen, one per tick.
function run(cs, n, input = {}) {
  const seen = [];
  for (let i = 0; i < n; i++) {
    stepCombat(cs, input);
    seen.push(phase(cs) ?? cs.state);
  }
  return seen;
}

test('a jab goes through startup, active and recovery, then back to idle', () => {
  const cs = createCombat();
  assert.equal(stepCombat(cs, { ...JAB, aim: 1 }), BUTTONS.JAB);
  assert.equal(cs.dir, 1, 'facing is locked when the move starts');
  const m = COMBAT.JAB[0];
  const seen = [phase(cs), ...run(cs, total(m))];
  assert.deepEqual(seen, [
    ...Array(m.startup).fill('startup'),
    ...Array(m.active).fill('active'),
    ...Array(m.recovery).fill('recovery'),
    STATE.IDLE,
  ]);
});

test('jabs pressed in time chain into a 3-hit string, then it starts over', () => {
  const cs = createCombat();
  const indexes = [];
  for (let i = 0; i < 4; i++) {
    stepCombat(cs, JAB);
    indexes.push(cs.jab);
    run(cs, total(COMBAT.JAB[cs.jab]) - 1); // finish the move on its last tick, not idle yet
  }
  assert.deepEqual(indexes, [0, 1, 2, 0]);
});

test('a jab after the chain window starts the string over', () => {
  const cs = createCombat();
  stepCombat(cs, JAB);
  run(cs, total(COMBAT.JAB[0]) + COMBAT.JAB_CHAIN_WINDOW);
  stepCombat(cs, JAB);
  assert.equal(cs.state, STATE.JAB);
  assert.equal(cs.jab, 0);
});

test('a press during a move is buffered and fires when the move ends', () => {
  const cs = createCombat();
  stepCombat(cs, JAB);
  const left = total(COMBAT.JAB[0]) - 1;
  run(cs, left - COMBAT.INPUT_BUFFER);
  stepCombat(cs, JAB); // INPUT_BUFFER ticks before the jab ends
  run(cs, COMBAT.INPUT_BUFFER - 1);
  assert.equal(phase(cs), 'recovery');
  assert.equal(stepCombat(cs, {}), BUTTONS.JAB, 'fires on the first free tick');
  assert.equal(cs.jab, 1);
});

test('a press too early for the buffer is dropped', () => {
  const cs = createCombat();
  stepCombat(cs, JAB);
  stepCombat(cs, JAB); // far more than INPUT_BUFFER ticks before the jab ends
  const seen = run(cs, total(COMBAT.JAB[0]) + 2);
  assert.deepEqual(seen.slice(-2), [STATE.IDLE, STATE.IDLE]);
  assert.equal(cs.buffer, 0);
});

test('hitstop freezes timers and the buffer, but presses still buffer', () => {
  const cs = createCombat();
  stepCombat(cs, JAB);
  const before = { ...cs };
  applyHitstop(cs, 6);
  applyHitstop(cs, 2); // a shorter hitstop doesn't cut a longer one short
  stepCombat(cs, JAB);
  run(cs, 5);
  assert.equal(cs.t, before.t);
  assert.equal(cs.hitstop, 0);
  assert.equal(cs.buffer, BUTTONS.JAB);
  assert.equal(cs.bufferAge, 0, 'the buffer did not age while frozen');
});

test('hitstun blocks actions, and a buffered press fires the tick it ends', () => {
  const cs = createCombat();
  applyHit(cs, { hitstun: 10, hitstop: 2 });
  assert.equal(cs.state, STATE.HITSTUN);
  run(cs, 2); // hitstop
  run(cs, 10 - COMBAT.INPUT_BUFFER);
  assert.equal(stepCombat(cs, JAB), 0);
  run(cs, COMBAT.INPUT_BUFFER - 2);
  assert.equal(cs.state, STATE.HITSTUN);
  assert.equal(stepCombat(cs, {}), BUTTONS.JAB);
});

test('getting hit breaks the jab string', () => {
  const cs = createCombat();
  stepCombat(cs, JAB);
  run(cs, total(COMBAT.JAB[0]) - 1);
  applyHit(cs, { hitstun: 1, hitstop: 0 });
  stepCombat(cs, JAB);
  assert.equal(cs.jab, 0);
});

test('a state restored from a copy replays identically (prediction)', () => {
  const inputs = Array.from({ length: 40 }, (_, i) => ({ pressed: i % 3 ? 0 : BUTTONS.JAB, aim: i / 10 }));
  const a = createCombat();
  inputs.slice(0, 15).forEach((inp) => stepCombat(a, inp));
  const b = JSON.parse(JSON.stringify(a));
  inputs.slice(15).forEach((inp) => { stepCombat(a, inp); stepCombat(b, inp); });
  assert.deepEqual(a, b);
});
