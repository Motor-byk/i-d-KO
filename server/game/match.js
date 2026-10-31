import { ARENA, PLAYER, NET, TICK_RATE, SNAPSHOT_RATE, BUTTON_MASK } from '../../shared/constants.js';
import { createBody, stepBody, separateBodies } from '../../shared/physics.js';
import { resolveCircle } from '../../shared/arena.js';

const MOVE_EPSILON = 1e-3; // float slack on the |move| <= 1 check

const round2 = (v) => Math.round(v * 100) / 100;

// Returns a clean input or null. Shape: { seq, tick, move: {x, y}, aim, buttons }.
export function validateInput(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { seq, tick, move, aim, buttons } = raw;
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
  return { seq, tick, move: { x: x * scale, y: y * scale }, aim: Math.atan2(Math.sin(aim), Math.cos(aim)), buttons };
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
// perf() returns the loop's tick timing for this match ({ avgMs, maxMs }), sent once a second.
export class Match {
  constructor({ room, emit, onEmpty, perf = () => null }) {
    this.room = room;
    this.emit = emit;
    this.onEmpty = onEmpty;
    this.perf = perf;
    this.tick = 0;

    const teams = room.options.map((o) => [...room.players.values()].filter((p) => p.teamId === o.id));
    const spawns = spawnPoints(teams.map((t) => t.length));
    // Stable order (team, then join order) keeps body separation repeatable.
    this.fighters = teams.flat().map((p, i) => ({
      id: p.id,
      teamId: p.teamId,
      body: createBody(spawns[i].x, spawns[i].y),
      aim: spawns[i].aim,
      hp: PLAYER.BASE_HP,
      alive: true,
      queue: [],
      lastSeq: -1,     // newest seq accepted
      ackSeq: -1,      // newest seq applied by the sim
      move: { x: 0, y: 0 },
      held: 0,         // buttons held as of the last queued input
      pressed: 0,      // buttons pressed this tick
    }));
    separateBodies(this.fighters.map((f) => f.body));
    this.byId = new Map(this.fighters.map((f) => [f.id, f]));
  }

  // Queues one validated input. Returns false if it was rejected.
  input(playerId, raw) {
    const f = this.byId.get(playerId);
    if (!f?.alive) return false;
    const input = validateInput(raw);
    if (!input || input.seq <= f.lastSeq) return false;
    f.lastSeq = input.seq;
    // Presses are derived here, at arrival, so merging or dropping inputs can't lose one.
    input.pressed = input.buttons & ~f.held;
    f.held = input.buttons;
    input.tick = Math.min(input.tick, this.tick);
    f.queue.push(input);
    // Too much buffered: fold the oldest into the next one (keep the newest move, OR the presses).
    while (f.queue.length > NET.INPUT_QUEUE_MAX) {
      const [oldest, next] = f.queue.splice(0, 2);
      f.queue.unshift({ ...next, pressed: next.pressed | oldest.pressed });
    }
    return true;
  }

  // A rejoining client starts counting seq from scratch, so forget the old stream.
  resetInput(playerId) {
    const f = this.byId.get(playerId);
    if (!f) return;
    f.queue = [];
    f.lastSeq = -1;
    f.ackSeq = -1;
    f.held = 0;
  }

  step() {
    if (!this.room.players.size) return this.onEmpty();
    this.tick++;
    for (const f of this.fighters) {
      if (f.alive && !this.room.players.has(f.id)) f.alive = false; // left the room
      if (!f.alive) continue;
      const input = f.queue.shift();
      // An empty queue repeats the last move with no new presses.
      if (input) {
        f.move = input.move;
        f.aim = input.aim;
        f.ackSeq = input.seq;
      }
      f.pressed = input ? input.pressed : 0;
      stepBody(f.body, f.move);
    }
    separateBodies(this.fighters.filter((f) => f.alive).map((f) => f.body));
    if (this.#snapshotDue()) this.emit('match:snapshot', this.snapshot(), { volatile: true });
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
      ...(perf && { tickMs: { avg: round2(perf.avgMs), max: round2(perf.maxMs) } }),
      fighters: this.fighters.map(({ id, body, aim, hp, alive }) => ({
        id,
        x: round2(body.x),
        y: round2(body.y),
        vx: round2(body.vx),
        vy: round2(body.vy),
        kx: round2(body.kx),
        ky: round2(body.ky),
        aim: round2(aim),
        hp,
        alive,
      })),
    };
  }
}
