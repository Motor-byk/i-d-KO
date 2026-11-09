// Every tunable number lives here. Shared by server and client.
// Durations in the simulation are in ticks (1 tick = 1 / TICK_RATE seconds).

export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;
export const TICK_MS = 1000 / TICK_RATE;
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
  FIST_RADIUS: 10,         // drawn size
  FIST_HITBOX_RADIUS: 14,  // hit size: a bit bigger than drawn, so 30 Hz hits don't feel stingy
  FIST_SPREAD: 0.6,        // radians either side of aim at rest
};

export const COMBAT = {
  INPUT_BUFFER: 5,
  ATTACK_WALK: 0.35,             // walking speed multiplier during a jab

  JAB: [
    // knockback in units/second; reach: how far the fist travels from its rest spot;
    // wallRecoil: your own push off a wall the move's hitbox reaches into (see WALL_RECOIL_*)
    { startup: 3, active: 2, recovery: 6, damage: 5, reach: 60, knockback: 120, hitstun: 16, hitstop: 2, wallRecoil: 200 },
    { startup: 3, active: 2, recovery: 6, damage: 5, reach: 60, knockback: 120, hitstun: 16, hitstop: 2, wallRecoil: 200 },
    { startup: 4, active: 3, recovery: 8, damage: 10, reach: 50, knockback: 400, hitstun: 18, hitstop: 4, wallRecoil: 300 }, // the clap
  ],
  JAB_FINISHER_SWEEP: Math.PI / 2, // the clap's fists swing in from this far apart (radians, total) over its active ticks
  JAB_CHAIN_WINDOW: 8, // ticks after recovery starts in which the next jab continues the string
  // An un-aimed light: a 360 degree spin from idle. Its hitbox is a circle of radius RADIUS + reach around the body.
  // Two spins in a row link; hitstun decay leaves the target free ticks before a third (recovery and hitstun set this).
  SPIN: { startup: 4, active: 4, recovery: 7, damage: 3, reach: 22, knockback: 150, hitstun: 17, hitstop: 2, wallRecoil: 250 },

  // Any attack whose hitbox reaches into a wall or pillar on its first active tick pushes you back
  // off it at the move's wallRecoil speed, scaled by how deep the hitbox reaches (a flush punch gets all of it).
  WALL_RECOIL_GRAZE: 0.25,   // share of the push a hitbox that barely touches the wall gets
  WALL_RECOIL_AIM: 0.5,      // how much the push follows the fists (back along the aim) instead of the wall's normal; the spin has no aim
  WALL_RECOIL_FRICTION: 900, // knockback decay while recoiling (normal is PLAYER.FRICTION), so the slide lasts longer

  HEAVY: {
    MIN_CHARGE: 2,     // a tap still charges this long before firing
    MAX_CHARGE: 30,
    MAX_HOLD: 30,      // ticks a full charge can be held before it fires by itself
    CHARGE_WALK: 0.5,  // walking speed multiplier while charging
    LAUNCH_CHARGE: 0.5, // charge fraction from which a hit launches (and can wall bounce)
    ARMOR_FROM: 0.5,    // charge fraction from which hits can't stun the charger (they still damage and push)
    ARMOR_LIMIT: 20,    // damage the armor takes before it breaks (a full light string); the hit that breaks it stuns
    startup: 5,
    active: 3,
    // Reach and recovery grow with the charge, like damage and knockback: a tap is a quick poke, a full charge commits you.
    recoveryMin: 8,
    recoveryMax: 16,
    damageMin: 10,
    damageMax: 22,
    reachMin: 60,
    reachMax: 95,
    knockbackMin: 500,
    knockbackMax: 1100,
    hitstun: 24,
    hitstop: 6,
    WALL_BOUNCE_MIN_SPEED: 450,
    WALL_BOUNCE_RESTITUTION: 0.55,
    WALL_BOUNCE_HITSTUN: 14, // extra hitstun on bounce
    WALL_BOUNCE_HITSTOP: 3,
    // The heavy's wall recoil grows with the charge (see COMBAT.WALL_RECOIL_*).
    WALL_RECOIL_MIN: 300,
    WALL_RECOIL_MAX: 700,
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
  START_RADIUS: Math.ceil(Math.hypot(ARENA.WIDTH, ARENA.HEIGHT) / 2), // just covers the corners
  END_RADIUS: 0,
  DAMAGE_PER_SECOND: 8,
  SUDDEN_DEATH_RADIUS: 200,
  SUDDEN_DEATH_CLOSE_TICKS: 20 * TICK_RATE, // it keeps closing, so a stall can't last
  SUDDEN_DEATH_SPAWN_RADIUS: 130,           // clear of the center pillar, inside the ring
  SUDDEN_DEATH_HP: 1,
  MAX_SUDDEN_DEATHS: 5,                     // tied again after this many: a random tied team wins
};

export const MATCH = {
  END_DELAY_TICKS: 45, // from the deciding KO to the results, so everyone sees it land
};

export const BALANCE = {
  DARK_HORSE_RATIO: 0.5,
  HP_PER_MISSING: 0.10,
  DMG_PER_MISSING: 0.05,
  HP_CAP: 0.40,
  DMG_CAP: 0.20,
};

export const RENDER = {
  // Camera zoom: your fighter's on-screen width as a share of the window's shorter side. Bigger = more zoomed in.
  FIGHTER_SCREEN_SHARE: 0.1,
  EDGE_MARGIN: 90,  // spectator view: shown past the arena's edge, so the walls and a name beside them stay on screen
  LABEL_FONT: 15,     // option name inside the circle, world units; shrinks to fit
  LABEL_FONT_MIN: 8,
  NAME_FONT: 13,      // nickname above the HP bar
};

// Menu screens (home and lobby). Real-time ms: these run outside the sim.
export const UI = {
  TIP_INTERVAL_MS: 7000, // how long each rotating tip stays up
  TIP_FADE_MS: 300,      // fade out before the next tip; keep in sync with .tip in style.css
};

// Client-only effects. Fonts and distances in world units, durations in ticks.
export const JUICE = {
  DAMAGE_MIN: 1,         // HP lost between snapshots below this is the ring's burn, not a hit
  FLOAT_TICKS: 24,
  FLOAT_RISE: 1.5,       // per tick
  FLOAT_SPREAD: 14,      // random sideways offset, so a combo's numbers don't stack
  DAMAGE_FONT: 20,
  KO_FONT: 36,
  COMBO_FONT: 14,
  SHAKE_PER_DAMAGE: 0.8,
  SHAKE_OTHERS: 0.3,     // someone else's hit shakes this much of your own
  SHAKE_KO: 8,
  SHAKE_MAX: 14,
  SHAKE_DECAY: 0.8,      // share left after each tick
  SHAKE_MIN: 0.2,        // below this it stops
};

// Touch controls, in CSS pixels.
export const TOUCH = {
  STICK_RADIUS: 60,   // joystick throw; full speed at the rim
  STICK_DEADZONE: 8,
  AIM_DEADZONE: 18,   // push the aim stick farther than this to aim manually
  // Action buttons: each spot is its offset from the top-right corner of the safe area (negative = above it).
  // Parry and dash sit 72 left of light and heavy, half a button (32) higher.
  BUTTON_SPOTS: {
    parry: { right: 157, top: -9 },
    jab: { right: 85, top: 23 },
    dash: { right: 219, top: 53 },
    heavy: { right: 147, top: 85 },
  },
};

// Input button bits (held state; the server derives presses from changes).
export const BUTTONS = {
  JAB: 1,
  HEAVY: 2,
  DASH: 4,
  PARRY: 8,
  SPIN: 16, // the light button with no aim (touch), or Q
};
export const BUTTON_MASK = 31;

export const NET = {
  MAX_INPUTS_PER_SECOND: 60,
  INPUT_QUEUE_MAX: 2,
  INPUT_STARVE_TICKS: 4, // no input for this long: stop moving (stalled tab, lost connection)
  AWAY_TICKS: 30,        // no input for this long: show the fighter as lagging (the socket may not have closed yet)
  LAG_COMP_MAX_MS: 200,   // rewind cap: covers good and typical mobile connections; worse ones lead their targets
  MAX_STAMP_STEP: 2,      // an input's view tick may advance at most this much past the previous one
  INTERP_MIN_MS: 100,
  INTERP_MAX_MS: 200,
  INTERP_JITTER_SCALE: 3,   // interpolation delay = 2 ticks + this x jitter, clamped to the range above
  INTERP_ADAPT: 0.1,        // share of the gap to the target delay closed per snapshot
  INTERP_BUFFER_TICKS: 30,  // snapshots kept for interpolation
  MAX_EXTRAPOLATE_SNAPSHOTS: 2,
  CLOCK_SNAP_TICKS: 6,      // a server clock sample this far off the estimate is a jump...
  CLOCK_JUMP_CONFIRM: 3,    // ...taken once this many in a row agree (a lone one is ignored)
  CLOCK_SMOOTHING: 0.1,     // share of a clock sample's error taken per snapshot
  JITTER_SMOOTHING: 0.1,
  LEAD_SMOOTHING: 0.2,       // share of an input lead sample (server tick it was applied at - its stamp) taken per snapshot
  HEALTH_PING_MS: 5 * 60_000,
  SHUTDOWN_FLUSH_MS: 100, // on SIGTERM, time for the restart warning to leave before the process exits
  LINK_STALL_MS: 1000,           // no snapshots for this long: warn the player and stop predicting
  LINK_RECONNECT_MS: 3000,       // no snapshots for this long: force a reconnect instead of waiting for the ping timeout
  LINK_RECONNECT_MAX_MS: 12_000, // the wait doubles with each forced reconnect, up to this
  CONNECT_TIMEOUT_MS: 5000,      // one client connect attempt
  RECONNECT_DELAY_MAX_MS: 2000,  // longest wait between attempts
  MAX_PENDING_INPUTS: 30, // unacked inputs the client keeps for replay (1s)
  SNAP_DISTANCE: 100,     // prediction corrections bigger than this snap instead of easing
  CORRECTION_DECAY: 0.75, // share of an eased correction still showing after each tick
};
