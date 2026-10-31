import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assistAim, resolveHits } from '../server/game/combat.js';
import { createCombat, stepCombat, phase, isParrying, STATE } from '../shared/combat-state.js';
import { createBody } from '../shared/physics.js';
import { COMBAT, PLAYER, BUTTONS } from '../shared/constants.js';

const fighter = (id, teamId, x, y) => ({
  id, teamId, body: createBody(x, y), cs: createCombat(), hp: PLAYER.BASE_HP, alive: true, hitIds: new Set(),
});

// Starts a jab facing dir and steps it into its active frames.
function jabActive(f, dir = 0) {
  stepCombat(f.cs, { pressed: BUTTONS.JAB, aim: dir });
  while (phase(f.cs) !== 'active') stepCombat(f.cs, {});
}

const gap = (reach) => PLAYER.RADIUS * 2 + reach; // center distance at the edge of reach

test('a jab in reach damages, stuns and pushes an enemy once per move', () => {
  const a = fighter(1, 1, 500, 500);
  const b = fighter(2, 2, 500 + gap(COMBAT.JAB[0].reach) - 1, 500);
  jabActive(a);
  const [hit] = resolveHits([a, b]);
  assert.equal(hit.damage, COMBAT.JAB[0].damage);
  assert.equal(b.hp, PLAYER.BASE_HP - COMBAT.JAB[0].damage);
  assert.equal(b.cs.state, STATE.HITSTUN);
  assert.equal(b.cs.hitstop, COMBAT.JAB[0].hitstop);
  assert.equal(a.cs.hitstop, COMBAT.JAB[0].hitstop, 'the attacker freezes too');
  assert.ok(b.body.kx > 0 && Math.abs(b.body.ky) < 1e-9, 'pushed away from the attacker');
  assert.deepEqual(resolveHits([a, b]), [], 'the same move never hits twice');
});

test('a jab misses out of reach or behind the attacker', () => {
  const a = fighter(1, 1, 500, 500);
  const far = fighter(2, 2, 500 + gap(COMBAT.JAB[0].reach) + 1, 500);
  const behind = fighter(3, 2, 500 - PLAYER.RADIUS * 2 - 5, 500);
  jabActive(a);
  assert.deepEqual(resolveHits([a, far, behind]), []);
});

test('friendly fire only pushes', () => {
  const a = fighter(1, 1, 500, 500);
  const b = fighter(2, 1, 500 + PLAYER.RADIUS * 2 + 10, 500);
  jabActive(a);
  const [hit] = resolveHits([a, b]);
  assert.equal(hit.damage, 0);
  assert.equal(b.hp, PLAYER.BASE_HP);
  assert.equal(b.cs.state, STATE.IDLE);
  assert.equal(a.cs.hitstop, 0);
  assert.ok(b.body.kx > 0);
});

test('two jabs that meet on the same tick both land', () => {
  const a = fighter(1, 1, 500, 500);
  const b = fighter(2, 2, 500 + PLAYER.RADIUS * 2 + 10, 500);
  jabActive(a, 0);
  jabActive(b, Math.PI);
  assert.equal(resolveHits([a, b]).length, 2);
  assert.equal(a.cs.state, STATE.HITSTUN);
  assert.equal(b.cs.state, STATE.HITSTUN);
});

test('a fighter brought to 0 HP is KO', () => {
  const a = fighter(1, 1, 500, 500);
  const b = fighter(2, 2, 570, 500);
  b.hp = 1;
  jabActive(a);
  resolveHits([a, b]);
  assert.equal(b.hp, 0);
  assert.equal(b.alive, false);
});

test('aim assist snaps to the nearest enemy in the cone, ignoring teammates', () => {
  const a = fighter(1, 1, 500, 500);
  const mate = fighter(2, 1, 560, 500);
  const near = fighter(3, 2, 600, 540);
  const far = fighter(4, 2, 700, 480);
  const outside = fighter(5, 2, 500, 600); // 90 degrees off
  const all = [a, mate, near, far, outside];
  assert.ok(Math.abs(assistAim(a, all, 0) - Math.atan2(40, 100)) < 1e-9);
  assert.equal(assistAim(a, [a, mate, outside], 0.1), 0.1, 'nothing in the cone: keep the aim');
});

test('a well-charged heavy launches its target', () => {
  const a = fighter(1, 1, 500, 500);
  const b = fighter(2, 2, 580, 500);
  stepCombat(a.cs, { pressed: BUTTONS.HEAVY, held: BUTTONS.HEAVY });
  for (let i = 0; i < COMBAT.HEAVY.MAX_CHARGE; i++) stepCombat(a.cs, { held: BUTTONS.HEAVY });
  stepCombat(a.cs, { released: BUTTONS.HEAVY, aim: 0 });
  while (phase(a.cs) !== 'active') stepCombat(a.cs, {});
  const [hit] = resolveHits([a, b]);
  assert.equal(hit.damage, COMBAT.HEAVY.damageMax);
  assert.equal(b.cs.launched, true);
  assert.ok(Math.abs(b.body.kx - COMBAT.HEAVY.knockbackMax) < 1e-9);
});

test('a hit on a parrying enemy is parried: no damage, the attacker is stunned', () => {
  const a = fighter(1, 1, 500, 500);
  const b = fighter(2, 2, 570, 500);
  const c = fighter(3, 1, 640, 500); // a second attacker on b's other side, same tick
  stepCombat(b.cs, { pressed: BUTTONS.PARRY });
  jabActive(a, 0);
  jabActive(c, Math.PI);
  stepCombat(b.cs, {}); // keep b inside its window while the jabs reach active
  assert.ok(isParrying(b.cs));
  const hits = resolveHits([a, b, c]);
  assert.ok(hits.every((h) => h.parried));
  assert.equal(b.hp, PLAYER.BASE_HP);
  assert.equal(a.cs.state, STATE.STUNNED);
  assert.equal(c.cs.state, STATE.STUNNED, 'a parry holds against several hits at once');
  assert.equal(b.cs.state, STATE.IDLE);
});

test('a teammate hit ignores the parry and just pushes', () => {
  const a = fighter(1, 1, 500, 500);
  const b = fighter(2, 1, 570, 500);
  stepCombat(b.cs, { pressed: BUTTONS.PARRY });
  jabActive(a, 0);
  const [hit] = resolveHits([a, b]);
  assert.equal(hit.parried, false);
  assert.equal(a.cs.state, STATE.JAB);
});
