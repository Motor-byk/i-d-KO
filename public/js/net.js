import { NET, DT, PLAYER, TICK_RATE, TICK_MS, SNAPSHOT_RATE, MAX_CATCHUP_TICKS } from '../../shared/constants.js';
import { applyLanded, isParrying, moveFrames, phase, stepFighter } from '../../shared/combat-state.js';
import { attackHitboxes, hitsBody } from '../../shared/hitbox.js';
import { resolveCircle } from '../../shared/arena.js';
import { lerp, lerpAngle } from '../../shared/math.js';

// Client netcode. No DOM here, so tests can run it under node. Times are performance.now() ms.

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
// barely moves it. A big jump (the server dropped loop ticks, or we were away) is taken at once
// when CLOCK_JUMP_CONFIRM snapshots in a row agree on it.
// jitterMs is the smoothed size of the arrival errors, stray packets included.
export function createClock() {
  let offset = null;
  let jitter = 0;
  let jumps = 0; // big errors in a row: +n late... -n early
  return {
    get jitterMs() {
      return jitter;
    },
    onSnapshot(tick, now) {
      const sample = tick - now / TICK_MS;
      if (offset === null) {
        offset = sample;
        return;
      }
      const err = sample - offset;
      jitter += (Math.min(Math.abs(err) * TICK_MS, NET.INTERP_MAX_MS) - jitter) * NET.JITTER_SMOOTHING;
      if (Math.abs(err) > NET.CLOCK_SNAP_TICKS) {
        // One stray packet is ignored; a run of them, all off the same way, is the new clock.
        jumps = Math.sign(err) === Math.sign(jumps) ? jumps + Math.sign(err) : Math.sign(err);
        if (Math.abs(jumps) >= NET.CLOCK_JUMP_CONFIRM) {
          offset = sample;
          jumps = 0;
        }
        return;
      }
      jumps = 0;
      offset += err * NET.CLOCK_SMOOTHING;
    },
    // The server tick right now (fractional), or null before the first snapshot.
    tickAt(now) {
      return offset === null ? null : now / TICK_MS + offset;
    },
  };
}

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
      if (a.suddenDeath !== b.suddenDeath) return b.fighters; // revived fighters teleport, not glide
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

// Notices a dead link from the snapshots stopping, long before the socket's ping timeout would.
// check(now) is polled and returns { stalled, reconnect }; reconnect is true once per expiry.
export function createLinkWatch(now) {
  let lastHeard = now;
  let reconnectFrom = now;
  let lastCheck = now;
  let reconnectAfter = NET.LINK_RECONNECT_MS;
  return {
    heard(t) {
      lastHeard = t;
      reconnectFrom = t;
      reconnectAfter = NET.LINK_RECONNECT_MS;
    },
    // A new connection gets the full wait to rejoin and hear a snapshot.
    connected(t) {
      reconnectFrom = t;
    },
    check(t) {
      // A gap between checks means we were the ones asleep (frozen tab), not the link: start over.
      if (t - lastCheck >= NET.LINK_STALL_MS) {
        lastHeard = t;
        reconnectFrom = t;
      }
      lastCheck = t;
      const reconnect = t - reconnectFrom >= reconnectAfter;
      if (reconnect) {
        reconnectFrom = t;
        reconnectAfter = Math.min(reconnectAfter * 2, NET.LINK_RECONNECT_MAX_MS);
      }
      return { stalled: t - lastHeard >= NET.LINK_STALL_MS, reconnect };
    },
  };
}

const bodyOf = ({ x, y, vx, vy, kx, ky }) => ({ x, y, vx, vy, kx, ky });

// Predicts your own fighter. Every local input is applied at once through the shared
// stepFighter (combat timing + movement) and kept until the server acks its seq. On each
// snapshot the fighter is reset to the server's state and the unacked inputs are replayed.
// Hits on others are judged by the server, but your own side of an enemy hit you can see landing
// (the freeze and string credit, applyLanded) is predicted, against where you saw the others: the
// same view the server's lag compensation checks against. Everything else hits do (getting hit,
// being parried, body and burst pushes) arrives as corrections.
// Small corrections are eased out through a visual offset; large ones snap.
export function createPredictor() {
  let body;
  let cs;
  let hitIds = new Set(); // who the current move already hit, as you saw it (the server keeps its own)
  let held;    // buttons held as of the last input (edges are derived against it, as on the server)
  let pending; // applied inputs the server hasn't acked yet, oldest first
  let lastAck;
  let offset;  // drawn position = body + offset
  let prev;    // drawn position as of the previous tick
  function reset() {
    body = null;
    cs = null;
    held = 0;
    pending = [];
    hitIds = new Set();
    lastAck = -1;
    offset = { x: 0, y: 0 };
    prev = null;
  }
  reset();

  // The hitstop your move earns this tick from enemies in seen it touches for the first time, or 0.
  // Mirrors resolveHits: invulnerable targets pass through, friendly and parried hits earn nothing.
  function landedHitstop(seen) {
    if (phase(cs) !== 'active') return 0;
    const boxes = attackHitboxes(cs, body.x, body.y);
    let hitstop = 0;
    for (const t of seen) {
      if (hitIds.has(t.id) || t.cs.invuln > 0 || !hitsBody(boxes, t)) continue;
      hitIds.add(t.id);
      if (t.enemy && !isParrying(t.cs)) hitstop = moveFrames(cs).hitstop;
    }
    return hitstop;
  }

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

    // Applies one local input ({ seq, move, aim, buttons }, as sent to the server). seen: the other
    // live fighters where you're looking (the input's tick), as [{ id, x, y, cs, enemy }].
    step({ seq, move, aim, buttons }, seen = []) {
      if (!body) return;
      prev = { x: body.x + offset.x, y: body.y + offset.y };
      const input = { seq, move, aim, held: buttons, pressed: buttons & ~held, released: held & ~buttons };
      held = buttons;
      if (stepFighter(cs, body, input)) hitIds.clear();
      input.landed = landedHitstop(seen); // kept, so replays land it on the same tick
      if (input.landed) applyLanded(cs, input.landed);
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
      for (const input of pending) {
        stepFighter(cs, body, input);
        if (input.landed) applyLanded(cs, input.landed);
      }
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
    reset,
  };
}
