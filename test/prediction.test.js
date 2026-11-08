import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPredictor } from '../public/js/net.js';
import { Match } from '../server/game/match.js';
import { BUTTONS, NET, PLAYER } from '../shared/constants.js';
import { STATE } from '../shared/combat-state.js';

// One player per team, spawned far apart, so nothing server-only (hits, pushes) touches player 1.
function soloMatch() {
  const players = new Map([[1, { id: 1, teamId: 1 }], [2, { id: 2, teamId: 2 }]]);
  const options = [{ id: 1 }, { id: 2 }];
  return new Match({ room: { players, options }, emit: () => {}, onEmpty: () => {} });
}

const me = (snap) => snap.fighters.find((f) => f.id === 1);

// Walks right, jabs, dashes up, then heavy-charges for a while: movement and combat timing.
function jabDashHeavy(n) {
  let buttons = 0;
  if (n === 10) buttons = BUTTONS.JAB;
  if (n === 20) buttons = BUTTONS.DASH;
  if (n >= 30 && n < 45) buttons = BUTTONS.HEAVY;
  return { seq: n, tick: 0, move: n >= 20 ? { x: Math.SQRT1_2, y: -Math.SQRT1_2 } : { x: 1, y: 0 }, aim: 0.5, buttons };
}

// Spins while walking right, then dash-cancels its recovery up and spins again.
function spinScript(n) {
  let buttons = 0;
  if (n === 5 || n === 40) buttons = BUTTONS.SPIN;
  if (n === 16) buttons = BUTTONS.DASH;
  return { seq: n, tick: 0, move: n >= 16 ? { x: 0, y: -1 } : { x: 1, y: 0 }, aim: 0.5, buttons };
}

// Walks left to the wall (player 1 spawns 140 from it), then fires a full heavy into it and slides off.
function wallRecoilScript(n) {
  let buttons = 0;
  if (n >= 10 && n < 45) buttons = BUTTONS.HEAVY;
  return { seq: n, tick: 0, move: n < 10 ? { x: -1, y: 0 } : { x: 0, y: 0 }, aim: Math.PI, buttons };
}

const SCRIPTS = [['jab, dash, heavy', jabDashHeavy], ['spin', spinScript], ['heavy wall recoil', wallRecoilScript]];

for (const [name, script] of SCRIPTS) {
test(`replaying unacked inputs over server state matches the server once it catches up (${name})`, () => {
  const match = soloMatch();
  const predictor = createPredictor();
  predictor.reconcile(me(match.snapshot()), -1);

  const LATENCY = 3; // ticks each way
  const inFlight = [];  // [arrivalTick, input]
  const snapshots = []; // [arrivalTick, snapshot]
  const errors = [];
  for (let n = 1; n <= 80; n++) {
    const input = script(Math.min(n, 60));
    input.seq = n;
    predictor.step(input);
    inFlight.push([n + LATENCY, input]);
    while (inFlight[0]?.[0] <= n) match.input(1, inFlight.shift()[1]);
    match.step();
    snapshots.push([n + LATENCY, match.snapshot()]);
    while (snapshots[0]?.[0] <= n) {
      const snap = snapshots.shift()[1];
      errors.push(predictor.reconcile(me(snap), snap.acks[1]));
    }
  }
  // Snapshots round positions to 0.01, so replays drift by about that much, never more.
  assert.ok(Math.max(...errors) < 0.1, `max correction ${Math.max(...errors)}`);
  // Let the server apply the inputs still in flight, then compare.
  for (const [, input] of inFlight) {
    match.input(1, input);
    match.step();
  }
  const last = match.snapshot();
  predictor.reconcile(me(last), last.acks[1]);
  const server = match.byId.get(1);
  const { body, cs } = predictor.state;
  assert.ok(Math.hypot(body.x - server.body.x, body.y - server.body.y) < 0.1);
  assert.equal(cs.state, server.cs.state);
  assert.equal(cs.dashCooldown, server.cs.dashCooldown);
  assert.equal(cs.recoil, server.cs.recoil);
});
}

test('a hit the client did not predict shows up as a correction and is replayed over', () => {
  const match = soloMatch();
  const predictor = createPredictor();
  predictor.reconcile(me(match.snapshot()), -1);
  for (let n = 1; n <= 5; n++) {
    const input = { seq: n, tick: 0, move: { x: 1, y: 0 }, aim: 0, buttons: 0 };
    predictor.step(input);
    if (n <= 3) match.input(1, input);
    if (n <= 3) match.step();
  }
  // Server-side knockback the client never saw.
  match.byId.get(1).body.kx = -600;
  const snap = match.snapshot();
  const error = predictor.reconcile(me(snap), snap.acks[1]);
  assert.ok(error > 0);
  // Inputs 4 and 5 are replayed on top of the knocked-back state.
  assert.ok(predictor.state.body.x < match.byId.get(1).body.x);
});

test('unacked inputs are replayed; acked ones are dropped', () => {
  const predictor = createPredictor();
  const start = { x: 500, y: 500, vx: 0, vy: 0, kx: 0, ky: 0, cs: soloMatch().byId.get(1).cs };
  predictor.reconcile(start, -1);
  const walk = (seq) => ({ seq, move: { x: 1, y: 0 }, aim: 0, buttons: 0 });
  for (let seq = 1; seq <= 4; seq++) predictor.step(walk(seq));
  const predicted = predictor.state.body.x;

  // The server has applied nothing yet: same start, all 4 replayed, same result.
  assert.equal(predictor.reconcile(start, -1), 0);
  assert.equal(predictor.state.body.x, predicted);
  // The server applied all 4 and says you're at 600: nothing left to replay.
  predictor.reconcile({ ...start, x: 600 }, 4);
  assert.equal(predictor.state.body.x, 600);
});

test('an ack going backwards (rejoin) forgets the old inputs', () => {
  const predictor = createPredictor();
  const start = { x: 500, y: 500, vx: 0, vy: 0, kx: 0, ky: 0, cs: soloMatch().byId.get(1).cs };
  predictor.reconcile(start, 10);
  for (let seq = 11; seq <= 14; seq++) predictor.step({ seq, move: { x: 1, y: 0 }, aim: 0, buttons: 0 });
  predictor.reconcile(start, -1);
  assert.equal(predictor.state.body.x, 500);
});

test('small corrections ease out, big ones snap', () => {
  const predictor = createPredictor();
  const cs = soloMatch().byId.get(1).cs;
  const at = (x) => ({ x, y: 500, vx: 0, vy: 0, kx: 0, ky: 0, cs });
  const idle = (seq) => ({ seq, move: { x: 0, y: 0 }, aim: 0, buttons: 0 });
  predictor.reconcile(at(500), 0);

  predictor.reconcile(at(510), 0);
  assert.equal(predictor.drawnAt(1).x, 500, 'drawn where it was');
  for (let seq = 1; seq <= 20; seq++) predictor.step(idle(seq));
  assert.ok(Math.abs(predictor.drawnAt(1).x - 510) < 0.1, 'and eased onto the new spot');

  predictor.reconcile(at(510 + NET.SNAP_DISTANCE + 1), 20);
  assert.equal(predictor.drawnAt(1).x, predictor.state.body.x, 'snapped');
});

test('predicted combat state is a copy: replays never touch the snapshot', () => {
  const predictor = createPredictor();
  const fighter = { x: 500, y: 500, vx: 0, vy: 0, kx: 0, ky: 0, cs: soloMatch().byId.get(1).cs };
  predictor.reconcile(fighter, -1);
  predictor.step({ seq: 1, move: { x: 0, y: 0 }, aim: 0, buttons: BUTTONS.JAB });
  assert.equal(predictor.state.cs.state, STATE.JAB);
  assert.equal(fighter.cs.state, STATE.IDLE);
});

test('your own landed hits are predicted: a jab string on an enemy pinned at a wall matches the server', () => {
  const match = soloMatch();
  const meF = match.byId.get(1);
  const enemy = match.byId.get(2);
  Object.assign(meF.body, { x: PLAYER.RADIUS * 3 + 5, y: 500 }); // just clear of the enemy: body pushes aren't predicted
  Object.assign(enemy.body, { x: PLAYER.RADIUS, y: 500 });
  const predictor = createPredictor();
  predictor.reconcile(me(match.snapshot()), -1);

  const LATENCY = 3; // ticks each way
  const inFlight = [];
  const snapshots = [];
  let seenSnap = match.snapshot(); // the newest snapshot you have: what you see and stamp inputs with
  const errors = [];
  const predicted = new Map(); // seq -> your combat timing right after predicting it
  const server = new Map();    // seq -> the server's right after applying it
  const timing = ({ state, t, hitstop, stringHits }) => ({ state, t, hitstop, stringHits });
  let recoiled = false;
  for (let n = 1; n <= 60; n++) {
    const buttons = [1, 10, 24].includes(n) ? BUTTONS.JAB : 0;
    const input = { seq: n, tick: seenSnap.tick, move: { x: 0, y: 0 }, aim: Math.PI, buttons };
    const seen = seenSnap.fighters.filter((f) => f.id !== 1 && f.alive)
      .map(({ id, x, y, cs }) => ({ id, x, y, cs, enemy: true }));
    predictor.step(input, seen);
    predicted.set(n, timing(predictor.state.cs));
    inFlight.push([n + LATENCY, input]);
    while (inFlight[0]?.[0] <= n) match.input(1, inFlight.shift()[1]);
    match.step();
    if (meF.ackSeq > 0 && !server.has(meF.ackSeq)) server.set(meF.ackSeq, timing(meF.cs)); // the tick that applied it
    recoiled ||= meF.cs.recoil;
    snapshots.push([n + LATENCY, match.snapshot()]);
    while (snapshots[0]?.[0] <= n) {
      seenSnap = snapshots.shift()[1];
      errors.push(predictor.reconcile(me(seenSnap), seenSnap.acks[1]));
    }
  }
  assert.ok(enemy.hp <= PLAYER.BASE_HP - 20, `the whole string landed (enemy hp ${enemy.hp})`);
  assert.ok(recoiled, 'the jabs reached the wall too');
  // Every hit's freeze and string credit is predicted on the same input the server lands it on.
  for (const [seq, cs] of server) assert.deepEqual(predicted.get(seq), cs, `seq ${seq}`);
  assert.ok(Math.max(...errors) < 0.1, `max correction ${Math.max(...errors)}`);
});
