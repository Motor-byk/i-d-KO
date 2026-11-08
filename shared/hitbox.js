import { COMBAT, PLAYER } from './constants.js';
import { STATE, moveTiming, phase } from './combat-state.js';

// Fist geometry, shared so the server hits with exactly the fists the client draws.
// Fists are indexed [left, right]; side -1 is left of the facing direction.

const SIDES = [-1, 1];
const FINISHER = COMBAT.JAB.length - 1;

// The finisher is a clap: both fists wind out wide in startup and swing in to the aim line.
const isClap = (cs) => cs.state === STATE.JAB && cs.jab === FINISHER;

// Which hands a move throws: the jab string alternates, the finisher and the heavy throw both.
function hands(cs) {
  if (cs.state === STATE.HEAVY || isClap(cs)) return [true, true];
  return [cs.jab % 2 === 0, cs.jab % 2 === 1];
}

// How far each fist is pushed out past its rest spot, as a share of the move's reach.
function extension(cs) {
  if (cs.state === STATE.CHARGE) return [-0.3, -0.3]; // drawn back
  const m = moveTiming(cs);
  if (!m) return [0, 0];
  let k;
  switch (phase(cs)) {
    case 'startup': k = isClap(cs) ? (cs.t + 1) / m.startup : -0.1; break; // wind up (the clap reaches out wide)
    case 'active': k = 1; break;
    default: k = 1 - (cs.t - m.startup - m.active) / m.recovery;
  }
  return hands(cs).map((h) => (h ? k : 0));
}

// Angle of a fist ext of the way out: a punching fist swings in toward the center line.
const punchAngle = (dir, side, ext) => dir + side * PLAYER.FIST_SPREAD * (1 - Math.max(0, ext) * 0.8);

// How far the clap's fists are angled off the aim line: half the sweep through startup, then in
// to the line by the last active tick. Null in recovery, where its fists pull back like a punch's.
function clapSwing(cs) {
  const { startup, active } = COMBAT.JAB[FINISHER];
  const i = cs.t - startup;
  if (i >= active) return null;
  return (COMBAT.JAB_FINISHER_SWEEP / 2) * (1 - Math.max(0, i) / Math.max(1, active - 1));
}

function fistAngle(cs, dir, side, ext) {
  const swing = isClap(cs) ? clapSwing(cs) : null;
  return swing === null ? punchAngle(dir, side, ext) : dir + side * swing;
}
const fistDist = (ext, reach) => PLAYER.RADIUS + 2 + ext * reach;
const polar = (x, y, angle, dist) => ({ x: x + Math.cos(angle) * dist, y: y + Math.sin(angle) * dist });

// Where both fists of a fighter at (x, y) are now. aim is the facing when not in a move or charging.
export function fists(cs, x, y, aim) {
  const m = moveTiming(cs);
  const dir = m || cs.state === STATE.CHARGE ? cs.dir : aim;
  const reach = m?.reach ?? COMBAT.HEAVY.reach;
  const ext = extension(cs);
  return SIDES.map((side, i) => polar(x, y, fistAngle(cs, dir, side, ext[i]), fistDist(ext[i], reach)));
}

// The current move's hitboxes, [] when not in a move: one capsule { a, b, r } per throwing fist,
// along its path from the body's edge out to full extension. They only hit in the active phase,
// and the clap's swing in toward the aim line over its active ticks (the attacker's hitIds stop double hits).
export function attackHitboxes(cs, x, y) {
  const m = moveTiming(cs);
  if (!m) return [];
  const h = hands(cs);
  return SIDES.flatMap((side, i) => {
    if (!h[i]) return [];
    const angle = fistAngle(cs, cs.dir, side, 1);
    return [{ a: polar(x, y, angle, PLAYER.RADIUS), b: polar(x, y, angle, fistDist(1, m.reach)), r: PLAYER.FIST_HITBOX_RADIUS }];
  });
}

// Does the capsule touch the circle at c?
export function capsuleHitsCircle({ a, b, r }, c, radius) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / len2)) : 0;
  const ex = a.x + dx * t - c.x;
  const ey = a.y + dy * t - c.y;
  return ex * ex + ey * ey <= (r + radius) ** 2;
}
