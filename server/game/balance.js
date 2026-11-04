import { BALANCE } from '../../shared/constants.js';

// Dark horse: a team at most DARK_HORSE_RATIO the size of the largest gets capped HP and damage
// buffs, per player it's short of that team. Majority still has the advantage.
// Returns the multipliers for a team of this size.
export function teamBuffs(size, largest) {
  if (size > largest * BALANCE.DARK_HORSE_RATIO) return { hp: 1, damage: 1 };
  const missing = largest - size;
  return {
    hp: 1 + Math.min(BALANCE.HP_CAP, missing * BALANCE.HP_PER_MISSING),
    damage: 1 + Math.min(BALANCE.DMG_CAP, missing * BALANCE.DMG_PER_MISSING),
  };
}
