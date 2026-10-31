import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepCircle, resolveCircle, bounceVelocity } from '../shared/arena.js';
import { ARENA } from '../shared/constants.js';

const R = 30;
const center = ARENA.PILLARS[2]; // { x: 740, y: 440, w: 120, h: 120 }
const midY = center.y + center.h / 2;

test('a fast circle cannot tunnel through a pillar', () => {
  // 400 units in one call is far more than a pillar is wide.
  const res = sweepCircle(600, midY, 400, 0, R);
  assert.ok(Math.abs(res.x - (center.x - R)) < 1e-9, `x=${res.x}`);
  assert.equal(res.y, midY);
  assert.deepEqual(res.normals[0], { x: -1, y: 0 });
});

test('diagonal motion into a pillar slides along its face', () => {
  const res = sweepCircle(center.x - R - 5, midY, 40, 20, R);
  assert.ok(Math.abs(res.x - (center.x - R)) < 1e-9);
  assert.ok(Math.abs(res.y - (midY + 20)) < 1e-9, 'tangential motion is kept');
});

test('arena walls keep the circle inside', () => {
  const res = sweepCircle(50, 50, -500, -500, R);
  assert.deepEqual([res.x, res.y], [R, R]);
  assert.ok(res.normals.some((n) => n.x === 1));
  assert.ok(res.normals.some((n) => n.y === 1));
  const far = sweepCircle(ARENA.WIDTH - 50, ARENA.HEIGHT - 50, 500, 500, R);
  assert.deepEqual([far.x, far.y], [ARENA.WIDTH - R, ARENA.HEIGHT - R]);
});

test('a circle spawned inside a pillar is pushed out the nearest side', () => {
  const p = { x: center.x + 10, y: midY };
  const [n] = resolveCircle(p, R);
  assert.deepEqual(n, { x: -1, y: 0 });
  assert.equal(p.x, center.x - R);
});

test('corners push out diagonally', () => {
  const p = { x: center.x - 10, y: center.y - 10 };
  const [n] = resolveCircle(p, R);
  assert.ok(n.x < 0 && n.y < 0);
  assert.ok(Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - R) < 1e-9);
});

test('bounceVelocity reflects off the surface it moves into, scaled by restitution', () => {
  assert.deepEqual(bounceVelocity(800, 100, [{ x: -1, y: 0 }], 0.5), { vx: -400, vy: 50 });
  assert.equal(bounceVelocity(-800, 0, [{ x: -1, y: 0 }], 0.5), null, 'moving away: no bounce');
});
