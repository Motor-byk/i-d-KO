import { COMBAT, PLAYER } from './constants.js';
import { STATE, moveTiming, phase } from './combat-state.js';

// Fist geometry, shared so the server hits with exactly the fists the client draws.
// Fists are indexed [left, right]; side -1 is left of the facing direction.

const SIDES = [-1, 1];

// Which hands a move throws: the jab string alternates, the finisher and the heavy throw both.
function hands(cs) {
  if (cs.state === STATE.HEAVY || cs.jab === COMBAT.JAB.length - 1) return [true, true];
  return [cs.jab % 2 === 0, cs.jab % 2 === 1];
}

// How far each fist is pushed out past its rest spot, as a share of the move's reach.
function extension(cs) {
  if (cs.state === STATE.CHARGE) return [-0.3, -0.3]; // drawn back
  const m = moveTiming(cs);
  if (!m) return [0, 0];
  let k;
  switch (phase(cs)) {
    case 'startup': k = -0.1; break; // wind up
    case 'active': k = 1; break;
    default: k = 1 - (cs.t - m.startup - m.active) / m.recovery;
  }
  return hands(cs).map((h) => (h ? k : 0));
}

// A fist ext of the way out: its angle and distance from the body center. A punching fist
// swings in toward the center line.
function fistAt(dir, side, ext, reach) {
  return {
    angle: dir + side * PLAYER.FIST_SPREAD * (1 - Math.max(0, ext) * 0.8),
    dist: PLAYER.RADIUS + 2 + ext * reach,
  };
}

const point = (x, y, { angle, dist }) => ({ x: x + Math.cos(angle) * dist, y: y + Math.sin(angle) * dist });

// Where both fists of a fighter at (x, y) are now. aim is the facing when not in a move or charging.
export function fists(cs, x, y, aim) {
  const m = moveTiming(cs);
  const dir = m || cs.state === STATE.CHARGE ? cs.dir : aim;
  const reach = m?.reach ?? COMBAT.HEAVY.reach;
  const ext = extension(cs);
  return SIDES.map((side, i) => point(x, y, fistAt(dir, side, ext[i], reach)));
}

// The current move's hitboxes, [] when not in a move: one capsule { a, b, r } per throwing fist,
// along its path from the body's edge out to full extension. They only hit in the active phase.
export function attackHitboxes(cs, x, y) {
  const m = moveTiming(cs);
  if (!m) return [];
  const h = hands(cs);
  const boxes = [];
  SIDES.forEach((side, i) => {
    if (!h[i]) return;
    const out = fistAt(cs.dir, side, 1, m.reach);
    boxes.push({ a: point(x, y, { angle: out.angle, dist: PLAYER.RADIUS }), b: point(x, y, out), r: PLAYER.FIST_HITBOX_RADIUS });
  });
  return boxes;
}

// Does the capsule touch the circle at c?
export function capsuleHitsCircle({ a, b, r }, c, radius) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(a.x + dx * t - c.x, a.y + dy * t - c.y) <= r + radius;
}
