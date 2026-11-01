import { NET, TICK_RATE } from '../../shared/constants.js';
import { STATE } from '../../shared/combat-state.js';

// Lag compensation rewinds *positions only*: an attacker's move is checked against where each
// target was on the attacker's screen (the tick their input was stamped with), at most
// LAG_COMP_MAX_MS ago. Combat state is never rewound, and a target that is dashing, parrying or
// bursting right now is judged where it is now, so defensive moves keep working at any ping.

export const MAX_REWIND_TICKS = Math.round((NET.LAG_COMP_MAX_MS * TICK_RATE) / 1000);

const NO_REWIND = new Set([STATE.DASH, STATE.PARRY, STATE.BURST]);

// How many ticks to rewind for an input stamped with inputTick, applied at serverTick.
export const rewindTicks = (serverTick, inputTick) =>
  Math.max(0, Math.min(MAX_REWIND_TICKS, serverTick - inputTick));

// Fighter positions for the current tick and the MAX_REWIND_TICKS before it.
export class PositionHistory {
  #ticks = []; // [{ tick, at: Map(id -> { x, y }) }], oldest first

  record(tick, fighters) {
    const at = new Map();
    for (const f of fighters) if (f.alive) at.set(f.id, { x: f.body.x, y: f.body.y });
    this.#ticks.push({ tick, at });
    if (this.#ticks.length > MAX_REWIND_TICKS + 1) this.#ticks.shift();
  }

  // Where fighter id was at tick, or null if that tick isn't kept (or it wasn't alive).
  at(tick, id) {
    return this.#ticks.find((t) => t.tick === tick)?.at.get(id) ?? null;
  }

  // seen(attacker, target) for resolveHits: where the attacker saw the target.
  // attacker.rewind is its input's rewind in ticks; tick is the current server tick.
  seen(tick) {
    return (a, t) => {
      if (!a.rewind || NO_REWIND.has(t.cs.state)) return t.body;
      return this.at(tick - a.rewind, t.id) ?? t.body;
    };
  }
}
