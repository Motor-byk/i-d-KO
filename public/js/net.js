import { NET, DT, PLAYER, TICK_RATE, SNAPSHOT_RATE, MAX_CATCHUP_TICKS } from '../../shared/constants.js';
import { stepFighter } from '../../shared/combat-state.js';
import { resolveCircle } from '../../shared/arena.js';

// Client netcode. No DOM here, so tests can run it under node. Times are performance.now() ms.

export const TICK_MS = 1000 / TICK_RATE;

// Runs a fixed TICK_RATE step off the clock, not off frames: advance(now) returns how many
// steps are due (at most MAX_CATCHUP_TICKS; a longer stall, like a background tab, is skipped).
// alpha(now) is how far into the current step we are, 0..1, for drawing between steps.
export function createTicker(now) {
  let next = now;
  return {
    advance(now) {
      let due = 0;
      while (now >= next && due < MAX_CATCHUP_TICKS) {
        next += TICK_MS;
        due++;
      }
      if (now >= next) next = now + TICK_MS;
      return due;
    },
    alpha: (now) => Math.max(0, Math.min(1, 1 - (next - now) / TICK_MS)),
  };
}

// Estimates the server tick from snapshot arrivals. Each arrival gives a sample of
// (server tick - local time in ticks); the estimate eases toward it, so one late packet
// barely moves it. A big jump (the server dropped loop ticks, or we were away) is taken at once.
// jitterMs is the smoothed size of the arrival errors.
export function createClock() {
  let offset = null;
  let jitter = 0;
  return {
    get ready() {
      return offset !== null;
    },
    get jitterMs() {
      return jitter;
    },
    onSnapshot(tick, now) {
      const sample = tick - now / TICK_MS;
      const err = offset === null ? Infinity : sample - offset;
      if (Math.abs(err) > NET.CLOCK_SNAP_TICKS) {
        offset = sample;
        return;
      }
      offset += err * NET.CLOCK_SMOOTHING;
      jitter += (Math.abs(err) * TICK_MS - jitter) * NET.JITTER_SMOOTHING;
    },
    // The server tick right now (fractional), or null before the first snapshot.
    tickAt(now) {
      return offset === null ? null : now / TICK_MS + offset;
    },
  };
}

const lerp = (a, b, k) => a + (b - a) * k;
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

// Shows other players a little in the past, between two snapshots, so they move smoothly
// despite 20 Hz snapshots and jitter. The delay adapts to the measured jitter within
// [INTERP_MIN_MS, INTERP_MAX_MS]. Past the newest snapshot it extrapolates along velocity
// for up to MAX_EXTRAPOLATE_SNAPSHOTS, then holds.
export function createInterpolator() {
  let snaps = []; // oldest first
  let delay = NET.INTERP_MIN_MS;
  const extrapolateTicks = (NET.MAX_EXTRAPOLATE_SNAPSHOTS * TICK_RATE) / SNAPSHOT_RATE;

  function extrapolate(f, ticks) {
    if (!f.alive || ticks <= 0) return f;
    const p = { x: f.x + (f.vx + f.kx) * ticks * DT, y: f.y + (f.vy + f.ky) * ticks * DT };
    resolveCircle(p, PLAYER.RADIUS);
    return { ...f, ...p };
  }

  return {
    get delayMs() {
      return delay;
    },
    // Adds a snapshot (in tick order) and retunes the delay for the current jitter.
    push(snap, jitterMs) {
      if (snaps.length && snap.tick <= snaps.at(-1).tick) return;
      snaps.push(snap);
      const keepFrom = snap.tick - NET.INTERP_BUFFER_TICKS;
      while (snaps.length > 2 && snaps[0].tick < keepFrom) snaps.shift();
      const target = Math.max(NET.INTERP_MIN_MS, Math.min(NET.INTERP_MAX_MS,
        2 * TICK_MS + NET.INTERP_JITTER_SCALE * jitterMs));
      delay += (target - delay) * NET.INTERP_ADAPT;
    },
    // Fighters as seen at a (fractional) server tick.
    sample(tick) {
      if (!snaps.length) return [];
      const i = snaps.findIndex((s) => s.tick >= tick);
      if (i === -1) {
        const newest = snaps.at(-1);
        const ahead = Math.min(tick - newest.tick, extrapolateTicks);
        return newest.fighters.map((f) => extrapolate(f, ahead));
      }
      if (i === 0) return snaps[0].fighters;
      const a = snaps[i - 1];
      const b = snaps[i];
      const k = (tick - a.tick) / (b.tick - a.tick);
      const before = new Map(a.fighters.map((f) => [f.id, f]));
      return b.fighters.map((fb) => {
        const fa = before.get(fb.id);
        if (!fa) return fb;
        // Discrete state (combat, hp, alive) comes from whichever snapshot is nearer.
        return {
          ...(k < 0.5 ? fa : fb),
          x: lerp(fa.x, fb.x, k),
          y: lerp(fa.y, fb.y, k),
          aim: lerpAngle(fa.aim, fb.aim, k),
        };
      });
    },
  };
}

const bodyOf = ({ x, y, vx, vy, kx, ky }) => ({ x, y, vx, vy, kx, ky });

// Predicts your own fighter. Every local input is applied at once through the shared
// stepFighter (combat timing + movement) and kept until the server acks its seq. On each
// snapshot the fighter is reset to the server's state and the unacked inputs are replayed.
// Hit detection, body pushes and burst pushes are server-only, so those arrive as corrections.
// Small corrections are eased out through a visual offset; large ones snap.
export function createPredictor() {
  let body = null;
  let cs = null;
  let held = 0;      // buttons held as of the last input (edges are derived against it, as on the server)
  let pending = [];  // applied inputs the server hasn't acked yet, oldest first
  let lastAck = -1;
  let offset = { x: 0, y: 0 }; // drawn position = body + offset
  let prev = null;             // drawn position as of the previous tick

  return {
    // { body, cs } of the predicted fighter, or null before the first snapshot.
    get state() {
      return body && { body, cs };
    },
    // Where to draw the fighter, alpha (0..1) of the way from the previous tick to the newest:
    // the predicted position plus what's left of the correction.
    drawnAt(alpha) {
      if (!body) return null;
      const x = body.x + offset.x;
      const y = body.y + offset.y;
      return prev ? { x: lerp(prev.x, x, alpha), y: lerp(prev.y, y, alpha) } : { x, y };
    },

    // Applies one local input ({ seq, move, aim, buttons }, as sent to the server).
    step({ seq, move, aim, buttons }) {
      if (!body) return;
      prev = { x: body.x + offset.x, y: body.y + offset.y };
      const input = { seq, move, aim, held: buttons, pressed: buttons & ~held, released: held & ~buttons };
      held = buttons;
      stepFighter(cs, body, input);
      pending.push(input);
      if (pending.length > NET.MAX_PENDING_INPUTS) pending.shift();
      offset.x *= NET.CORRECTION_DECAY;
      offset.y *= NET.CORRECTION_DECAY;
    },

    // Rebases on the server's view of you (a snapshot fighter) and the newest seq it applied.
    // Returns the size of the correction in world units.
    reconcile(fighter, ack) {
      // The ack only goes backwards when the server dropped your input stream (rejoin).
      if (ack < lastAck) pending = [];
      lastAck = ack;
      pending = pending.filter((i) => i.seq > ack);
      const before = body && { x: body.x, y: body.y };
      body = bodyOf(fighter);
      cs = structuredClone(fighter.cs);
      for (const input of pending) stepFighter(cs, body, input);
      if (!before) return 0;
      const dx = before.x - body.x;
      const dy = before.y - body.y;
      const error = Math.hypot(dx, dy);
      if (error > NET.SNAP_DISTANCE) {
        offset = { x: 0, y: 0 };
        prev = null;
      } else offset = { x: offset.x + dx, y: offset.y + dy };
      return error;
    },

    // Forgets everything (KO, connection lost): the next snapshot starts prediction afresh.
    reset() {
      body = null;
      cs = null;
      held = 0;
      pending = [];
      lastAck = -1;
      offset = { x: 0, y: 0 };
      prev = null;
    },
  };
}
