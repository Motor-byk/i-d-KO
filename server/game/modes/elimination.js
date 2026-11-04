import { ARENA, RING } from '../../../shared/constants.js';
import { round2 } from '../../../shared/math.js';
import { matchRing, suddenDeathRing, ringRadius, applyRingDamage } from '../ring.js';

// A game mode decides how a match plays out and who wins. Interface:
//   onStart(match)     once, when the match is created
//   onTick(match)      every tick, after hits
//   checkWinner(match) every tick, after onTick. Returns { teamId } when it's decided (null: nobody
//                      is left to win), or null to keep fighting
//   publicState(match) extra snapshot fields for the client

const teamsOf = (fighters) => new Set(fighters.map((f) => f.teamId));

// Tied fighters around the center pillar, evenly spaced and facing in.
function suddenDeathSpawn(index, count) {
  const angle = Math.PI + (2 * Math.PI * index) / count;
  return {
    x: ARENA.WIDTH / 2 + Math.cos(angle) * RING.SUDDEN_DEATH_SPAWN_RADIUS,
    y: ARENA.HEIGHT / 2 + Math.sin(angle) * RING.SUDDEN_DEATH_SPAWN_RADIUS,
    aim: angle + Math.PI,
  };
}

// Elimination: one life, the ring closes, the last team standing wins. If the last fighters of
// every remaining team fall on the same tick, they fight on in sudden death: 1 HP in a tiny ring
// that keeps closing, so a stall can't last. Repeats if they tie again.
export function eliminationMode() {
  let ring = matchRing();
  let suddenDeaths = 0;
  let standing = []; // who was alive at the last check: on a tie, these are the tied fighters

  return {
    onStart(match) {
      standing = match.fighters;
    },

    onTick(match) {
      applyRingDamage(match.fighters, ringRadius(ring, match.tick));
    },

    checkWinner(match) {
      const alive = match.fighters.filter((f) => f.alive);
      const teams = teamsOf(alive);
      if (teams.size === 1) return { teamId: alive[0].teamId };
      if (teams.size > 1) {
        standing = alive;
        return null;
      }
      // Whoever just left the room isn't tied, they're gone.
      const tied = standing.filter((f) => match.room.players.has(f.id));
      if (teamsOf(tied).size < 2) return { teamId: tied[0]?.teamId ?? null };
      ring = suddenDeathRing(match.tick);
      suddenDeaths++;
      tied.forEach((f, i) => match.revive(f, suddenDeathSpawn(i, tied.length), RING.SUDDEN_DEATH_HP));
      standing = tied;
      return null;
    },

    publicState: (match) => ({ ring: round2(ringRadius(ring, match.tick)), suddenDeath: suddenDeaths }),
  };
}
