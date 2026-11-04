import { ARENA, PLAYER, NET, MATCH, TICK_RATE, SNAPSHOT_RATE, BUTTON_MASK, BUTTONS } from '../../shared/constants.js';
import { createBody, separateBodies } from '../../shared/physics.js';
import { resolveCircle } from '../../shared/arena.js';
import { createCombat, stepFighter, STATE } from '../../shared/combat-state.js';
import { round2, wrapAngle } from '../../shared/math.js';
import { assistAim, burstPush, parryGrace, resolveHits } from './combat.js';
import { PositionHistory, rewindTicks } from './lagcomp.js';
import { teamBuffs } from './balance.js';
import { eliminationMode } from './modes/elimination.js';

const MOVE_EPSILON = 1e-3; // float slack on the |move| <= 1 check

// Facing replays into prediction (dash direction), so it gets more precision than positions.
const round4 = (v) => Math.round(v * 10_000) / 10_000;

// Returns a clean input or null. Shape: { seq, tick, move: {x, y}, aim, aimed, buttons }.
// aimed: the player pointed the aim on purpose (mouse, drag); otherwise attacks get aim assist.
export function validateInput(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { seq, tick, move, aim, aimed, buttons } = raw;
  if (!Number.isSafeInteger(seq) || seq < 0) return null;
  if (!Number.isSafeInteger(tick) || tick < 0) return null;
  if (!move || typeof move !== 'object') return null;
  const { x, y } = move;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const len = Math.hypot(x, y);
  if (len > 1 + MOVE_EPSILON) return null;
  if (!Number.isFinite(aim)) return null;
  if (!Number.isInteger(buttons) || buttons < 0 || buttons > BUTTON_MASK) return null;
  const scale = len > 1 ? 1 / len : 1;
  return {
    seq,
    tick,
    move: { x: x * scale, y: y * scale },
    aim: wrapAngle(aim),
    aimed: aimed === true,
    buttons,
  };
}

// Spreads teams around an ellipse, members side by side along it. Returns [{ x, y, aim }].
export function spawnPoints(teamSizes) {
  const cx = ARENA.WIDTH / 2;
  const cy = ARENA.HEIGHT / 2;
  const rx = cx - ARENA.SPAWN_INSET_X;
  const ry = cy - ARENA.SPAWN_INSET_Y;
  const points = [];
  teamSizes.forEach((size, team) => {
    const angle = Math.PI + (2 * Math.PI * team) / teamSizes.length;
    const bx = cx + Math.cos(angle) * rx;
    const by = cy + Math.sin(angle) * ry;
    // Tangent of the ellipse at this angle, normalized.
    const tx = -Math.sin(angle) * rx;
    const ty = Math.cos(angle) * ry;
    const tl = Math.hypot(tx, ty);
    for (let k = 0; k < size; k++) {
      const offset = (k - (size - 1) / 2) * ARENA.SPAWN_SPACING;
      const p = { x: bx + (tx / tl) * offset, y: by + (ty / tl) * offset };
      resolveCircle(p, PLAYER.RADIUS);
      points.push({ ...p, aim: Math.atan2(cy - p.y, cx - p.x) });
    }
  });
  return points;
}

// One running match. The global loop calls step(); socket.js feeds input().
// emit(event, payload, { volatile }) broadcasts to the room; onEmpty() is called once nobody is left.
// onEnd({ teamId }) is called once the match is decided and END_DELAY_TICKS have passed.
// perf() returns the loop's tick timing for this match ({ avgMs, maxMs }), sent once a second.
// mode is the game mode (interface in modes/elimination.js).
export class Match {
  constructor({ room, emit, onEmpty, onEnd = () => {}, perf = () => null, mode = eliminationMode() }) {
    this.room = room;
    this.emit = emit;
    this.onEmpty = onEmpty;
    this.onEnd = onEnd;
    this.perf = perf;
    this.mode = mode;
    this.tick = 0;
    this.result = null;  // set once the mode decides the match
    this.endsIn = MATCH.END_DELAY_TICKS;

    const teams = room.options.map((o) => [...room.players.values()].filter((p) => p.teamId === o.id));
    const sizes = teams.map((t) => t.length);
    const spawns = spawnPoints(sizes);
    const largest = Math.max(...sizes);
    const buffsByTeam = new Map(room.options.map((o, i) => [o.id, teamBuffs(sizes[i], largest)]));
    // Stable order (team, then join order) keeps body separation repeatable.
    this.fighters = teams.flat().map((p, i) => {
      const buffs = buffsByTeam.get(p.teamId);
      const maxHp = Math.round(PLAYER.BASE_HP * buffs.hp);
      return {
        id: p.id,
        teamId: p.teamId,
        body: createBody(spawns[i].x, spawns[i].y),
        aim: spawns[i].aim,
        aimed: false,
        cs: { ...createCombat(), dir: spawns[i].aim },
        hitIds: new Set(), // who the current move already hit
        grace: null,       // hits a late parry can still undo (combat.js parryGrace)
        rewind: 0,         // lag compensation for this fighter's attacks, in ticks
        maxHp,
        hp: maxHp,
        damageMult: buffs.damage,
        alive: true,
        queue: [],
        lastSeq: -1,     // newest seq accepted
        lastStamp: -1,   // view tick of the newest accepted input
        ackSeq: -1,      // newest seq applied by the sim
        move: { x: 0, y: 0 },
        starved: 0,      // ticks in a row with no input
        queuedHeld: 0,   // buttons held as of the last queued input (edges are derived against it)
        buttons: 0,      // buttons held as of the applied input
        pressed: 0,      // buttons pressed this tick
        released: 0,     // buttons released this tick
      };
    });
    separateBodies(this.fighters.map((f) => f.body));
    this.byId = new Map(this.fighters.map((f) => [f.id, f]));
    this.history = new PositionHistory();
    this.mode.onStart(this);
  }

  // Queues one validated input. Returns false if it was rejected.
  input(playerId, raw) {
    const f = this.byId.get(playerId);
    if (!f?.alive) return false;
    const input = validateInput(raw);
    if (!input || input.seq <= f.lastSeq) return false;
    f.lastSeq = input.seq;
    // Edges are derived here, at arrival, so merging or dropping inputs can't lose one.
    input.pressed = input.buttons & ~f.queuedHeld;
    input.released = f.queuedHeld & ~input.buttons;
    f.queuedHeld = input.buttons;
    // The view tick picks the lag comp rewind, so a client can't steer it: never in the future,
    // never backwards, and at most MAX_STAMP_STEP ahead of the last one (a real view moves 1 per tick).
    if (f.lastStamp >= 0) {
      input.tick = Math.max(f.lastStamp, Math.min(input.tick, f.lastStamp + NET.MAX_STAMP_STEP));
    }
    input.tick = Math.min(input.tick, this.tick);
    f.lastStamp = input.tick;
    f.queue.push(input);
    // Too much buffered: fold the oldest into the next one (keep the newest move, OR the edges).
    while (f.queue.length > NET.INPUT_QUEUE_MAX) {
      const [oldest, next] = f.queue.splice(0, 2);
      f.queue.unshift({ ...next, pressed: next.pressed | oldest.pressed, released: next.released | oldest.released });
    }
    return true;
  }

  // Forgets a player's input stream: on disconnect (stand still, no stale held buttons)
  // and on rejoin (the new client counts seq from scratch).
  resetInput(playerId) {
    const f = this.byId.get(playerId);
    if (!f) return;
    f.queue = [];
    f.move = { x: 0, y: 0 };
    f.lastSeq = -1;
    f.lastStamp = -1;
    f.ackSeq = -1;
    f.queuedHeld = 0;
    f.buttons = 0;
    f.rewind = 0;
  }

  // Puts a KO'd fighter back in the fight at a spawn { x, y, aim }, from a clean slate. The input
  // stream carries on: the client never stopped, and a button held through it isn't a new press.
  revive(f, { x, y, aim }, hp) {
    f.body = createBody(x, y);
    f.aim = aim;
    f.aimed = false;
    f.cs = { ...createCombat(), dir: aim };
    f.hitIds.clear();
    f.grace = null;
    f.hp = hp;
    f.alive = true;
    f.queue = [];
    f.move = { x: 0, y: 0 };
    f.buttons = f.queuedHeld;
    f.rewind = 0;
    this.history.clear();
  }

  step() {
    if (!this.room.players.size) return this.onEmpty();
    this.tick++;
    for (const f of this.fighters) {
      if (f.alive && !this.room.players.has(f.id)) f.alive = false; // left the room
      if (!f.alive) continue;
      const input = f.queue.shift();
      f.pressed = 0;
      f.released = 0;
      if (input) {
        f.move = input.move;
        f.aim = input.aim;
        f.aimed = input.aimed;
        f.ackSeq = input.seq;
        f.pressed = input.pressed;
        f.released = input.released;
        f.buttons = input.buttons;
        f.rewind = rewindTicks(this.tick, input.tick);
        f.starved = 0;
      } else if (++f.starved >= NET.INPUT_STARVE_TICKS) {
        // A late packet repeats the last move; a stalled client stops instead of running on.
        f.move = { x: 0, y: 0 };
      }
      // A parry pressed just after getting hit can still win; then it's used up.
      if (f.pressed & BUTTONS.PARRY && parryGrace(f, this.tick)) f.pressed &= ~BUTTONS.PARRY;
      const { move, pressed, released, buttons: held, aim } = f;
      const started = stepFighter(f.cs, f.body, { move, pressed, released, held, aim });
      if (started) f.hitIds.clear();
      if (started === BUTTONS.JAB && !f.aimed) f.cs.dir = assistAim(f, this.fighters, f.cs.dir);
      if (f.cs.state === STATE.BURST && f.cs.t === 0) burstPush(f, this.fighters);
    }
    separateBodies(this.fighters.filter((f) => f.alive).map((f) => f.body));
    this.history.record(this.tick, this.fighters);
    resolveHits(this.fighters, { tick: this.tick, seen: this.history.seen(this.tick) });
    if (!this.result) {
      this.mode.onTick(this);
      this.result = this.mode.checkWinner(this);
    }
    if (this.#snapshotDue()) this.emit('match:snapshot', this.snapshot(), { volatile: true });
    // After the snapshot: a reliable emit just before a volatile one can make clients drop it.
    if (this.result && this.endsIn-- === 0) this.onEnd(this.result);
  }

  #snapshotDue() {
    const slot = (t) => Math.floor((t * SNAPSHOT_RATE) / TICK_RATE);
    return slot(this.tick) !== slot(this.tick - 1);
  }

  snapshot() {
    const acks = {};
    for (const f of this.fighters) acks[f.id] = f.ackSeq;
    const perf = this.tick % TICK_RATE === 0 ? this.perf() : null;
    return {
      tick: this.tick,
      acks,
      ...this.mode.publicState(this),
      ...(perf && { tickMs: { avg: round2(perf.avgMs), max: round2(perf.maxMs) } }),
      fighters: this.fighters.map(({ id, body, aim, cs, hp, maxHp, alive }) => ({
        id,
        x: round2(body.x),
        y: round2(body.y),
        vx: round2(body.vx),
        vy: round2(body.vy),
        kx: round2(body.kx),
        ky: round2(body.ky),
        aim: round2(aim),
        hp: round2(hp), // fractional once the ring burns
        maxHp,
        alive,
        cs: { ...cs, dir: round4(cs.dir) },
      })),
    };
  }
}
