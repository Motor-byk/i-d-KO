import { COMBAT, BUTTONS } from './constants.js';
import { stepBody } from './physics.js';

// Combat timing, shared by the server and client prediction: what a fighter is doing, for how
// long, and what it may do next. Hit *detection* is server-only (server/game/combat.js); this
// only starts moves, tracks their phase and ends them. All durations are ticks.
// A combat state is a plain object, so it can ride in snapshots and be restored for replay.

export const STATE = {
  IDLE: 'idle',
  JAB: 'jab',
  HITSTUN: 'hitstun',
};

// When several actions are pressed on the same tick, the first one here wins the buffer.
const ACTION_PRIORITY = [BUTTONS.JAB];

export function createCombat() {
  return {
    state: STATE.IDLE,
    t: 0,          // ticks spent in this state
    len: 0,        // length of a timed state (hitstun); moves take theirs from frame data
    hitstop: 0,    // ticks left frozen: timers stop, presses still buffer
    buffer: 0,     // buffered action (a BUTTONS bit), 0 = none
    bufferAge: 0,
    jab: 0,        // index into COMBAT.JAB of the current (or last) jab
    chain: 0,      // ticks left in which the next jab continues the string
    dir: 0,        // facing, locked when the current move started
  };
}

// Frame data of the move being performed, or null when not in a move.
export function moveFrames(cs) {
  return cs.state === STATE.JAB ? COMBAT.JAB[cs.jab] : null;
}

// 'startup' | 'active' | 'recovery' for a move, null otherwise.
export function phase(cs) {
  const m = moveFrames(cs);
  if (!m) return null;
  if (cs.t < m.startup) return 'startup';
  if (cs.t < m.startup + m.active) return 'active';
  return 'recovery';
}

function duration(cs) {
  const m = moveFrames(cs);
  return m ? m.startup + m.active + m.recovery : cs.len;
}

function enter(cs, state, len = 0) {
  cs.state = state;
  cs.t = 0;
  cs.len = len;
  if (state !== STATE.IDLE) cs.chain = 0;
}

const ACTIONS = {
  [BUTTONS.JAB]: {
    canStart: (cs) => cs.state === STATE.IDLE,
    start(cs) {
      const next = cs.chain > 0 ? (cs.jab + 1) % COMBAT.JAB.length : 0;
      enter(cs, STATE.JAB);
      cs.jab = next;
    },
  },
};

// Advances one tick. input: { pressed } (BUTTONS bits) and aim (radians).
// Returns the BUTTONS bit of the action started this tick, or 0.
export function stepCombat(cs, { pressed = 0, aim = cs.dir } = {}) {
  const action = ACTION_PRIORITY.find((bit) => pressed & bit);
  if (action) {
    cs.buffer = action;
    cs.bufferAge = 0;
  }
  if (cs.hitstop > 0) {
    cs.hitstop--;
    return 0;
  }

  cs.t++;
  if (cs.chain > 0) cs.chain--;
  const m = moveFrames(cs);
  if (cs.state === STATE.JAB && cs.t === m.startup + m.active) cs.chain = COMBAT.JAB_CHAIN_WINDOW;
  if (cs.state !== STATE.IDLE && cs.t >= duration(cs)) enter(cs, STATE.IDLE);

  if (!cs.buffer) return 0;
  const bit = cs.buffer;
  if (ACTIONS[bit].canStart(cs)) {
    cs.buffer = 0;
    ACTIONS[bit].start(cs);
    cs.dir = aim;
    return bit;
  }
  // Tried on the press tick and INPUT_BUFFER more, then dropped.
  if (++cs.bufferAge > COMBAT.INPUT_BUFFER) cs.buffer = 0;
  return 0;
}

// Walking speed multiplier per state; anything not listed can't walk.
const WALK_SCALE = {
  [STATE.IDLE]: 1,
  [STATE.JAB]: COMBAT.ATTACK_WALK,
};

// One tick of a fighter: combat timing, then movement. Hitstop freezes the body too.
// input: { move: {x, y}, pressed, aim }. Returns what stepCombat returns.
export function stepFighter(cs, body, input) {
  const frozen = cs.hitstop > 0;
  const started = stepCombat(cs, input);
  if (!frozen) {
    const scale = WALK_SCALE[cs.state] ?? 0;
    stepBody(body, { x: input.move.x * scale, y: input.move.y * scale });
  }
  return started;
}

// Puts a fighter in hitstun. The server calls this when a hit lands.
export function applyHit(cs, { hitstun, hitstop }) {
  enter(cs, STATE.HITSTUN, hitstun);
  cs.hitstop = hitstop;
}

// Freezes a fighter's timers (the attacker's side of a landed hit).
export function applyHitstop(cs, ticks) {
  cs.hitstop = Math.max(cs.hitstop, ticks);
}
