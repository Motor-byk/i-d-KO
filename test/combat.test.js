import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assistAim, burstPush, resolveHits } from '../server/game/combat.js';
import { createCombat, stepCombat, phase, isParrying, hasArmor, chargeFraction, STATE } from '../shared/combat-state.js';
import { createBody } from '../shared/physics.js';
import { attackHitboxes } from '../shared/hitbox.js';
import { COMBAT, PLAYER, BUTTONS } from '../shared/constants.js';

const fighter = (id, teamId, x, y) => ({
  id, teamId, body: createBody(x, y), cs: createCombat(), hp: PLAYER.BASE_HP, damageMult: 1, alive: true, hitIds: new Set(),
});

// Starts a jab facing dir and steps it into its active frames.
function jabActive(f, dir = 0) {
  stepCombat(f.cs, { pressed: BUTTONS.JAB, aim: dir });
  while (phase(f.cs) !== 'active') stepCombat(f.cs, {});
}

// x of a target center just inside (-1) or outside (+1) the reach of an attacker's fist facing +x.
function edgeX(a, offset) {
  const [{ b, r }] = attackHitboxes(a.cs, a.body.x, a.body.y);
  return { x: b.x + r + PLAYER.RADIUS + offset, y: b.y };
}

test('a jab in reach damages, stuns and pushes an enemy once per move', () => {
  const a = fighter(1, 1, 500, 500);
  jabActive(a);
  const at = edgeX(a, -1);
  const b = fighter(2, 2, at.x, at.y);
  const [hit] = resolveHits([a, b]);
  assert.equal(hit.damage, COMBAT.JAB[0].damage);
  assert.equal(b.hp, PLAYER.BASE_HP - COMBAT.JAB[0].damage);
  assert.equal(b.cs.state, STATE.HITSTUN);
  assert.equal(b.cs.hitstop, COMBAT.JAB[0].hitstop);
  assert.equal(a.cs.hitstop, COMBAT.JAB[0].hitstop, 'the attacker freezes too');
  const away = Math.atan2(b.body.y - a.body.y, b.body.x - a.body.x);
  assert.ok(Math.abs(Math.atan2(b.body.ky, b.body.kx) - away) < 1e-9, 'pushed away from the attacker');
  assert.deepEqual(resolveHits([a, b]), [], 'the same move never hits twice');
});

test('a jab misses out of reach or behind the attacker', () => {
  const a = fighter(1, 1, 500, 500);
  jabActive(a);
  const at = edgeX(a, 1);
  const far = fighter(2, 2, at.x, at.y);
  const behind = fighter(3, 2, 500 - PLAYER.RADIUS * 2 - 5, 500);
  assert.deepEqual(resolveHits([a, far, behind]), []);
});

test('only the fist hits: a target off to the side misses, one hugging the attacker is hit', () => {
  const a = fighter(1, 1, 500, 500);
  const reach = PLAYER.RADIUS * 2 + COMBAT.JAB[0].reach; // the old cone hit anything in 60 degrees out to here
  const side = fighter(2, 2, 500 + Math.cos(Math.PI / 3) * reach, 500 + Math.sin(Math.PI / 3) * reach);
  jabActive(a);
  assert.deepEqual(resolveHits([a, side]), []);
  const close = fighter(3, 2, 500 + PLAYER.RADIUS * 2, 500);
  assert.equal(resolveHits([a, close]).length, 1);
});

test('a heavy throws both fists, so it hits on either side of its line but not past them', () => {
  const H = COMBAT.HEAVY;
  const a = fighter(1, 1, 500, 500);
  stepCombat(a.cs, { pressed: BUTTONS.HEAVY, held: 0, aim: 0 });
  while (phase(a.cs) !== 'active') stepCombat(a.cs, {});
  const boxes = attackHitboxes(a.cs, 500, 500);
  assert.equal(boxes.length, 2);
  assert.ok(boxes[0].b.y < 500 && boxes[1].b.y > 500, 'left fist above the line, right below');
  const wide = fighter(2, 2, 500 + PLAYER.RADIUS * 2 + H.reach / 2, 500 + boxes[1].b.y - 500 + boxes[1].r + PLAYER.RADIUS + 1);
  assert.deepEqual(resolveHits([a, wide]), []);
});

// Starts b charging a heavy facing left and holds it until its armor is up.
function chargeToArmor(b) {
  stepCombat(b.cs, { pressed: BUTTONS.HEAVY, held: BUTTONS.HEAVY, aim: Math.PI });
  while (!hasArmor(b.cs)) stepCombat(b.cs, { held: BUTTONS.HEAVY });
}

test('a hit on an armored charger damages and pushes but does not stun it', () => {
  const a = fighter(1, 1, 500, 500);
  const b = fighter(2, 2, 500 + PLAYER.RADIUS * 2 + 10, 500);
  chargeToArmor(b);
  assert.ok(chargeFraction(b.cs.t) >= COMBAT.HEAVY.ARMOR_FROM);
  jabActive(a);
  const [hit] = resolveHits([a, b]);
  assert.equal(hit.damage, COMBAT.JAB[0].damage);
  assert.equal(b.hp, PLAYER.BASE_HP - COMBAT.JAB[0].damage);
  assert.equal(b.cs.state, STATE.CHARGE, 'still charging');
  assert.equal(b.cs.armorTaken, COMBAT.JAB[0].damage);
  assert.equal(b.cs.hitstop, 0);
  assert.equal(b.cs.combo, 0);
  assert.ok(b.body.kx > 0, 'pushed');
  assert.equal(a.cs.hitstop, COMBAT.JAB[0].hitstop, 'the attacker still freezes on the hit');
  stepCombat(b.cs, { released: BUTTONS.HEAVY });
  assert.equal(b.cs.state, STATE.HEAVY, 'the heavy still fires on release');
});

test('an early charge, before the armor, is stunned', () => {
  const a = fighter(1, 1, 500, 500);
  const b = fighter(2, 2, 500 + PLAYER.RADIUS * 2 + 10, 500);
  stepCombat(b.cs, { pressed: BUTTONS.HEAVY, held: BUTTONS.HEAVY, aim: Math.PI });
  assert.equal(hasArmor(b.cs), false);
  jabActive(a);
  resolveHits([a, b]);
  assert.equal(b.cs.state, STATE.HITSTUN);
});

test('the hit that takes the armor to its limit breaks it and stuns', () => {
  const a = fighter(1, 1, 500, 500);
  const b = fighter(2, 2, 500 + PLAYER.RADIUS * 2 + 10, 500);
  chargeToArmor(b);
  b.cs.armorTaken = COMBAT.HEAVY.ARMOR_LIMIT - COMBAT.JAB[0].damage - 1;
  jabActive(a);
  resolveHits([a, b]);
  assert.equal(b.cs.state, STATE.CHARGE, 'one short of the limit: holds');
  a.cs = createCombat();
  a.hitIds.clear();
  jabActive(a);
  resolveHits([a, b]);
  assert.equal(b.cs.state, STATE.HITSTUN, 'over the limit: broken');
  assert.equal(b.cs.armorTaken, 0, 'a new charge starts with fresh armor');
});

test('two hits in one tick that cross the armor limit together break it', () => {
  const a = fighter(1, 1, 500, 500);
  const c = fighter(3, 1, 500, 500 + PLAYER.RADIUS * 2 + 10);
  const b = fighter(2, 2, 500 + PLAYER.RADIUS * 2 + 10, 500 + PLAYER.RADIUS + 5);
  chargeToArmor(b);
  b.cs.armorTaken = COMBAT.HEAVY.ARMOR_LIMIT - COMBAT.JAB[0].damage - 1; // one jab holds, two break
  jabActive(a, Math.atan2(b.body.y - a.body.y, b.body.x - a.body.x));
  jabActive(c, Math.atan2(b.body.y - c.body.y, b.body.x - c.body.x));
  assert.equal(resolveHits([a, b, c]).filter((h) => h.target === b).length, 2);
  assert.equal(b.cs.state, STATE.HITSTUN);
});

test('a fired heavy in startup is stunned as usual', () => {
  const a = fighter(1, 1, 500, 500);
  const b = fighter(2, 2, 500 + PLAYER.RADIUS * 2 + 10, 500);
  stepCombat(b.cs, { pressed: BUTTONS.HEAVY, held: 0, aim: Math.PI });
  while (b.cs.state !== STATE.HEAVY) stepCombat(b.cs, {});
  jabActive(a);
  resolveHits([a, b]);
  assert.equal(b.cs.state, STATE.HITSTUN);
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

test('invulnerable fighters cannot be hit', () => {
  const a = fighter(1, 1, 500, 500);
  const b = fighter(2, 2, 570, 500);
  b.cs.invuln = 5;
  jabActive(a);
  assert.deepEqual(resolveHits([a, b]), []);
});

test('a burst pushes everyone nearby away', () => {
  const v = fighter(1, 1, 500, 500);
  const near = fighter(2, 2, 600, 500);
  const far = fighter(3, 2, 500 + COMBAT.BURST_RADIUS + 1, 520);
  burstPush(v, [v, near, far]);
  assert.equal(near.body.kx, COMBAT.BURST_PUSH);
  assert.equal(far.body.kx, 0);
});

test('two enemy hits on one target in one tick both deal damage but count as one combo step', () => {
  const t = fighter(1, 1, 500, 500);
  const a = fighter(2, 2, 430, 500);
  const b = fighter(3, 2, 570, 500);
  for (const [f, dir] of [[a, 0], [b, Math.PI]]) {
    Object.assign(f.cs, { state: STATE.JAB, jab: 2, t: COMBAT.JAB[2].startup, dir }); // the finisher, active
  }
  const hits = resolveHits([t, a, b]);
  assert.equal(hits.length, 2);
  assert.equal(t.hp, PLAYER.BASE_HP - 2 * COMBAT.JAB[2].damage);
  assert.equal(t.cs.combo, 1);
  assert.equal(t.cs.len, COMBAT.JAB[2].hitstun);
});

test('a burst push cancels a launch', () => {
  const v = fighter(1, 1, 500, 500);
  const near = fighter(2, 2, 600, 500);
  near.cs.launched = true;
  burstPush(v, [v, near]);
  assert.equal(near.cs.launched, false);
});

test('one jab hitting two enemies counts once toward the string', () => {
  const a = fighter(1, 1, 500, 500);
  const b = fighter(2, 2, 570, 490);
  const c = fighter(3, 2, 570, 510);
  jabActive(a);
  resolveHits([a, b, c]);
  assert.equal(a.cs.stringHits, 1);
});

test('parried and friendly hits do not count toward the string', () => {
  const a = fighter(1, 1, 500, 500);
  const mate = fighter(2, 1, 570, 500);
  jabActive(a);
  resolveHits([a, mate]);
  assert.equal(a.cs.stringHits, 0);
});
