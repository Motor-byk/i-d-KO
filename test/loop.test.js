import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameLoop } from '../server/loop.js';
import { TICK_RATE, MAX_CATCHUP_TICKS } from '../shared/constants.js';

const TICK_MS = 1000 / TICK_RATE;

function manualLoop(opts) {
  let t = 0;
  const loop = new GameLoop({ now: () => t, ...opts });
  return { loop, advance: (ms) => { t += ms; return loop.update(); } };
}

const counter = () => ({ ticks: 0, step() { this.ticks++; } });

test('runs one tick per elapsed tick interval and keeps the remainder', (t) => {
  const { loop, advance } = manualLoop();
  t.after(() => loop.stop());
  const room = counter();
  loop.add(room);
  loop.update(); // first wake runs one tick
  assert.equal(room.ticks, 1);
  assert.equal(advance(TICK_MS * 0.6), 0);
  assert.equal(advance(TICK_MS * 0.6), 1);
  assert.equal(advance(TICK_MS * 2), 2);
  assert.equal(room.ticks, 4);
});

test('caps catch-up ticks and drops the backlog', (t) => {
  const { loop, advance } = manualLoop();
  t.after(() => loop.stop());
  const room = counter();
  loop.add(room);
  loop.update();
  assert.equal(advance(TICK_MS * 10), MAX_CATCHUP_TICKS);
  assert.ok(loop.droppedTicks >= 10 - MAX_CATCHUP_TICKS);
  assert.equal(advance(TICK_MS), 1, 'back to normal pace after the drop');
});

test('a throwing room is removed and reported; other rooms keep ticking', (t) => {
  const failures = [];
  const { loop, advance } = manualLoop({ onError: (entity, err) => failures.push([entity, err.message]) });
  t.after(() => loop.stop());
  const bad = { step() { throw new Error('boom'); } };
  const good = counter();
  loop.add(bad);
  loop.add(good);
  loop.update();
  advance(TICK_MS);
  assert.deepEqual(failures, [[bad, 'boom']]);
  assert.equal(good.ticks, 2);
  assert.equal(loop.stats(bad), undefined);
  assert.ok(loop.stats(good).avgMs >= 0);
});

test('real timer ticks at roughly the tick rate and stops when empty', async () => {
  const loop = new GameLoop();
  const room = counter();
  loop.add(room);
  await new Promise((r) => setTimeout(r, 300));
  loop.remove(room);
  assert.equal(loop.timer, null);
  const expected = 300 / TICK_MS;
  assert.ok(room.ticks >= expected - 3 && room.ticks <= expected + 2, `ticks=${room.ticks}`);
});

test('a throwing onError handler does not escape the loop', (t) => {
  const { loop, advance } = manualLoop({ onError: () => { throw new Error('handler'); } });
  t.after(() => loop.stop());
  const logged = t.mock.method(console, 'error', () => {});
  const good = counter();
  loop.add({ step() { throw new Error('boom'); } });
  loop.add(good);
  assert.doesNotThrow(() => loop.update());
  advance(TICK_MS);
  assert.equal(good.ticks, 2);
  assert.equal(logged.mock.callCount(), 1);
});
