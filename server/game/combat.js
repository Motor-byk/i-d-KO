import { COMBAT, PLAYER } from '../../shared/constants.js';
import { applyHit, applyLanded, applyParry, hasArmor, isParrying, moveFrames, phase, STATE } from '../../shared/combat-state.js';
import { attackHitboxes, capsuleHitsCircle } from '../../shared/hitbox.js';

// Server-only hit detection and resolution. Fighters: { id, teamId, body, cs, hp, damageMult, alive, hitIds }.

const KO_EPSILON = 1e-6;

// Sets target's knockback to speed, straight away from `from` (along fallbackAngle if stacked).
function push(from, target, speed, fallbackAngle) {
  const dx = target.body.x - from.body.x;
  const dy = target.body.y - from.body.y;
  const d = Math.hypot(dx, dy);
  const [nx, ny] = d > 1e-6 ? [dx / d, dy / d] : [Math.cos(fallbackAngle), Math.sin(fallbackAngle)];
  target.body.kx = nx * speed;
  target.body.ky = ny * speed;
  target.cs.recoil = false; // the push replaces a wall recoil's slide, so it decays at normal friction
}

// Takes HP away, and KOs at (nearly) none: fractional damage can leave a float crumb behind.
export function hurt(f, damage) {
  f.hp -= damage;
  if (f.hp < KO_EPSILON) {
    f.hp = 0;
    f.alive = false;
  }
}

const inGrace = (f, tick) => !!f.grace && tick - f.grace.tick <= COMBAT.PARRY.grace;

// Finds every hit this tick, then applies them all, so two attacks that trade both land.
// Each move hits a target at most once (attacker.hitIds is cleared when a move starts).
// An enemy hit on a parrying target is parried instead (judged on state from before this
// tick's hits, so a parry holds against several at once). Friendly fire ignores parries.
// Several enemy hits on one target in the same tick all deal damage, but stun and push it
// once, with the strongest of them, so they count as one combo step. An armored target (charging
// a heavy, hasArmor) takes the damage and push but no stun, until the damage breaks the armor.
// The attacker's fist hitboxes (shared/hitbox.js) are checked against seen(attacker, target):
// where the attacker saw the target (lag compensation), its current position by default.
// An enemy hit on an idle target keeps what it undid in target.grace for parryGrace().
// Returns the hits as [{ attacker, target, damage, parried }].
export function resolveHits(fighters, { tick = 0, seen = (a, t) => t.body } = {}) {
  const hits = [];
  const parrying = new Set(fighters.filter((f) => f.alive && isParrying(f.cs)));
  for (const a of fighters) {
    if (!a.alive || phase(a.cs) !== 'active') continue;
    const m = moveFrames(a.cs);
    const boxes = attackHitboxes(a.cs, a.body.x, a.body.y);
    for (const t of fighters) {
      if (t === a || !t.alive || t.cs.invuln > 0 || a.hitIds.has(t.id)) continue;
      const at = seen(a, t);
      if (!boxes.some((box) => capsuleHitsCircle(box, at, PLAYER.RADIUS))) continue;
      a.hitIds.add(t.id);
      hits.push({ attacker: a, target: t, move: m });
    }
  }
  for (const { attacker, target } of hits) {
    if (attacker.teamId === target.teamId || parrying.has(target)) continue;
    if (target.cs.state === STATE.IDLE && !inGrace(target, tick)) {
      const { cs, body: { kx, ky } } = target;
      target.grace = { tick, cs: structuredClone(cs), kx, ky, damage: 0, attackers: new Map() };
    }
    // The attacker's string credit, from before this hit counted (applyLanded).
    const { attackers } = target.grace ?? {};
    if (inGrace(target, tick) && !attackers.has(attacker)) {
      const { stringHits, dashCooldown } = attacker.cs;
      attackers.set(attacker, { stringHits, dashCooldown });
    }
  }
  const strongest = new Map(); // target -> its strongest enemy hit this tick (pushes, and stuns unless armored)
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
      damage = move.damage * attacker.damageMult;
      if (inGrace(target, tick) && target.grace.attackers.has(attacker)) target.grace.damage += damage;
      hurt(target, damage);
      if (hasArmor(target.cs)) target.cs.armorTaken += damage; // checked again below: a broken armor stuns
      applyLanded(attacker.cs, move.hitstop);
      const best = strongest.get(target);
      if (!best || move.hitstun > best.move.hitstun) strongest.set(target, { attacker, move });
    }
    return { attacker, target, damage, parried };
  });
  for (const [target, { attacker, move }] of strongest) {
    push(attacker, target, move.knockback, attacker.cs.dir);
    if (!hasArmor(target.cs)) applyHit(target.cs, move); // includes the hit that broke the armor
  }
  return results;
}

// Parry grace: a parry pressed up to COMBAT.PARRY.grace ticks after enemy hits landed on an idle
// fighter (so it could have parried) still parries them. The hits are undone (hp, combat
// state, knockback; presses buffered since are kept) and every attacker in them is stunned and
// loses the jab string credit they earned (a parried hit never counts). A KO is final.
// Hitstop (at least the grace on every hit) froze the target, so it hasn't moved. Returns true if it parried.
export function parryGrace(f, tick) {
  const grace = f.grace;
  const ok = f.alive && inGrace(f, tick);
  f.grace = null;
  if (!ok) return false;
  const { buffer, bufferAge } = f.cs;
  Object.assign(f.cs, grace.cs, { buffer, bufferAge });
  f.hp += grace.damage; // only what the undone hits dealt, so other damage (the ring) stays
  f.body.kx = grace.kx;
  f.body.ky = grace.ky;
  const elapsed = tick - grace.tick;
  for (const [a, before] of grace.attackers) {
    a.cs.stringHits = before.stringHits;
    a.cs.dashCooldown = Math.max(a.cs.dashCooldown, before.dashCooldown - elapsed);
    applyParry(f.cs, a.cs);
  }
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
