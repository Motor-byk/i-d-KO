import { COMBAT, PLAYER } from '../../shared/constants.js';
import { applyHit, applyLanded, applyParry, isParrying, moveFrames, phase, STATE } from '../../shared/combat-state.js';

// Server-only hit detection and resolution. Fighters: { id, teamId, body, cs, hp, alive, hitIds }.

const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// Un-aimed jabs snap to the nearest enemy inside the assist cone around aim; else aim is kept.
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
// Reach is checked against seen(attacker, target): where the attacker saw the target (lag
// compensation), the target's current position by default.
// An enemy hit on an idle target keeps what it undid in target.grace for parryGrace().
// Returns the hits as [{ attacker, target, damage, parried }].
export function resolveHits(fighters, { tick = 0, seen = (a, t) => t.body } = {}) {
  const hits = [];
  const parrying = new Set(fighters.filter((f) => f.alive && isParrying(f.cs)));
  for (const a of fighters) {
    if (!a.alive || phase(a.cs) !== 'active') continue;
    const m = moveFrames(a.cs);
    for (const t of fighters) {
      if (t === a || !t.alive || t.cs.invuln > 0 || a.hitIds.has(t.id)) continue;
      if (!inReach(a.body, seen(a, t), a.cs.dir, m.reach)) continue;
      a.hitIds.add(t.id);
      hits.push({ attacker: a, target: t, move: m });
    }
  }
  for (const { attacker, target } of hits) {
    if (attacker.teamId === target.teamId || parrying.has(target)) continue;
    if (target.cs.state === STATE.IDLE && !inGrace(target, tick)) {
      const { cs, hp, body: { kx, ky } } = target;
      target.grace = { tick, cs: structuredClone(cs), hp, kx, ky, attackers: new Set() };
    }
    if (inGrace(target, tick)) target.grace.attackers.add(attacker);
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
      applyLanded(attacker.cs, move.hitstop);
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

const inGrace = (f, tick) => !!f.grace && tick - f.grace.tick <= COMBAT.PARRY.grace;

// Parry grace: a parry pressed up to COMBAT.PARRY.grace ticks after enemy hits landed on an idle
// fighter (so it could have parried) still parries them. The hits are undone (hp, combat
// state, knockback) and every attacker in them is stunned. A KO is final. Returns true if it parried.
export function parryGrace(f, tick) {
  const grace = f.grace;
  f.grace = null;
  if (!f.alive || !grace || tick - grace.tick > COMBAT.PARRY.grace) return false;
  Object.assign(f.cs, grace.cs);
  f.hp = grace.hp;
  f.body.kx = grace.kx;
  f.body.ky = grace.ky;
  for (const a of grace.attackers) applyParry(f.cs, a.cs);
  return true;
}

// A fighter bursting out of a combo shoves everyone near it away (knockback only). The shove
// replaces any launch, so it can't wall bounce someone into a longer combo.
export function burstPush(burster, fighters) {
  for (const f of fighters) {
    if (f === burster || !f.alive) continue;
    if (Math.hypot(f.body.x - burster.body.x, f.body.y - burster.body.y) > COMBAT.BURST_RADIUS) continue;
    push(burster, f, COMBAT.BURST_PUSH, 0);
    f.cs.launched = false;
  }
}
