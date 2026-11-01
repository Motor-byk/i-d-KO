import { NET } from '../../shared/constants.js';
import { stepFighter } from '../../shared/combat-state.js';

// Client netcode. No DOM here, so tests can run it under node.

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

  return {
    // { body, cs } of the predicted fighter, or null before the first snapshot.
    get state() {
      return body && { body, cs };
    },
    // Where to draw the fighter: the predicted position plus what's left of the correction.
    get drawn() {
      return body && { x: body.x + offset.x, y: body.y + offset.y };
    },

    // Applies one local input ({ seq, move, aim, buttons }, as sent to the server).
    step({ seq, move, aim, buttons }) {
      if (!body) return;
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
      if (error > NET.SNAP_DISTANCE) offset = { x: 0, y: 0 };
      else offset = { x: offset.x + dx, y: offset.y + dy };
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
    },
  };
}
