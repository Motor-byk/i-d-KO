import { NET, TICK_RATE } from './constants.js';
import { STATE } from './combat-state.js';

// Lag compensation's limits, shared so the client can tell which tick the server will judge its
// hits at (server/game/lagcomp.js does the rewinding).

// Rewinds are capped at LAG_COMP_MAX_MS: a slower connection has its hits judged later than it saw.
export const MAX_REWIND_TICKS = Math.round((NET.LAG_COMP_MAX_MS * TICK_RATE) / 1000);

// A target in one of these states right now is judged where it is now, not rewound, so defensive
// moves keep working at any ping.
export const NO_REWIND = new Set([STATE.DASH, STATE.PARRY, STATE.BURST]);

// How many ticks to rewind for an input stamped with inputTick, applied at serverTick.
export const rewindTicks = (serverTick, inputTick) =>
  Math.max(0, Math.min(MAX_REWIND_TICKS, serverTick - inputTick));

// The view tick an input is stamped with, as the server accepts it: never backwards and at most
// MAX_STAMP_STEP ahead of the previous stamp (lastStamp < 0: no previous one).
export const clampStamp = (tick, lastStamp) =>
  (lastStamp < 0 ? tick : Math.max(lastStamp, Math.min(tick, lastStamp + NET.MAX_STAMP_STEP)));
