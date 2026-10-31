import { COMBAT, PLAYER } from '../../shared/constants.js';
import { applyHit, applyHitstop, moveFrames, phase } from '../../shared/combat-state.js';

// Server-only hit detection and resolution. Fighters: { id, teamId, body, cs, hp, alive, hitIds }.

const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// Tap attacks snap to the nearest enemy inside the assist cone around aim; else aim is kept.
export function assistAim(attacker, fighters, aim) {
  let best = null;
  let bestDist = COMBAT.AIM_ASSIST_RANGE;
  for (const f of fighters) {
    if (!f.alive || f.teamId === attacker.teamId) continue;
    const dx = f.body.x - attacker.body.x;
    const dy = f.body.y - attacker.body.y;
    const dist = Math.hypot(dx, dy);
    if (dist > bestDist) continue;
    const angle = Math.atan2(dy, dx);
    if (Math.abs(angleDiff(angle, aim)) > COMBAT.AIM_ASSIST_CONE / 2) continue;
    best = angle;
    bestDist = dist;
  }
  return best ?? aim;
}

// Does the attacker's move, facing dir with this reach, touch the target's circle?
function inReach(a, b, dir, reach) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  if (dist - PLAYER.RADIUS * 2 > reach) return false;
  if (dist < 1e-6) return true;
  // Widen the arc by the target's angular size, so grazing its edge counts.
  const slack = Math.asin(Math.min(1, PLAYER.RADIUS / dist));
  return Math.abs(angleDiff(Math.atan2(dy, dx), dir)) <= COMBAT.HIT_ARC / 2 + slack;
}

// Finds every hit this tick, then applies them all, so two attacks that trade both land.
// Each move hits a target at most once (attacker.hitIds is cleared when a move starts).
// Returns the hits as [{ attacker, target, damage }].
export function resolveHits(fighters) {
  const hits = [];
  for (const a of fighters) {
    if (!a.alive || phase(a.cs) !== 'active') continue;
    const m = moveFrames(a.cs);
    for (const t of fighters) {
      if (t === a || !t.alive || a.hitIds.has(t.id)) continue;
      if (!inReach(a.body, t.body, a.cs.dir, m.reach)) continue;
      a.hitIds.add(t.id);
      hits.push({ attacker: a, target: t, move: m });
    }
  }
  return hits.map(({ attacker, target, move }) => {
    const friendly = attacker.teamId === target.teamId;
    const dx = target.body.x - attacker.body.x;
    const dy = target.body.y - attacker.body.y;
    const d = Math.hypot(dx, dy);
    const [nx, ny] = d > 1e-6 ? [dx / d, dy / d] : [Math.cos(attacker.cs.dir), Math.sin(attacker.cs.dir)];
    target.body.kx = nx * move.knockback;
    target.body.ky = ny * move.knockback;
    // Friendly fire is knockback only: no damage, hitstun or hitstop.
    if (friendly) return { attacker, target, damage: 0 };
    target.hp = Math.max(0, target.hp - move.damage);
    if (target.hp === 0) target.alive = false;
    applyHit(target.cs, move);
    applyHitstop(attacker.cs, move.hitstop);
    return { attacker, target, damage: move.damage };
  });
}
