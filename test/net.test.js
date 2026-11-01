import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClock, createInterpolator, createTicker } from '../public/js/net.js';
import { MAX_CATCHUP_TICKS, NET, TICK_MS, TICK_RATE, SNAPSHOT_RATE } from '../shared/constants.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('the ticker runs at the tick rate whatever the polling rate', () => {
  const ticker = createTicker(0);
  let steps = 0;
  for (let now = 0; now < 1000; now += 7) steps += ticker.advance(now);
  assert.equal(steps, TICK_RATE);
});

test('the ticker catches up a little, then skips a long stall', () => {
  const ticker = createTicker(0);
  assert.equal(ticker.advance(0), 1);
  assert.equal(ticker.advance(10_000), MAX_CATCHUP_TICKS);
  assert.equal(ticker.advance(10_000 + TICK_MS / 2), 0, 'the backlog was dropped');
  assert.equal(ticker.advance(10_000 + TICK_MS), 1);
});

test('ticker alpha goes 0 -> 1 across a step', () => {
  const ticker = createTicker(0);
  ticker.advance(0); // step at 0, next at TICK_MS
  near(ticker.alpha(0), 0);
  near(ticker.alpha(TICK_MS / 2), 0.5);
  near(ticker.alpha(TICK_MS * 5), 1);
});

// Snapshots every 1.5 ticks, delivered `latency` ms later plus jitter from `noise(i)`.
function feed(clock, { from = 0, count = 60, latency = 50, noise = () => 0, startTick = 0 } = {}) {
  let now = 0;
  for (let i = 0; i < count; i++) {
    const tick = startTick + Math.round((i * TICK_RATE) / SNAPSHOT_RATE);
    now = from + tick * TICK_MS + latency + noise(i);
    clock.onSnapshot(tick, now);
  }
  return now;
}

test('the clock locks onto the server tick, minus the latency', () => {
  const clock = createClock();
  assert.equal(clock.tickAt(0), null);
  const now = feed(clock, { latency: 100 });
  // A snapshot for tick T arrives 100ms after T: the estimate runs 100ms behind the server.
  const lastTick = Math.round((59 * TICK_RATE) / SNAPSHOT_RATE);
  near(clock.tickAt(now), lastTick, 0.01);
  near(clock.jitterMs, 0, 1);
});

test('one late snapshot barely moves the clock; jitter is measured', () => {
  const clock = createClock();
  const now = feed(clock, { noise: (i) => (i % 2 ? 40 : 0), count: 100 });
  const estimate = clock.tickAt(now);
  clock.onSnapshot(152, 152 * TICK_MS + 50 + 60); // 60ms later than usual
  assert.ok(Math.abs(clock.tickAt(now) - estimate) < 1);
  assert.ok(clock.jitterMs > 10, `jitter ${clock.jitterMs}`);
});

test('a big jump (dropped server ticks) is taken at once', () => {
  const clock = createClock();
  const now = feed(clock);
  // The server lost 30 ticks: snapshots now say tick 60 where 90 was expected.
  for (let i = 0; i < NET.CLOCK_JUMP_CONFIRM; i++) clock.onSnapshot(60 + i, now + 1000 + i * TICK_MS);
  near(clock.tickAt(now + 1000), 60, 0.01);
});

test('a single very late snapshot does not move the clock', () => {
  const clock = createClock();
  const now = feed(clock);
  const estimate = clock.tickAt(now);
  clock.onSnapshot(90, 90 * TICK_MS + 50 + 250);
  near(clock.tickAt(now), estimate, 1e-9);
});

const snap = (tick, fighters) => ({ tick, fighters });
const fighter = (id, x, more = {}) => ({ id, x, y: 100, vx: 0, vy: 0, kx: 0, ky: 0, aim: 0, alive: true, hp: 100, ...more });

test('interpolation blends positions between the snapshots around the render tick', () => {
  const interp = createInterpolator();
  interp.push(snap(10, [fighter(1, 100, { hp: 90 })]), 0);
  interp.push(snap(12, [fighter(1, 200, { hp: 50 })]), 0);
  const [f] = interp.sample(10.5);
  near(f.x, 125);
  assert.equal(f.hp, 90, 'discrete state from the nearer snapshot');
  assert.equal(interp.sample(11.5)[0].hp, 50);
});

test('interpolated aim takes the short way around', () => {
  const interp = createInterpolator();
  interp.push(snap(10, [fighter(1, 100, { aim: 3 })]), 0);
  interp.push(snap(11, [fighter(1, 100, { aim: -3 })]), 0);
  const { aim } = interp.sample(10.5)[0];
  near(Math.abs(Math.atan2(Math.sin(aim), Math.cos(aim))), Math.PI, 0.01);
});

test('past the newest snapshot it extrapolates briefly, then holds', () => {
  const interp = createInterpolator();
  interp.push(snap(10, [fighter(1, 500, { vx: 300 })]), 0);
  const perTick = 300 / TICK_RATE;
  near(interp.sample(11)[0].x, 500 + perTick);
  const maxTicks = (NET.MAX_EXTRAPOLATE_SNAPSHOTS * TICK_RATE) / SNAPSHOT_RATE;
  near(interp.sample(50)[0].x, 500 + perTick * maxTicks);
});

test('before the oldest snapshot it shows the oldest', () => {
  const interp = createInterpolator();
  interp.push(snap(10, [fighter(1, 100)]), 0);
  interp.push(snap(12, [fighter(1, 200)]), 0);
  assert.equal(interp.sample(5)[0].x, 100);
});

test('the interpolation delay grows with jitter, within its range', () => {
  const calm = createInterpolator();
  const rough = createInterpolator();
  for (let t = 1; t <= 100; t++) {
    calm.push(snap(t, []), 0);
    rough.push(snap(t, []), 1000);
  }
  near(calm.delayMs, NET.INTERP_MIN_MS, 0.5);
  near(rough.delayMs, NET.INTERP_MAX_MS, 0.5);
});

test('out-of-order snapshots are ignored and old ones are trimmed', () => {
  const interp = createInterpolator();
  interp.push(snap(10, [fighter(1, 100)]), 0);
  interp.push(snap(9, [fighter(1, 999)]), 0);
  assert.equal(interp.sample(9)[0].x, 100);
  for (let t = 11; t <= 100; t++) interp.push(snap(t, [fighter(1, t)]), 0);
  assert.equal(interp.sample(0)[0].x, 100 - NET.INTERP_BUFFER_TICKS);
});
