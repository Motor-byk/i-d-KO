// Developer testing tool: fills a room with headless players, for load and network checks.
// They connect like ordinary players; there's nothing bot-specific on the server.
//
//   node scripts/bots.js <code> <count> [--latency=ms] [--jitter=ms] [--team=name] [--url=url] [--origin=url]
//
// --latency and --jitter are added to each direction (so the RTT grows by twice that).
// Bots spread evenly over the options unless --team names one. Start the match from a browser.
// They leave once the match is decided. The first bot logs the server's tick time.
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { io } from 'socket.io-client';
import { BUTTONS, COMBAT, PLAYER, ROOM, TICK_MS } from '../shared/constants.js';

const DEFAULT_URL = 'http://localhost:3000';
const JAB_RANGE = PLAYER.RADIUS * 2 + COMBAT.JAB[0].reach;
const WALK_STOP_RANGE = PLAYER.RADIUS * 2 + 10;
// Per tick: enough of each move to keep the whole combat kit in play.
const DASH_CHANCE = 0.02;
const PARRY_CHANCE = 0.02;
const HEAVY_CHANCE = 0.01;
const HEAVY_HOLD_TICKS = 20;
// Walking but not getting anywhere means a pillar's in the way: go sideways for a while.
const STUCK_TICKS = 10; // long enough to span several snapshots (positions only change on those)
const STUCK_DISTANCE = 1;
const SIDESTEP_TICKS = 30;
const TICK_LOG_SECONDS = 5;

// Runs callbacks after latency + up to jitter ms, always in order: a websocket never reorders.
export function createDelayLine(latency = 0, jitter = 0, random = Math.random) {
  if (!latency && !jitter) return (fn) => fn();
  let tail = Promise.resolve();
  return (fn) => {
    const delay = sleep(latency + random() * jitter); // timed from now, but can't overtake the one before
    tail = tail.then(() => delay).then(fn);
  };
}

// Chases the nearest enemy and throws whatever fits. next(me, enemies) returns { move, aim, buttons }.
export function createBrain(random = Math.random) {
  let jabDown = false;
  let heavyLeft = 0;
  let stuck = 0;
  let sidestepLeft = 0;
  let sidestepDir = 1;
  let last = { x: Infinity, y: Infinity };

  // The way to walk toward aim, around whatever's in the way.
  const heading = (me, aim, walking) => {
    stuck = walking && Math.hypot(me.x - last.x, me.y - last.y) < STUCK_DISTANCE ? stuck + 1 : 0;
    last = { x: me.x, y: me.y };
    if (stuck >= STUCK_TICKS) {
      stuck = 0;
      sidestepLeft = SIDESTEP_TICKS;
      sidestepDir = random() < 0.5 ? -1 : 1;
    }
    if (sidestepLeft <= 0) return aim;
    sidestepLeft--;
    return aim + (sidestepDir * Math.PI) / 2;
  };

  return {
    next(me, enemies) {
      let target = null;
      let distance = Infinity;
      for (const e of enemies) {
        const d = Math.hypot(e.x - me.x, e.y - me.y);
        if (d < distance) [target, distance] = [e, d];
      }
      if (!target) return { move: { x: 0, y: 0 }, aim: me.aim, buttons: 0 };

      const aim = Math.atan2(target.y - me.y, target.x - me.x);
      const walk = distance > WALK_STOP_RANGE ? 1 : 0;
      const way = heading(me, aim, walk > 0);
      const move = { x: Math.cos(way) * walk, y: Math.sin(way) * walk };
      let buttons = 0;
      jabDown = !jabDown; // a jab needs a fresh press
      if (heavyLeft > 0) {
        heavyLeft--;
        buttons = BUTTONS.HEAVY;
      } else if (distance > JAB_RANGE) {
        if (me.cs.dashCooldown === 0 && random() < DASH_CHANCE) buttons = BUTTONS.DASH;
      } else if (random() < PARRY_CHANCE) {
        buttons = BUTTONS.PARRY;
      } else if (random() < HEAVY_CHANCE) {
        heavyLeft = HEAVY_HOLD_TICKS;
        buttons = BUTTONS.HEAVY;
      } else if (jabDown) {
        buttons = BUTTONS.JAB;
      }
      return { move, aim, buttons };
    },
  };
}

// Joins the room and plays until the match is decided or the connection ends.
// Resolves with { error } if it couldn't get in, otherwise with { result } (null if cut off).
export function startBot({ url, origin, code, nickname, index = 0, team, latency, jitter, log = () => {} }) {
  const socket = io(url, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    ...(origin && { extraHeaders: { origin } }),
  });
  const send = createDelayLine(latency, jitter);
  const receive = createDelayLine(latency, jitter);
  const on = (event, handler) => socket.on(event, (payload) => receive(() => handler(payload)));
  const brain = createBrain();

  return new Promise((resolve) => {
    let playerId = null;
    let room = null;
    let snap = null;
    let seq = 0;
    let picked; // the option last asked for; room updates arrive far more often than it changes
    let result = null;
    let inputTimer = null;
    let ticksLogged = 0;

    const pickTeam = () => {
      const { options } = room;
      const wanted = team
        ? options.find((o) => o.name.toLowerCase() === team.toLowerCase())
        : options[index % options.length];
      if (!wanted || wanted.id === picked) return;
      picked = wanted.id;
      send(() => socket.emit('team:pick', { optionId: wanted.id }));
    };

    const sendInput = () => {
      const me = snap?.fighters.find((f) => f.id === playerId && f.alive);
      if (!me) return;
      const teams = new Map(room.players.map((p) => [p.id, p.teamId]));
      const myTeam = teams.get(playerId);
      const enemies = snap.fighters.filter((f) => f.alive && teams.get(f.id) !== myTeam);
      const input = { seq: ++seq, tick: snap.tick, ...brain.next(me, enemies) };
      send(() => socket.emit('match:input', input));
    };

    const onRoom = (next) => {
      room = next;
      if (room.state === 'lobby') pickTeam();
      if (room.state === 'results' && !result) {
        result = room.result;
        send(() => socket.emit('room:leave', {}, () => socket.disconnect()));
      }
    };

    on('room:update', onRoom);
    on('match:snapshot', (next) => {
      snap = next;
      if (next.tickMs && ++ticksLogged % TICK_LOG_SECONDS === 0) {
        log(`server tick ${next.tick}: avg ${next.tickMs.avg}ms, max ${next.tickMs.max}ms`);
      }
    });
    on('connect', () => {
      send(() => socket.emit('room:join', { code, nickname }, (res) => receive(() => {
        if (res.error) {
          resolve({ error: res.error }); // first: disconnecting resolves too
          socket.disconnect();
          return;
        }
        playerId = res.playerId;
        onRoom(res.room);
        inputTimer = setInterval(sendInput, TICK_MS);
      })));
    });
    socket.on('connect_error', (err) => {
      socket.disconnect();
      resolve({ error: err.message });
    });
    socket.on('disconnect', () => {
      clearInterval(inputTimer);
      resolve({ result });
    });
  });
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      latency: { type: 'string', default: '0' },
      jitter: { type: 'string', default: '0' },
      team: { type: 'string' },
      url: { type: 'string', default: DEFAULT_URL },
      origin: { type: 'string' },
    },
  });
  const [code, countArg] = positionals;
  const count = Number(countArg);
  const latency = Number(values.latency);
  const jitter = Number(values.jitter);
  const valid = code && Number.isInteger(count) && count >= 1 && count <= ROOM.MAX_PLAYERS
    && latency >= 0 && latency < Infinity && jitter >= 0 && jitter < Infinity;
  if (!valid) {
    console.error('Usage: node scripts/bots.js <code> <count> [--latency=ms] [--jitter=ms] [--team=name] [--url=url] [--origin=url]');
    process.exit(1);
  }

  // A per-run tag, so a second run doesn't clash with bots still holding a seat from the first.
  const run = Math.random().toString(36).slice(2, 5);
  const outcomes = await Promise.all(Array.from({ length: count }, (_, index) => {
    const nickname = `Bot${index + 1}-${run}`;
    return startBot({
      ...values, latency, jitter, code, nickname, index, log: index === 0 ? console.log : undefined,
    }).then((outcome) => {
      if (outcome.error) console.error(`${nickname} couldn't join: ${outcome.error}`);
      return outcome;
    });
  }));
  const decided = outcomes.find((o) => o.result)?.result;
  if (decided) console.log(`Match decided, winning option id: ${decided.optionId}`);
  process.exit(outcomes.every((o) => o.error) ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
