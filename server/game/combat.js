import { COMBAT, PLAYER } from '../../shared/constants.js';
import { applyHit, applyHitstop, applyParry, isParrying, moveFrames, phase } from '../../shared/combat-state.js';

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

// Sets target's knockback to speed, straight away from `from` (along fallbackAngle if stacked).
function push(from, target, speed, fallbackAngle) {
  const dx = target.body.x - from.body.x;
  const dy = target.body.y - from.body.y;
  const d = Math.hypot(dx, dy);
  const [nx, ny] = d > 1e-6 ? [dx / d, dy / d] : [Math.cos(fallbackAngle), Math.sin(fallbackAngle)];
  target.body.kx = nx * speed;
  target.body.ky = ny * speed;
}

// Finds every hit this tick, then applies them all, so two attacks that trade both land.
// Each move hits a target at most once (attacker.hitIds is cleared when a move starts).
// An enemy hit on a parrying target is parried instead (judged on state from before this
// tick's hits, so a parry holds against several at once). Friendly fire ignores parries.
// Several enemy hits on one target in the same tick all deal damage, but stun and push it
// once, with the strongest of them, so they count as one combo step.
// Returns the hits as [{ attacker, target, damage, parried }].
export function resolveHits(fighters) {
  const hits = [];
  const parrying = new Set(fighters.filter((f) => f.alive && isParrying(f.cs)));
  for (const a of fighters) {
    if (!a.alive || phase(a.cs) !== 'active') continue;
    const m = moveFrames(a.cs);
    for (const t of fighters) {
      if (t === a || !t.alive || t.cs.invuln > 0 || a.hitIds.has(t.id)) continue;
      if (!inReach(a.body, t.body, a.cs.dir, m.reach)) continue;
      a.hitIds.add(t.id);
      hits.push({ attacker: a, target: t, move: m });
    }
  }
  const strongest = new Map(); // target -> the enemy hit that stuns it this tick
  const results = hits.map(({ attacker, target, move }) => {
    const friendly = attacker.teamId === target.teamId;
    const parried = !friendly && parrying.has(target);
    let damage = 0;
    if (parried) {
      applyParry(target.cs, attacker.cs);
    } else if (friendly) {
      // Friendly fire is knockback only: no damage, hitstun or hitstop.
      push(attacker, target, move.knockback, attacker.cs.dir);
    } else {
      damage = move.damage;
      target.hp = Math.max(0, target.hp - damage);
      if (target.hp === 0) target.alive = false;
      applyHitstop(attacker.cs, move.hitstop);
      const best = strongest.get(target);
      if (!best || move.hitstun > best.move.hitstun) strongest.set(target, { attacker, move });
    }
    return { attacker, target, damage, parried };
  });
  for (const [target, { attacker, move }] of strongest) {
    push(attacker, target, move.knockback, attacker.cs.dir);
    applyHit(target.cs, move);
  }
  return results;
}

// A fighter bursting out of a combo shoves everyone near it away (knockback only). The shove
// replaces any launch, so it can't wall bounce someone into a longer combo.
export function burstPush(burster, fighters) {
  for (const f of fighters) {
    if (f === burster || !f.alive) continue;
    const dx = f.body.x - burster.body.x;
    const dy = f.body.y - burster.body.y;
    const d = Math.hypot(dx, dy);
    if (d > COMBAT.BURST_RADIUS) continue;
    const [nx, ny] = d > 1e-6 ? [dx / d, dy / d] : [1, 0];
    f.body.kx = nx * COMBAT.BURST_PUSH;
    f.body.ky = ny * COMBAT.BURST_PUSH;
    f.cs.launched = false;
  }
}
