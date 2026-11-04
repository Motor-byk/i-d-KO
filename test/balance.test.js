import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamBuffs } from '../server/game/balance.js';
import { Match } from '../server/game/match.js';
import { BALANCE, BUTTONS, COMBAT, PLAYER } from '../shared/constants.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !== ${b}`);

function fakeMatch(teamSizes) {
  const players = new Map();
  let id = 1;
  const options = teamSizes.map((size, i) => {
    for (let k = 0; k < size; k++, id++) players.set(id, { id, teamId: i + 1 });
    return { id: i + 1 };
  });
  const sent = [];
  const match = new Match({ room: { players, options }, emit: (_e, p) => sent.push(p), onEmpty: () => {} });
  return { match, sent };
}

test('a team above the ratio gets nothing', () => {
  assert.deepEqual(teamBuffs(5, 5), { hp: 1, damage: 1 });
  assert.deepEqual(teamBuffs(3, 5), { hp: 1, damage: 1 });
  assert.deepEqual(teamBuffs(2, 3), { hp: 1, damage: 1 });
});

test('a dark horse gets a buff per player it is short, from exactly the ratio', () => {
  const { hp, damage } = teamBuffs(2, 4);
  near(hp, 1 + 2 * BALANCE.HP_PER_MISSING);
  near(damage, 1 + 2 * BALANCE.DMG_PER_MISSING);
  near(teamBuffs(1, 2).hp, 1 + BALANCE.HP_PER_MISSING);
});

test('buffs are capped', () => {
  const { hp, damage } = teamBuffs(1, 9);
  near(hp, 1 + BALANCE.HP_CAP);
  near(damage, 1 + BALANCE.DMG_CAP);
});

test('a match applies the buffs: dark horses start with more HP and hit harder, and snapshots say so', () => {
  const { match, sent } = fakeMatch([4, 1]);
  const big = match.fighters[0];
  const horse = match.fighters[4];
  assert.equal(big.maxHp, PLAYER.BASE_HP);
  assert.equal(big.hp, PLAYER.BASE_HP);
  assert.equal(horse.maxHp, 130);
  assert.equal(horse.hp, 130);

  horse.body.x = 500; horse.body.y = 500;
  big.body.x = 570; big.body.y = 500;
  match.input(horse.id, { seq: 1, tick: 0, move: { x: 0, y: 0 }, aim: 0, aimed: true, buttons: BUTTONS.JAB });
  for (let i = 0; i < 10; i++) match.step();
  near(big.hp, PLAYER.BASE_HP - COMBAT.JAB[0].damage * (1 + 3 * BALANCE.DMG_PER_MISSING));
  const snap = sent.at(-1).fighters;
  assert.equal(snap.find((f) => f.id === horse.id).maxHp, 130);
  assert.equal(snap.find((f) => f.id === big.id).maxHp, PLAYER.BASE_HP);
});
