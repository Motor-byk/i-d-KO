import { COMBAT, PLAYER } from './constants.js';
import { STATE, moveTiming, phase } from './combat-state.js';
import { lerp } from './math.js';

// Fist geometry, shared so the server hits with exactly the fists the client draws.
// Fists are indexed [left, right]; side -1 is left of the facing direction.

const SIDES = [-1, 1];
const FINISHER = COMBAT.JAB.length - 1;

// The finisher is a clap: both fists wind out wide in startup and swing in to the aim line.
const isClap = (cs) => cs.state === STATE.JAB && cs.jab === FINISHER;

// Which hands a move throws: the jab string alternates, the finisher, spin and heavy throw both.
function hands(cs) {
  if (cs.state === STATE.HEAVY || cs.state === STATE.SPIN || isClap(cs)) return [true, true];
  return [cs.jab % 2 === 0, cs.jab % 2 === 1];
}

// How far each fist is pushed out past its rest spot, as a share of the move's reach.
function extension(cs) {
  if (cs.state === STATE.CHARGE) return [-0.3, -0.3]; // drawn back
  const m = moveTiming(cs);
  if (!m) return [0, 0];
  let k;
  switch (phase(cs)) {
    case 'startup': k = isClap(cs) || cs.state === STATE.SPIN ? (cs.t + 1) / m.startup : -0.1; break; // wind up (the clap and spin reach out)
    case 'active': k = 1; break;
    default: k = 1 - (cs.t - m.startup - m.active) / m.recovery;
  }
  return hands(cs).map((h) => (h ? k : 0));
}

// Angle of a fist ext of the way out: a punching fist swings in toward the center line.
const punchAngle = (dir, side, ext) => dir + side * PLAYER.FIST_SPREAD * (1 - Math.max(0, ext) * 0.8);

// How far the clap's fists are angled off the aim line: half the sweep through startup, then in
// to the line by the last active tick. Null outside the clap's startup and active ticks (in its
// recovery the fists pull back like a punch's).
function clapSwing(cs) {
  if (!isClap(cs)) return null;
  const { startup, active } = COMBAT.JAB[FINISHER];
  const i = cs.t - startup;
  if (i >= active) return null;
  return (COMBAT.JAB_FINISHER_SWEEP / 2) * (1 - Math.max(0, i) / Math.max(1, active - 1));
}

// The spin's fists open from their rest spread to opposite sides as they reach out, and orbit
// the body once over its startup and active ticks.
function spinAngle(cs, dir, side, ext) {
  const { startup, active } = COMBAT.SPIN;
  const spread = lerp(PLAYER.FIST_SPREAD, Math.PI / 2, Math.max(0, ext));
  return dir + side * spread + 2 * Math.PI * Math.min(1, (cs.t + 1) / (startup + active));
}

function fistAngle(cs, dir, side, ext) {
  if (cs.state === STATE.SPIN) return spinAngle(cs, dir, side, ext);
  const swing = clapSwing(cs);
  return swing === null ? punchAngle(dir, side, ext) : dir + side * swing;
}
const fistDist = (ext, reach) => PLAYER.RADIUS + 2 + ext * reach;
const polar = (x, y, angle, dist) => ({ x: x + Math.cos(angle) * dist, y: y + Math.sin(angle) * dist });

// Where both fists of a fighter at (x, y) are now. aim is the facing when not in a move or charging.
export function fists(cs, x, y, aim) {
  const m = moveTiming(cs);
  const dir = m || cs.state === STATE.CHARGE ? cs.dir : aim;
  const reach = m?.reach ?? COMBAT.HEAVY.reachMax; // charging: drawn back for a full heavy
  const ext = extension(cs);
  return SIDES.map((side, i) => polar(x, y, fistAngle(cs, dir, side, ext[i]), fistDist(ext[i], reach)));
}

// Radius of the spin's hitbox, a circle around the body.
export const SPIN_HITBOX_RADIUS = PLAYER.RADIUS + COMBAT.SPIN.reach;

// The current move's hitboxes, [] when not in a move: one capsule { a, b, r } per throwing fist,
// along its path from the body's edge out to full extension. They only hit in the active phase,
// and the clap's fists swing in toward the aim line over its active ticks (the attacker's hitIds stop double hits).
// The spin's is a single circle around the body (a capsule with both ends at the center).
export function attackHitboxes(cs, x, y) {
  const m = moveTiming(cs);
  if (!m) return [];
  if (cs.state === STATE.SPIN) return [{ a: { x, y }, b: { x, y }, r: SPIN_HITBOX_RADIUS }];
  const h = hands(cs);
  return SIDES.flatMap((side, i) => {
    if (!h[i]) return [];
    const angle = fistAngle(cs, cs.dir, side, 1);
    return [{ a: polar(x, y, angle, PLAYER.RADIUS), b: polar(x, y, angle, fistDist(1, m.reach)), r: PLAYER.FIST_HITBOX_RADIUS }];
  });
}

// Does any of the hitboxes touch a fighter's body at `at`?
export const hitsBody = (boxes, at) => boxes.some((box) => capsuleHitsCircle(box, at, PLAYER.RADIUS));

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
