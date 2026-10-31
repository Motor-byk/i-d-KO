import { COMBAT, BUTTONS } from './constants.js';
import { stepBody } from './physics.js';
import { bounceVelocity } from './arena.js';

// Combat timing, shared by the server and client prediction: what a fighter is doing, for how
// long, and what it may do next. Hit *detection* is server-only (server/game/combat.js); this
// only starts moves, tracks their phase and ends them. All durations are ticks.
// A combat state is a plain object, so it can ride in snapshots and be restored for replay.

export const STATE = {
  IDLE: 'idle',
  JAB: 'jab',
  CHARGE: 'charge', // holding heavy
  HEAVY: 'heavy',   // heavy released: startup, active, recovery
  DASH: 'dash',
  HITSTUN: 'hitstun',
};

// When several actions are pressed on the same tick, the first one here wins the buffer.
const ACTION_PRIORITY = [BUTTONS.DASH, BUTTONS.HEAVY, BUTTONS.JAB];

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
    charge: 0,     // ticks the current heavy was charged
    letGo: false,  // heavy released while charging (it fires once MIN_CHARGE is reached)
    launched: false, // in hitstun from a launching hit: the next wall it hits bounces it
    dashCooldown: 0,
    dir: 0,        // facing (or dash direction), locked when the current move started
  };
}

const lerp = (a, b, k) => a + (b - a) * k;

// Frame data of the move being performed, or null when not in a move.
// A heavy's damage and knockback scale with its charge.
export function moveFrames(cs) {
  if (cs.state === STATE.JAB) return COMBAT.JAB[cs.jab];
  if (cs.state !== STATE.HEAVY) return null;
  const H = COMBAT.HEAVY;
  const k = chargeFraction(cs.charge);
  return {
    ...H,
    damage: Math.round(lerp(H.damageMin, H.damageMax, k)),
    knockback: lerp(H.knockbackMin, H.knockbackMax, k),
    launch: k >= H.LAUNCH_CHARGE,
  };
}

// 0 at MIN_CHARGE, 1 at MAX_CHARGE.
export function chargeFraction(ticks) {
  const { MIN_CHARGE, MAX_CHARGE } = COMBAT.HEAVY;
  return Math.max(0, Math.min(1, (ticks - MIN_CHARGE) / (MAX_CHARGE - MIN_CHARGE)));
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
  cs.launched = false;
  if (state !== STATE.IDLE) cs.chain = 0;
}

// Jab and heavy recovery can be cancelled into a dash once cancelAfter ticks of it have passed.
function canDashCancel(cs) {
  const m = moveFrames(cs);
  return !!m && cs.t - m.startup - m.active >= COMBAT.DASH.cancelAfter;
}

const letGoOfHeavy = ({ held = 0, released = 0 }) => !(held & BUTTONS.HEAVY) || !!(released & BUTTONS.HEAVY);

const ACTIONS = {
  [BUTTONS.JAB]: {
    canStart: (cs) => cs.state === STATE.IDLE,
    start(cs) {
      const next = cs.chain > 0 ? (cs.jab + 1) % COMBAT.JAB.length : 0;
      enter(cs, STATE.JAB);
      cs.jab = next;
    },
  },
  [BUTTONS.HEAVY]: {
    canStart: (cs) => cs.state === STATE.IDLE,
    start(cs, input) {
      enter(cs, STATE.CHARGE);
      cs.letGo = letGoOfHeavy(input);
    },
  },
  [BUTTONS.DASH]: {
    canStart: (cs) => cs.dashCooldown === 0
      && (cs.state === STATE.IDLE || cs.state === STATE.CHARGE || canDashCancel(cs)),
    // Dashes along the stick, or where you face if the stick is (nearly) centered.
    start(cs, { move }) {
      enter(cs, STATE.DASH, COMBAT.DASH.duration);
      cs.dashCooldown = COMBAT.DASH.cooldown;
      if (move && Math.hypot(move.x, move.y) >= COMBAT.DASH.MIN_STICK) cs.dir = Math.atan2(move.y, move.x);
    },
  },
};

// While charging: aim follows the input, and the heavy fires on release (after MIN_CHARGE)
// or by itself once a full charge has been held for MAX_HOLD.
function stepCharge(cs, input, aim) {
  const { MIN_CHARGE, MAX_CHARGE, MAX_HOLD } = COMBAT.HEAVY;
  cs.dir = aim;
  if (letGoOfHeavy(input)) cs.letGo = true;
  if ((cs.letGo && cs.t >= MIN_CHARGE) || cs.t >= MAX_CHARGE + MAX_HOLD) {
    const charge = Math.min(cs.t, MAX_CHARGE);
    enter(cs, STATE.HEAVY);
    cs.charge = charge;
  }
}

// Advances one tick. input: { pressed, held, released } (BUTTONS bits), move {x, y} and aim (radians).
// Returns the BUTTONS bit of the action started this tick, or 0.
export function stepCombat(cs, input = {}) {
  const { pressed = 0, aim = cs.dir } = input;
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
  if (cs.dashCooldown > 0) cs.dashCooldown--;
  const m = moveFrames(cs);
  if (cs.state === STATE.JAB && cs.t === m.startup + m.active) cs.chain = COMBAT.JAB_CHAIN_WINDOW;
  if (cs.state === STATE.CHARGE) stepCharge(cs, input, aim);
  else if (cs.state !== STATE.IDLE && cs.t >= duration(cs)) enter(cs, STATE.IDLE);

  if (!cs.buffer) return 0;
  const bit = cs.buffer;
  if (ACTIONS[bit].canStart(cs)) {
    cs.buffer = 0;
    cs.dir = aim;
    ACTIONS[bit].start(cs, input);
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
  [STATE.CHARGE]: COMBAT.HEAVY.CHARGE_WALK,
};

// One tick of a fighter: combat timing, then movement. Hitstop freezes the body too.
// A launched fighter flying into a wall or pillar fast enough bounces off it, once.
// input: { move: {x, y}, pressed, held, released, aim }. Returns what stepCombat returns.
export function stepFighter(cs, body, input) {
  if (cs.hitstop > 0) return stepCombat(cs, input);
  const started = stepCombat(cs, input);
  const scale = WALK_SCALE[cs.state] ?? 0;
  const [kx, ky] = [body.kx, body.ky];
  const dash = cs.state === STATE.DASH ? { x: Math.cos(cs.dir), y: Math.sin(cs.dir) } : null;
  const normals = stepBody(body, { x: input.move.x * scale, y: input.move.y * scale }, dash);
  const H = COMBAT.HEAVY;
  if (cs.launched && normals.length && Math.hypot(kx, ky) >= H.WALL_BOUNCE_MIN_SPEED) {
    const bounce = bounceVelocity(kx, ky, normals, H.WALL_BOUNCE_RESTITUTION);
    if (bounce) {
      body.kx = bounce.vx;
      body.ky = bounce.vy;
      cs.launched = false;
      cs.len += H.WALL_BOUNCE_HITSTUN;
      cs.hitstop = H.WALL_BOUNCE_HITSTOP;
    }
  }
  return started;
}

// Puts a fighter in hitstun. The server calls this when a hit lands.
export function applyHit(cs, { hitstun, hitstop, launch = false }) {
  enter(cs, STATE.HITSTUN, hitstun);
  cs.hitstop = hitstop;
  cs.launched = launch;
}

// Freezes a fighter's timers (the attacker's side of a landed hit).
export function applyHitstop(cs, ticks) {
  cs.hitstop = Math.max(cs.hitstop, ticks);
}
