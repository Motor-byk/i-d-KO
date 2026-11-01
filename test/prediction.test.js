import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPredictor } from '../public/js/net.js';
import { Match } from '../server/game/match.js';
import { BUTTONS, NET } from '../shared/constants.js';
import { STATE } from '../shared/combat-state.js';

// One player per team, spawned far apart, so nothing server-only (hits, pushes) touches player 1.
function soloMatch() {
  const players = new Map([[1, { id: 1, teamId: 1 }], [2, { id: 2, teamId: 2 }]]);
  const options = [{ id: 1 }, { id: 2 }];
  return new Match({ room: { players, options }, emit: () => {}, onEmpty: () => {} });
}

const me = (snap) => snap.fighters.find((f) => f.id === 1);

// Walks right, jabs, dashes up, then heavy-charges for a while: movement and combat timing.
function script(n) {
  let buttons = 0;
  if (n === 10) buttons = BUTTONS.JAB;
  if (n === 20) buttons = BUTTONS.DASH;
  if (n >= 30 && n < 45) buttons = BUTTONS.HEAVY;
  return { seq: n, tick: 0, move: n >= 20 ? { x: Math.SQRT1_2, y: -Math.SQRT1_2 } : { x: 1, y: 0 }, aim: 0.5, aimed: true, buttons };
}

test('replaying unacked inputs over server state matches the server once it catches up', () => {
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
});

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
  assert.equal(predictor.drawn.x, 500, 'drawn where it was');
  for (let seq = 1; seq <= 20; seq++) predictor.step(idle(seq));
  assert.ok(Math.abs(predictor.drawn.x - 510) < 0.1, 'and eased onto the new spot');

  predictor.reconcile(at(510 + NET.SNAP_DISTANCE + 1), 20);
  assert.equal(predictor.drawn.x, predictor.state.body.x, 'snapped');
});

test('predicted combat state is a copy: replays never touch the snapshot', () => {
  const predictor = createPredictor();
  const fighter = { x: 500, y: 500, vx: 0, vy: 0, kx: 0, ky: 0, cs: soloMatch().byId.get(1).cs };
  predictor.reconcile(fighter, -1);
  predictor.step({ seq: 1, move: { x: 0, y: 0 }, aim: 0, buttons: BUTTONS.JAB });
  assert.equal(predictor.state.cs.state, STATE.JAB);
  assert.equal(fighter.cs.state, STATE.IDLE);
});
