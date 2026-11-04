import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJuice } from '../public/js/juice.js';
import { DT, JUICE, RING, SNAPSHOT_RATE, TICK_MS, TICK_RATE } from '../shared/constants.js';

const fighter = (id, hp, alive = true) => ({ id, x: 100, y: 200, hp, alive });
const snap = (tick, ...fighters) => ({ tick, suddenDeath: 0, fighters });
const juice = () => createJuice({ random: () => 0.5 }); // 0.5: no float spread

test('losing HP floats a damage number; gaining it does not', () => {
  const j = juice();
  j.onSnapshot(snap(1, fighter(1, 100)), 0);
  assert.deepEqual(j.floatsAt(1), []);
  j.onSnapshot(snap(2, fighter(1, 91.5)), 0);
  const [float] = j.floatsAt(2);
  assert.equal(float.text, '9'); // 8.5 rounded
  assert.equal(float.ko, false);
  j.onSnapshot(snap(3, fighter(1, 96.5)), 0); // a grace parry gave it back
  assert.equal(j.floatsAt(3).length, 1, 'only the first number');
});

test('the slow burn of the ring floats nothing, even over a late snapshot', () => {
  const j = juice();
  const perSnapshot = RING.DAMAGE_PER_SECOND * DT * (TICK_RATE / SNAPSHOT_RATE);
  assert.ok(perSnapshot * 2 < JUICE.DAMAGE_MIN);
  j.onSnapshot(snap(1, fighter(1, 50)), 0);
  j.onSnapshot(snap(2, fighter(1, 50 - perSnapshot * 2)), 0);
  assert.deepEqual(j.floatsAt(2), []);
});

test('a KO floats once', () => {
  const j = juice();
  j.onSnapshot(snap(1, fighter(1, 5)), 0);
  j.onSnapshot(snap(2, fighter(1, 0, false)), 0);
  assert.deepEqual(j.floatsAt(2).map((f) => [f.text, f.ko]), [['5', false], ['KO!', true]]);
  j.onSnapshot(snap(3, fighter(1, 0, false)), 0);
  assert.equal(j.floatsAt(3).length, 2);
});

test('a sudden death start is a KO where they stood, not a big hit, and only for the tied', () => {
  const j = juice();
  const quiet = () => Math.hypot(...Object.values(j.shakeAt(0)));
  j.onSnapshot(snap(1, fighter(1, 60), fighter(2, 0, false)), 1);
  // Revived on the tick they fell, so no snapshot shows them dead. Fighter 2 fell earlier and stays out.
  j.onSnapshot({ tick: 2, suddenDeath: 1, fighters: [{ ...fighter(1, 1), x: 800 }, fighter(2, 0, false)] }, 1);
  const floats = j.floatsAt(2);
  assert.deepEqual(floats.map((f) => f.text), ['KO!']);
  assert.equal(floats[0].x, 100, 'where it fell, not where it respawned');
  assert.ok(Math.abs(quiet() - JUICE.SHAKE_KO) < 1e-9);
  // From here on it's business as usual.
  j.onSnapshot({ tick: 3, suddenDeath: 1, fighters: [{ ...fighter(1, 0, false), x: 800 }, fighter(2, 0, false)] }, 1);
  assert.deepEqual(j.floatsAt(3).map((f) => f.text), ['KO!', '1', 'KO!']);
});

test('floats wait for the interpolated view, rise, fade and expire', () => {
  const j = juice();
  j.onSnapshot(snap(10, fighter(1, 100)), 0);
  j.onSnapshot(snap(11, fighter(1, 80)), 0);
  assert.deepEqual(j.floatsAt(10.5), [], 'not on screen yet');
  const [a] = j.floatsAt(11);
  const [b] = j.floatsAt(15);
  assert.ok(b.y < a.y && b.alpha < a.alpha);
  assert.deepEqual(j.floatsAt(11 + JUICE.FLOAT_TICKS), []);
});

test('getting hit shakes harder than watching a hit; the shake decays and stops', () => {
  const amount = (meId) => {
    const j = juice();
    j.onSnapshot(snap(1, fighter(1, 100)), meId);
    j.onSnapshot(snap(2, fighter(1, 90)), meId);
    const { x, y } = j.shakeAt(0);
    return Math.hypot(x, y);
  };
  assert.ok(amount(1) > amount(2));
  assert.ok(amount(2) > 0);

  const j = juice();
  j.onSnapshot(snap(1, fighter(1, 100)), 1);
  j.onSnapshot(snap(2, fighter(1, 0, false)), 1);
  assert.ok(Math.hypot(...Object.values(j.shakeAt(0))) <= JUICE.SHAKE_MAX + 1e-9);
  const later = j.shakeAt(TICK_MS * 200);
  assert.deepEqual(later, { x: 0, y: 0 });
});
