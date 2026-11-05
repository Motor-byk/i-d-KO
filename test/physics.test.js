import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBody, stepBody, separateBodies } from '../shared/physics.js';
import { PLAYER, COMBAT, DT, ARENA } from '../shared/constants.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('walking accelerates to move speed and stops again', () => {
  const b = createBody(200, 150);
  for (let i = 0; i < 30; i++) stepBody(b, { x: 1, y: 0 });
  assert.equal(b.vx, PLAYER.MOVE_SPEED);
  for (let i = 0; i < 30; i++) stepBody(b, { x: 0, y: 0 });
  assert.equal(b.vx, 0);
});

test('knockback decays to zero on its own', () => {
  const b = createBody(800, 150);
  b.kx = 600;
  stepBody(b, { x: 0, y: 0 });
  assert.ok(near(b.kx, 600 - PLAYER.FRICTION * DT));
  for (let i = 0; i < 30; i++) stepBody(b, { x: 0, y: 0 });
  assert.equal(b.kx, 0);
});

test('dash overrides walking and cannot tunnel through a pillar', () => {
  const pillar = ARENA.PILLARS[2];
  const b = createBody(pillar.x - 200, pillar.y + pillar.h / 2);
  for (let i = 0; i < COMBAT.DASH.duration * 3; i++) stepBody(b, { x: -1, y: 0 }, { x: 1, y: 0 });
  assert.ok(near(b.x, pillar.x - PLAYER.RADIUS), `x=${b.x}`);
  assert.equal(b.vx, 0, 'velocity into the pillar is absorbed');
});

test('same inputs give the same result (replayable for prediction)', () => {
  const run = () => {
    const b = createBody(100, 100);
    b.kx = 900;
    b.ky = -300;
    for (let i = 0; i < 60; i++) stepBody(b, { x: Math.sin(i), y: Math.cos(i) }, i % 20 < 6 ? { x: 0, y: 1 } : null);
    return b;
  };
  assert.deepEqual(run(), run());
});

test('separateBodies pushes overlapping players apart, even when stacked', () => {
  const a = createBody(200, 150);
  const b = createBody(200, 150);
  const c = createBody(210, 150);
  separateBodies([a, b, c]);
  for (const [p, q] of [[a, b], [a, c], [b, c]]) {
    assert.ok(Math.hypot(p.x - q.x, p.y - q.y) > PLAYER.RADIUS, 'no longer deeply overlapping');
  }
  const x = createBody(500, 150);
  const y = createBody(530, 150);
  separateBodies([x, y]);
  assert.ok(near(y.x - x.x, PLAYER.RADIUS * 2));
});
