// Every tunable number lives here. Shared by server and client.
// Durations in the simulation are in ticks (1 tick = 1 / TICK_RATE seconds).

export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 20;
export const MAX_CATCHUP_TICKS = 3;

export const ROOM = {
  CODE_LENGTH: 4,
  CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', // no 0/O/1/I
  MAX_PLAYERS: 10,
  MIN_OPTIONS: 2,
  MAX_OPTIONS: 10,
  MAX_OPTION_LENGTH: 20,
  MAX_NICKNAME_LENGTH: 16,
  LOBBY_GRACE_MS: 60_000,
  MATCH_GRACE_MS: 20_000,
  JOIN_ATTEMPTS_PER_MINUTE: 20,
  REJOIN_ATTEMPTS_PER_MINUTE: 60,
  EVENTS_PER_SECOND: 20, // lobby events per socket; match inputs have their own limit
  MAX_ROOMS: 300,
};

export const TEAM_COLORS = [
  '#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#9b5de5',
  '#f15bb5', '#fb8500', '#8ac926', '#00bbf9', '#e5e5e5',
];

export const ARENA = {
  WIDTH: 1600,
  HEIGHT: 1000,
  // Solid rectangular pillars: x, y = top-left corner.
  PILLARS: [
    { x: 340, y: 230, w: 120, h: 120 },
    { x: 1140, y: 230, w: 120, h: 120 },
    { x: 740, y: 440, w: 120, h: 120 },
    { x: 340, y: 650, w: 120, h: 120 },
    { x: 1140, y: 650, w: 120, h: 120 },
  ],
  // Teams spawn spread around an ellipse this far in from the walls, members side by side.
  SPAWN_INSET_X: 140,
  SPAWN_INSET_Y: 120,
  SPAWN_SPACING: 70,
};

export const PLAYER = {
  RADIUS: 30,
  BASE_HP: 100,
  MOVE_SPEED: 270, // units / second
  ACCEL: 3000,     // units / second^2 toward target velocity
  FRICTION: 2200,  // knockback decay, units / second^2
  FIST_RADIUS: 10,
};

export const COMBAT = {
  INPUT_BUFFER: 5,
  AIM_ASSIST_CONE: Math.PI / 3, // ~60 degrees total
  AIM_ASSIST_RANGE: 260,         // center to center
  HIT_ARC: (2 * Math.PI) / 3,    // a move hits targets within this arc around its direction
  ATTACK_WALK: 0.35,             // walking speed multiplier during a jab

  JAB: [
    // knockback in units/second; reach measured from the attacker's edge
    { startup: 3, active: 2, recovery: 6, damage: 5, reach: 60, knockback: 120, hitstun: 16, hitstop: 2 },
    { startup: 3, active: 2, recovery: 6, damage: 5, reach: 60, knockback: 120, hitstun: 16, hitstop: 2 },
    { startup: 4, active: 3, recovery: 12, damage: 9, reach: 66, knockback: 620, hitstun: 18, hitstop: 4 },
  ],
  JAB_CHAIN_WINDOW: 8, // ticks after recovery starts in which the next jab continues the string

  HEAVY: {
    MIN_CHARGE: 6,     // a tap still charges this long before firing
    MAX_CHARGE: 30,
    MAX_HOLD: 30,      // ticks a full charge can be held before it fires by itself
    CHARGE_WALK: 0.5,  // walking speed multiplier while charging
    LAUNCH_CHARGE: 0.5, // charge fraction from which a hit launches (and can wall bounce)
    startup: 5,
    active: 3,
    recovery: 16,
    damageMin: 10,
    damageMax: 22,
    reach: 76,
    knockbackMin: 500,
    knockbackMax: 1100,
    hitstun: 24,
    hitstop: 6,
    WALL_BOUNCE_MIN_SPEED: 450,
    WALL_BOUNCE_RESTITUTION: 0.55,
    WALL_BOUNCE_HITSTUN: 14, // extra hitstun on bounce
    WALL_BOUNCE_HITSTOP: 3,
  },

  DASH: {
    duration: 6,
    speed: 900,
    cooldown: 60,      // from the dash's start; landing a full jab string resets it
    // jab recovery (not heavy) can be cancelled into dash after this many recovery ticks
    cancelAfter: 2,
    MIN_STICK: 0.3,    // a weaker stick than this dashes where you face instead
  },

  PARRY: {
    active: 4,     // hits landing in these ticks are parried
    recovery: 14,  // a whiffed parry is stuck this long
    stun: 28,      // the parried attacker can't act this long
    hitstop: 5,    // both freeze on a parry
    grace: 2,
  },

  HITSTUN_DECAY: 0.8,      // each consecutive hit multiplies hitstun by this
  MIN_HITSTUN: 4,
  COMBO_BURST_TICKS: 45,   // continuous combo length before forced burst
  BURST_TICKS: 6,          // the burst itself: can't act, knockback stops
  BURST_INVULN: 20,        // from the burst's start; ends early if you attack
  BURST_PUSH: 700,         // knockback on everyone near the burst
  BURST_RADIUS: 150,       // center to center
};

export const RING = {
  START_TICK: 45 * TICK_RATE,
  CLOSE_TICK: 150 * TICK_RATE,
  START_RADIUS: 1000,
  END_RADIUS: 0,
  DAMAGE_PER_SECOND: 8,
  SUDDEN_DEATH_RADIUS: 200,
};

export const BALANCE = {
  DARK_HORSE_RATIO: 0.5,
  HP_PER_MISSING: 0.10,
  DMG_PER_MISSING: 0.05,
  HP_CAP: 0.40,
  DMG_CAP: 0.20,
};

export const RENDER = {
  // The camera follows your fighter and shows at least this much of the arena (world units).
  VIEW_WIDTH: 1100,
  VIEW_HEIGHT: 620,
  LABEL_FONT: 15,     // option name inside the circle, world units; shrinks to fit
  LABEL_FONT_MIN: 8,
  NAME_FONT: 13,      // nickname above the HP bar
  FIST_SPREAD: 0.6,   // radians either side of aim
};

// Touch controls, in CSS pixels.
export const TOUCH = {
  STICK_RADIUS: 60,   // joystick throw; full speed at the rim
  STICK_DEADZONE: 8,
  AIM_DEADZONE: 18,   // drag farther than this on Jab/Heavy to aim manually
};

// Input button bits (held state; the server derives presses from changes).
export const BUTTONS = {
  JAB: 1,
  HEAVY: 2,
  DASH: 4,
  PARRY: 8,
};
export const BUTTON_MASK = 15;

export const NET = {
  MAX_INPUTS_PER_SECOND: 60,
  INPUT_QUEUE_MAX: 2,
  INPUT_STARVE_TICKS: 4, // no input for this long: stop moving (stalled tab, lost connection)
  LAG_COMP_MAX_MS: 100,
  INTERP_MIN_MS: 100,
  INTERP_MAX_MS: 200,
  MAX_EXTRAPOLATE_SNAPSHOTS: 2,
  HEALTH_PING_MS: 5 * 60_000,
  HISTORY_TICKS: 8,
};
