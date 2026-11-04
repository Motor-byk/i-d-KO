import { ARENA, DT, RING } from '../../shared/constants.js';
import { lerp } from '../../shared/math.js';

// The shrinking ring: a circle around the arena's center. A schedule says when it closes and
// between which radii, so a mode can swap it (sudden death). Fighters outside take damage.

export const matchRing = () => ({
  fromTick: RING.START_TICK,
  toTick: RING.CLOSE_TICK,
  fromRadius: RING.START_RADIUS,
  toRadius: RING.END_RADIUS,
});

export const suddenDeathRing = (tick) => ({
  fromTick: tick,
  toTick: tick + RING.SUDDEN_DEATH_CLOSE_TICKS,
  fromRadius: RING.SUDDEN_DEATH_RADIUS,
  toRadius: RING.END_RADIUS,
});

export function ringRadius({ fromTick, toTick, fromRadius, toRadius }, tick) {
  const k = Math.max(0, Math.min(1, (tick - fromTick) / (toTick - fromTick)));
  return lerp(fromRadius, toRadius, k);
}

// Damages every living fighter whose center is outside the radius. Can KO. Ignores invulnerability
// and parries: nothing stops the ring.
export function applyRingDamage(fighters, radius) {
  for (const f of fighters) {
    if (!f.alive) continue;
    if (Math.hypot(f.body.x - ARENA.WIDTH / 2, f.body.y - ARENA.HEIGHT / 2) <= radius) continue;
    f.hp = Math.max(0, f.hp - RING.DAMAGE_PER_SECOND * DT);
    if (f.hp === 0) f.alive = false;
  }
}
