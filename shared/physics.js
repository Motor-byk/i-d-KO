import { DT, PLAYER, COMBAT } from './constants.js';
import { sweepCircle, resolveCircle } from './arena.js';

// Shared movement step. The server runs it for everyone; the client runs it to predict itself.
// Shared, not bit-exact: fixed dt and a fixed collision order keep both sides close enough.

// A body: { x, y, vx, vy, kx, ky }. (vx, vy) is walking velocity, (kx, ky) is knockback
// velocity; they're kept apart so knockback decays on its own while the player steers.
export function createBody(x, y) {
  return { x, y, vx: 0, vy: 0, kx: 0, ky: 0 };
}

// Clamps a move vector to length <= 1. Non-finite input counts as no input.
export function clampMove(mx, my) {
  if (!Number.isFinite(mx) || !Number.isFinite(my)) return { x: 0, y: 0 };
  const len = Math.hypot(mx, my);
  return len > 1 ? { x: mx / len, y: my / len } : { x: mx, y: my };
}

function approach(value, target, maxDelta) {
  return value < target ? Math.min(value + maxDelta, target) : Math.max(value - maxDelta, target);
}

// Advances a body one tick. move: {x, y} with length <= 1. dash: unit direction or null;
// while dashing, the dash overrides walking. Returns the contact normals hit this tick.
export function stepBody(body, move, dash = null) {
  if (dash) {
    body.vx = dash.x * COMBAT.DASH.speed;
    body.vy = dash.y * COMBAT.DASH.speed;
  } else {
    const dv = PLAYER.ACCEL * DT;
    body.vx = approach(body.vx, move.x * PLAYER.MOVE_SPEED, dv);
    body.vy = approach(body.vy, move.y * PLAYER.MOVE_SPEED, dv);
  }

  // Knockback decays toward zero along its own direction.
  const k = Math.hypot(body.kx, body.ky);
  if (k > 0) {
    const scale = Math.max(0, k - PLAYER.FRICTION * DT) / k;
    body.kx *= scale;
    body.ky *= scale;
  }

  const res = sweepCircle(body.x, body.y, (body.vx + body.kx) * DT, (body.vy + body.ky) * DT, PLAYER.RADIUS);
  body.x = res.x;
  body.y = res.y;
  // Walls absorb velocity pointing into them so it doesn't build up against a surface.
  for (const n of res.normals) {
    for (const [ax, ay] of [['vx', 'vy'], ['kx', 'ky']]) {
      const into = body[ax] * n.x + body[ay] * n.y;
      if (into < 0) {
        body[ax] -= into * n.x;
        body[ay] -= into * n.y;
      }
    }
  }
  return res.normals;
}

// Server-only: pushes overlapping players apart (each moves half the overlap), then back out
// of walls. bodies must be in a stable order (e.g. by player id) for repeatable results.
export function separateBodies(bodies) {
  const minDist = PLAYER.RADIUS * 2;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d >= minDist) continue;
      // Exactly stacked: split along x so the result is still deterministic.
      const nx = d ? dx / d : 1;
      const ny = d ? dy / d : 0;
      const push = (minDist - d) / 2;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
    }
  }
  for (const body of bodies) resolveCircle(body, PLAYER.RADIUS);
}
