import { JUICE, TICK_MS } from '../../shared/constants.js';

// Client-only game feel, worked out from what changed between snapshots. No DOM here, so tests
// can run it under node. Nothing in here affects the simulation.
export function createJuice({ random = Math.random } = {}) {
  let last = new Map(); // id -> fighter, as of the previous snapshot
  let floats = [];      // { tick, x, y, text, ko }
  let trauma = 0;       // how far the screen shakes, in world units
  let lastShake = null;
  let lastRound = 0;    // sudden death rounds as of the previous snapshot

  const addFloat = (tick, f, text, ko) => floats.push({
    tick,
    x: f.x + (random() * 2 - 1) * JUICE.FLOAT_SPREAD,
    y: f.y,
    text,
    ko,
  });
  const addShake = (amount) => {
    trauma = Math.min(JUICE.SHAKE_MAX, trauma + amount);
  };

  return {
    onSnapshot(snap, meId) {
      // A tie revives fighters on the tick they fell, so no snapshot shows them dead: this one
      // shows HP dropping to 1 and a teleport. Everyone still up just went KO, where they stood.
      const tied = snap.suddenDeath !== lastRound;
      lastRound = snap.suddenDeath;
      for (const f of snap.fighters) {
        const before = last.get(f.id);
        if (!before?.alive) continue;
        if (tied) {
          addFloat(snap.tick, before, 'KO!', true);
          addShake(JUICE.SHAKE_KO);
          continue;
        }
        const lost = before.hp - f.hp;
        // Below the minimum it's the ring's slow burn, not a hit.
        if (lost >= JUICE.DAMAGE_MIN) {
          addFloat(snap.tick, f, String(Math.round(lost)), false);
          addShake(lost * JUICE.SHAKE_PER_DAMAGE * (f.id === meId ? 1 : JUICE.SHAKE_OTHERS));
        }
        if (!f.alive) {
          addFloat(snap.tick, f, 'KO!', true);
          addShake(JUICE.SHAKE_KO);
        }
      }
      last = new Map(snap.fighters.map((f) => [f.id, f]));
    },

    // Floating text to draw at a (fractional) server tick, timed to the interpolated view:
    // [{ x, y, text, ko, alpha }]. Expired ones are forgotten.
    floatsAt(tick) {
      floats = floats.filter((t) => tick - t.tick < JUICE.FLOAT_TICKS);
      return floats.filter((t) => tick >= t.tick).map((t) => {
        const age = tick - t.tick;
        return { ...t, y: t.y - age * JUICE.FLOAT_RISE, alpha: 1 - age / JUICE.FLOAT_TICKS };
      });
    },

    // This frame's camera offset, in world units. Call once per frame.
    shakeAt(now) {
      trauma *= JUICE.SHAKE_DECAY ** ((now - (lastShake ?? now)) / TICK_MS);
      lastShake = now;
      if (trauma < JUICE.SHAKE_MIN) return { x: 0, y: 0 };
      const angle = random() * Math.PI * 2;
      return { x: Math.cos(angle) * trauma, y: Math.sin(angle) * trauma };
    },
  };
}
