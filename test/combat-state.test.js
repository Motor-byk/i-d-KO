import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCombat, stepCombat, stepFighter, phase, moveFrames, chargeFraction, applyHit, applyLanded, applyParry,
  isParrying, STATE,
} from '../shared/combat-state.js';
import { createBody } from '../shared/physics.js';
import { COMBAT, BUTTONS, ARENA, PLAYER, DT } from '../shared/constants.js';

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
  applyLanded(cs, 6);
  applyLanded(cs, 2); // a shorter hitstop doesn't cut a longer one short
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

const HEAVY = BUTTONS.HEAVY;

test('holding heavy charges until release, then fires a heavy scaled by the charge', () => {
  const cs = createCombat();
  assert.equal(stepCombat(cs, { pressed: HEAVY, held: HEAVY }), HEAVY);
  assert.equal(cs.state, STATE.CHARGE);
  for (let i = 0; i < 20; i++) stepCombat(cs, { held: HEAVY, aim: 0.5 });
  assert.equal(cs.state, STATE.CHARGE);
  stepCombat(cs, { released: HEAVY, aim: 0.7 });
  assert.equal(cs.state, STATE.HEAVY);
  assert.equal(cs.charge, 21);
  assert.equal(cs.dir, 0.7, 'aim follows the drag until release');
  const m = moveFrames(cs);
  assert.ok(m.damage > COMBAT.HEAVY.damageMin && m.damage < COMBAT.HEAVY.damageMax);
  assert.ok(m.launch);
});

test('a quick heavy tap (even one merged into a single input) still charges the minimum', () => {
  const cs = createCombat();
  stepCombat(cs, { pressed: HEAVY, released: HEAVY, held: 0 });
  let ticks = 0;
  while (cs.state === STATE.CHARGE) { stepCombat(cs, {}); ticks++; }
  assert.equal(ticks, COMBAT.HEAVY.MIN_CHARGE);
  assert.equal(moveFrames(cs).damage, COMBAT.HEAVY.damageMin);
  assert.equal(moveFrames(cs).launch, false);
});

test('a release then re-press inside the minimum charge still fires', () => {
  const cs = createCombat();
  stepCombat(cs, { pressed: HEAVY, held: HEAVY });
  stepCombat(cs, { released: HEAVY, pressed: HEAVY, held: HEAVY });
  run(cs, COMBAT.HEAVY.MIN_CHARGE, { held: HEAVY });
  assert.equal(cs.state, STATE.HEAVY);
});

test('a full charge held too long fires by itself', () => {
  const cs = createCombat();
  stepCombat(cs, { pressed: HEAVY, held: HEAVY });
  run(cs, COMBAT.HEAVY.MAX_CHARGE + COMBAT.HEAVY.MAX_HOLD, { held: HEAVY });
  assert.equal(cs.state, STATE.HEAVY);
  assert.equal(cs.charge, COMBAT.HEAVY.MAX_CHARGE);
  assert.equal(chargeFraction(cs.charge), 1);
});

test('a launched fighter bounces off a wall once, with extra hitstun', () => {
  const cs = createCombat();
  const body = createBody(ARENA.WIDTH - PLAYER.RADIUS - 20, 100);
  applyHit(cs, { hitstun: 24, hitstop: 0, launch: true });
  body.kx = COMBAT.HEAVY.knockbackMax;
  stepFighter(cs, body, { move: { x: 0, y: 0 } });
  assert.ok(body.kx < 0, 'knockback reflected off the wall');
  assert.equal(cs.launched, false);
  assert.equal(cs.len, 24 + COMBAT.HEAVY.WALL_BOUNCE_HITSTUN);
  assert.equal(cs.hitstop, COMBAT.HEAVY.WALL_BOUNCE_HITSTOP);
});

test('a hit that does not launch just stops at the wall', () => {
  const cs = createCombat();
  const body = createBody(ARENA.WIDTH - PLAYER.RADIUS - 20, 100);
  applyHit(cs, { hitstun: 24, hitstop: 0 });
  body.kx = COMBAT.HEAVY.knockbackMax;
  stepFighter(cs, body, { move: { x: 0, y: 0 } });
  assert.equal(body.kx, 0);
});

const DASH = BUTTONS.DASH;

test('a dash moves fast along the stick, then goes on cooldown', () => {
  const cs = createCombat();
  const body = createBody(300, 150);
  assert.equal(stepFighter(cs, body, { pressed: DASH, move: { x: 0, y: 1 }, aim: 0 }), DASH);
  assert.ok(Math.abs(cs.dir - Math.PI / 2) < 1e-9, 'dashes along the stick, not the aim');
  for (let i = 1; i < COMBAT.DASH.duration; i++) stepFighter(cs, body, { move: { x: 0, y: 0 } });
  assert.ok(Math.abs(body.y - (150 + COMBAT.DASH.speed * DT * COMBAT.DASH.duration)) < 1e-6);
  stepFighter(cs, body, { move: { x: 0, y: 0 } });
  assert.equal(cs.state, STATE.IDLE);
  assert.equal(stepCombat(cs, { pressed: DASH }), 0, 'on cooldown');
});

test('with the stick centered, a dash goes where you face', () => {
  const cs = createCombat();
  stepCombat(cs, { pressed: DASH, move: { x: 0.1, y: 0 }, aim: 2 });
  assert.equal(cs.dir, 2);
});

test('a dash cancels jab recovery after cancelAfter ticks, but not before', () => {
  const m = COMBAT.JAB[0];
  const cs = createCombat();
  stepCombat(cs, JAB);
  run(cs, m.startup + m.active - 1); // last active tick
  assert.equal(phase(cs), 'active');
  stepCombat(cs, { pressed: DASH }); // buffered
  run(cs, COMBAT.DASH.cancelAfter - 1);
  assert.equal(phase(cs), 'recovery');
  assert.equal(stepCombat(cs, {}), DASH, 'the buffered dash fires as soon as cancelling is allowed');
  assert.equal(cs.state, STATE.DASH);
});

test('a dash cancels a heavy charge', () => {
  const cs = createCombat();
  stepCombat(cs, { pressed: BUTTONS.HEAVY, held: BUTTONS.HEAVY });
  run(cs, 3, { held: BUTTONS.HEAVY });
  assert.equal(stepCombat(cs, { pressed: DASH, held: BUTTONS.HEAVY }), DASH);
});

test('a dash press on cooldown is buffered until the cooldown ends', () => {
  const cs = createCombat();
  stepCombat(cs, { pressed: DASH });
  run(cs, COMBAT.DASH.cooldown - COMBAT.INPUT_BUFFER - 1);
  stepCombat(cs, { pressed: DASH });
  let fired = 0;
  for (let i = 0; i < COMBAT.INPUT_BUFFER && !fired; i++) fired = stepCombat(cs, {});
  assert.equal(fired, DASH);
});

test('hitstun cannot be dashed out of', () => {
  const cs = createCombat();
  applyHit(cs, { hitstun: 10, hitstop: 0 });
  assert.equal(stepCombat(cs, { pressed: DASH }), 0);
});

test('a parry is active for its window, then a whiff is stuck in recovery', () => {
  const cs = createCombat();
  assert.equal(stepCombat(cs, { pressed: BUTTONS.PARRY }), BUTTONS.PARRY);
  const active = [isParrying(cs)];
  for (let i = 1; i < COMBAT.PARRY.active + 1; i++) { stepCombat(cs, {}); active.push(isParrying(cs)); }
  assert.deepEqual(active, [...Array(COMBAT.PARRY.active).fill(true), false]);
  run(cs, COMBAT.PARRY.recovery - 2);
  assert.equal(cs.state, STATE.PARRY);
  assert.equal(stepCombat(cs, JAB), 0, 'a whiffed parry is punishable');
  stepCombat(cs, {});
  assert.equal(cs.state, STATE.JAB, 'the buffered jab fires once recovery ends');
});

test('applyParry frees the parrier and stuns the attacker', () => {
  const p = createCombat();
  const a = createCombat();
  stepCombat(p, { pressed: BUTTONS.PARRY });
  stepCombat(a, JAB);
  applyParry(p, a);
  assert.equal(p.state, STATE.IDLE);
  assert.equal(a.state, STATE.STUNNED);
  run(a, COMBAT.PARRY.hitstop + COMBAT.PARRY.stun - 1);
  assert.equal(a.state, STATE.STUNNED);
  run(a, 1);
  assert.equal(a.state, STATE.IDLE);
});

test('each hit in a combo stuns for less, down to the minimum', () => {
  const cs = createCombat();
  const lens = [];
  for (let i = 0; i < 12; i++) {
    applyHit(cs, { hitstun: 16, hitstop: 0 });
    lens.push(cs.len);
    stepCombat(cs, {});
  }
  assert.deepEqual(lens.slice(0, 3), [16, 13, 10]);
  assert.equal(lens.at(-1), COMBAT.MIN_HITSTUN);
  assert.equal(cs.combo, 12);
});

test('a combo ends a tick after hitstun runs out, so the next hit starts fresh', () => {
  const cs = createCombat();
  applyHit(cs, { hitstun: 5, hitstop: 0 });
  run(cs, 5);
  assert.equal(cs.state, STATE.IDLE);
  run(cs, 1);
  applyHit(cs, { hitstun: 16, hitstop: 0 });
  assert.equal(cs.combo, 1);
  assert.equal(cs.len, 16);
});

test('a hit on the tick hitstun runs out still continues the combo', () => {
  const cs = createCombat();
  applyHit(cs, { hitstun: 5, hitstop: 0 });
  run(cs, 5);
  applyHit(cs, { hitstun: 16, hitstop: 0 });
  assert.equal(cs.combo, 2);
  assert.equal(cs.len, Math.round(16 * COMBAT.HITSTUN_DECAY));
});

test('a combo that lasts COMBO_BURST_TICKS (hitstop included) bursts out', () => {
  const cs = createCombat();
  const body = createBody(800, 500);
  for (let t = 0; t < COMBAT.COMBO_BURST_TICKS - 1; t++) {
    if (t % 8 === 0) applyHit(cs, { hitstun: 30, hitstop: 4 });
    stepFighter(cs, body, { move: { x: 0, y: 0 } });
  }
  assert.equal(cs.state, STATE.HITSTUN);
  body.kx = 500;
  stepFighter(cs, body, { move: { x: 0, y: 0 } });
  assert.equal(cs.state, STATE.BURST);
  assert.equal(cs.hitstop, 0);
  assert.equal(cs.invuln, COMBAT.BURST_INVULN);
  assert.equal(body.kx, 0, 'the burst stops the knockback');
  run(cs, COMBAT.BURST_TICKS);
  assert.equal(cs.state, STATE.IDLE);
  assert.ok(cs.invuln > 0, 'still invulnerable for a moment after the burst');
});

test('attacking out of a burst gives up the invulnerability', () => {
  const cs = createCombat();
  cs.invuln = 10;
  stepCombat(cs, { pressed: DASH });
  assert.ok(cs.invuln > 0, 'moving away keeps it');
  run(cs, COMBAT.DASH.duration);
  stepCombat(cs, JAB);
  assert.equal(cs.invuln, 0);
});

test('a launched fighter sliding along a wall does not bounce', () => {
  const cs = createCombat();
  const body = createBody(PLAYER.RADIUS, 300); // flush to the left wall
  applyHit(cs, { hitstun: 24, hitstop: 0, launch: true });
  body.kx = -5;
  body.ky = COMBAT.HEAVY.knockbackMax;
  stepFighter(cs, body, { move: { x: 0, y: 0 } });
  assert.equal(cs.launched, true);
  assert.equal(cs.len, 24);
});

test('heavy recovery cannot be dash-cancelled', () => {
  const cs = createCombat();
  stepCombat(cs, { pressed: BUTTONS.HEAVY, released: BUTTONS.HEAVY });
  while (cs.state !== STATE.HEAVY) stepCombat(cs, {});
  while (phase(cs) !== 'recovery') stepCombat(cs, {});
  run(cs, COMBAT.DASH.cancelAfter);
  assert.equal(stepCombat(cs, { pressed: DASH }), 0);
  assert.equal(cs.state, STATE.HEAVY);
});

// Lands each jab of a string as soon as it goes active; skip lists jab indexes that whiff.
function landString(cs, skip = []) {
  for (let i = 0; i < COMBAT.JAB.length; i++) {
    stepCombat(cs, JAB);
    while (phase(cs) !== 'active') stepCombat(cs, {});
    if (!skip.includes(cs.jab)) applyLanded(cs, 0);
    while (cs.state === STATE.JAB) stepCombat(cs, {});
  }
}

test('landing every jab of a string fully recharges the dash', () => {
  const cs = createCombat();
  cs.dashCooldown = COMBAT.DASH.cooldown;
  landString(cs);
  assert.equal(cs.dashCooldown, 0);
  assert.equal(stepCombat(cs, { pressed: DASH }), DASH);
});

test('a string with a missed jab does not recharge the dash', () => {
  for (const skip of [[0], [1], [2]]) {
    const cs = createCombat();
    cs.dashCooldown = COMBAT.DASH.cooldown;
    landString(cs, skip);
    assert.ok(cs.dashCooldown > 0, `missed jab ${skip}`);
  }
});

test('a new string starts the count over', () => {
  const cs = createCombat();
  stepCombat(cs, JAB);
  while (phase(cs) !== 'active') stepCombat(cs, {});
  applyLanded(cs, 0);
  run(cs, 40); // the chain window passes
  cs.dashCooldown = COMBAT.DASH.cooldown;
  landString(cs, [0]);
  assert.ok(cs.dashCooldown > 0);
});

const SPIN = { pressed: BUTTONS.SPIN };

test('a spin starts from idle, goes through its phases at attack walk, and ends idle', () => {
  const cs = createCombat();
  assert.equal(stepCombat(cs, { ...SPIN, aim: 2 }), BUTTONS.SPIN);
  assert.equal(cs.state, STATE.SPIN);
  assert.equal(cs.dir, 2);
  const m = COMBAT.SPIN;
  const seen = [phase(cs), ...run(cs, total(m))];
  assert.deepEqual(seen, [
    ...Array(m.startup).fill('startup'),
    ...Array(m.active).fill('active'),
    ...Array(m.recovery).fill('recovery'),
    STATE.IDLE,
  ]);
  const body = createBody(500, 500);
  const spinning = createCombat();
  stepCombat(spinning, SPIN);
  stepFighter(spinning, body, { move: { x: 1, y: 0 } });
  assert.ok(body.vx > 0 && body.vx <= PLAYER.MOVE_SPEED * COMBAT.ATTACK_WALK + 1e-9, 'walks slowly');
});

test('a spin wins over a jab pressed on the same tick, and only starts from idle', () => {
  const cs = createCombat();
  assert.equal(stepCombat(cs, { pressed: BUTTONS.JAB | BUTTONS.SPIN }), BUTTONS.SPIN);
  const busy = createCombat();
  stepCombat(busy, JAB);
  assert.equal(stepCombat(busy, SPIN), 0, 'buffered while the jab runs');
  assert.equal(busy.state, STATE.JAB);
});

test('a spin breaks the jab string and earns no string credit', () => {
  const cs = createCombat();
  stepCombat(cs, JAB);
  applyLanded(cs, 0);
  assert.equal(cs.stringHits, 1);
  while (cs.state === STATE.JAB) stepCombat(cs, {});
  assert.ok(cs.chain > 0, 'still in the chain window');
  stepCombat(cs, SPIN);
  assert.equal(cs.state, STATE.SPIN);
  assert.equal(cs.stringHits, 0);
  applyLanded(cs, 0);
  assert.equal(cs.stringHits, 0, 'a spin hit counts for nothing');
  while (cs.state === STATE.SPIN) stepCombat(cs, {});
  stepCombat(cs, JAB);
  assert.equal(cs.jab, 0, 'the next jab starts a new string');
});

test('spin recovery can be dash-cancelled like a jab', () => {
  const cs = createCombat();
  stepCombat(cs, SPIN);
  const m = COMBAT.SPIN;
  run(cs, m.startup + m.active - 1 + COMBAT.DASH.cancelAfter - 1);
  assert.equal(stepCombat(cs, { pressed: BUTTONS.DASH }), 0, 'too early');
  assert.equal(stepCombat(cs, {}), BUTTONS.DASH, 'fires once the cancel window opens');
  assert.equal(cs.state, STATE.DASH);
});

test('a heavy reaches further and recovers longer the more it was charged', () => {
  const H = COMBAT.HEAVY;
  const fire = (charge) => {
    const cs = createCombat();
    stepCombat(cs, { pressed: HEAVY, held: HEAVY });
    run(cs, Math.max(0, charge - 1), { held: HEAVY });
    stepCombat(cs, { released: HEAVY });
    while (cs.state === STATE.CHARGE) stepCombat(cs, {});
    return moveFrames(cs);
  };
  const tap = fire(0);
  const mid = fire((H.MIN_CHARGE + H.MAX_CHARGE) / 2);
  const full = fire(H.MAX_CHARGE);
  assert.deepEqual([tap.reach, tap.recovery], [H.reachMin, H.recoveryMin]);
  assert.deepEqual([full.reach, full.recovery], [H.reachMax, H.recoveryMax]);
  assert.ok(mid.reach > tap.reach && mid.reach < full.reach);
  assert.ok(mid.recovery > tap.recovery && mid.recovery < full.recovery);
});

test('a tapped heavy hits MIN_CHARGE + startup ticks after the press', () => {
  const cs = createCombat();
  stepCombat(cs, { pressed: HEAVY, released: HEAVY, held: 0 });
  let ticks = 0;
  while (phase(cs) !== 'active') { stepCombat(cs, {}); ticks++; }
  assert.equal(ticks, COMBAT.HEAVY.MIN_CHARGE + COMBAT.HEAVY.startup);
  assert.equal(ticks, 7);
});

// Charges a heavy for `charge` ticks at (x, y) aiming `aim`, then steps it to its first active tick.
function heavyAt(x, y, aim, charge) {
  const cs = createCombat();
  const body = createBody(x, y);
  const still = { move: { x: 0, y: 0 }, aim };
  stepFighter(cs, body, { ...still, pressed: HEAVY, held: HEAVY });
  for (let i = 1; i < charge; i++) stepFighter(cs, body, { ...still, held: HEAVY });
  stepFighter(cs, body, { ...still, released: HEAVY });
  while (phase(cs) !== 'active') stepFighter(cs, body, still);
  return { cs, body, still };
}

// Standing flush against the left wall.
const FLUSH = PLAYER.RADIUS;

test('a heavy into a wall or pillar recoils you off it, harder with more charge', () => {
  const H = COMBAT.HEAVY;
  const tap = heavyAt(FLUSH, 500, Math.PI, 0);
  const full = heavyAt(FLUSH, 500, Math.PI, H.MAX_CHARGE);
  assert.equal(tap.cs.recoil, true);
  assert.ok(tap.body.kx > 0 && Math.abs(tap.body.ky) < 1e-9, 'straight off the left wall');
  assert.ok(tap.body.kx <= H.WALL_RECOIL_MIN && tap.body.kx > 0.95 * H.WALL_RECOIL_MIN, `tap ${tap.body.kx}`);
  assert.ok(full.body.kx <= H.WALL_RECOIL_MAX && full.body.kx > 0.95 * H.WALL_RECOIL_MAX, `full ${full.body.kx}`);
  // Hugging the pillar, the fist tip ends nearer its far side: still pushed back the way it came.
  const pillar = heavyAt(ARENA.PILLARS[2].x - PLAYER.RADIUS, 500, 0, H.MAX_CHARGE);
  assert.ok(pillar.body.kx < 0 && Math.abs(pillar.body.ky) < 1e-9, 'back off the center pillar');
});

test('the deeper the fists would go into the wall, the harder the recoil', () => {
  const H = COMBAT.HEAVY;
  const speeds = [FLUSH, 60, 100].map((x) => heavyAt(x, 500, Math.PI, H.MAX_CHARGE).body.kx);
  assert.ok(speeds[0] > speeds[1] && speeds[1] > speeds[2], speeds.join(' > '));
  assert.ok(speeds[2] >= H.WALL_RECOIL_GRAZE * H.WALL_RECOIL_MAX, 'a graze still gets its share');
});

test('the recoil leans back along the aim, between it and the wall normal', () => {
  const off = 0.5; // aimed down-left into the left wall, so pushed up-right
  const { body } = heavyAt(FLUSH, 500, Math.PI - off, COMBAT.HEAVY.MAX_CHARGE);
  const angle = Math.atan2(body.ky, body.kx);
  assert.ok(angle < 0 && angle > -off, `angle ${angle}`);
});

test('a heavy aimed away from the wall does not recoil', () => {
  const { cs, body } = heavyAt(FLUSH, 500, 0, COMBAT.HEAVY.MAX_CHARGE);
  assert.equal(cs.recoil, false);
  assert.equal(body.kx, 0);
});

test('a heavy that stops short of the wall does not recoil', () => {
  const { cs, body } = heavyAt(130, 500, Math.PI, 0);
  assert.equal(cs.recoil, false);
  assert.equal(body.kx, 0);
});

test('a heavy recoils once, slowing at the recoil friction, until it stops', () => {
  const { cs, body, still } = heavyAt(FLUSH, 500, Math.PI, COMBAT.HEAVY.MAX_CHARGE);
  let kx = body.kx;
  stepFighter(cs, body, still);
  assert.ok(Math.abs(kx - body.kx - COMBAT.HEAVY.WALL_RECOIL_FRICTION * DT) < 1e-9, 'slower than normal friction');
  while (body.kx) {
    kx = body.kx;
    stepFighter(cs, body, still);
    assert.ok(body.kx < kx, 'only decays, never set again');
  }
  assert.equal(cs.recoil, false, 'cleared once it stops');
});

test('getting hit ends the recoil', () => {
  const { cs } = heavyAt(FLUSH, 500, Math.PI, COMBAT.HEAVY.MAX_CHARGE);
  applyHit(cs, { hitstun: 10, hitstop: 0 });
  assert.equal(cs.recoil, false);
});
