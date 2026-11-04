import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRing, ringRadius, applyRingDamage } from '../server/game/ring.js';
import { createBody } from '../shared/physics.js';
import { ARENA, DT, PLAYER, RING } from '../shared/constants.js';

const CX = ARENA.WIDTH / 2;
const CY = ARENA.HEIGHT / 2;
const fighter = (x, y, hp = PLAYER.BASE_HP) => ({ body: createBody(x, y), hp, alive: true });

test('the ring holds, then closes evenly, then stays closed', () => {
  const ring = matchRing();
  assert.equal(ringRadius(ring, 0), RING.START_RADIUS);
  assert.equal(ringRadius(ring, RING.START_TICK), RING.START_RADIUS);
  const middle = (RING.START_TICK + RING.CLOSE_TICK) / 2;
  assert.equal(ringRadius(ring, middle), (RING.START_RADIUS + RING.END_RADIUS) / 2);
  assert.equal(ringRadius(ring, RING.CLOSE_TICK), RING.END_RADIUS);
  assert.equal(ringRadius(ring, RING.CLOSE_TICK + 1000), RING.END_RADIUS);
});

test('the starting ring covers the whole arena', () => {
  assert.ok(RING.START_RADIUS >= Math.hypot(CX, CY));
});

test('only fighters outside the ring take damage', () => {
  const inside = fighter(CX + 99, CY);
  const edge = fighter(CX + 100, CY);
  const outside = fighter(CX + 101, CY);
  applyRingDamage([inside, edge, outside], 100);
  assert.equal(inside.hp, PLAYER.BASE_HP);
  assert.equal(edge.hp, PLAYER.BASE_HP);
  assert.equal(outside.hp, PLAYER.BASE_HP - RING.DAMAGE_PER_SECOND * DT);
});

test('the ring can KO, and leaves the dead alone', () => {
  const f = fighter(CX + 500, CY, RING.DAMAGE_PER_SECOND * DT);
  applyRingDamage([f], 100);
  assert.equal(f.hp, 0);
  assert.equal(f.alive, false);
  const hurt = { ...fighter(CX + 500, CY, 5), alive: false };
  applyRingDamage([hurt], 100);
  assert.equal(hurt.hp, 5);
});
