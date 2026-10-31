import { BUTTONS } from '../../shared/constants.js';

// Physical key positions (event.code), so WASD works on any keyboard layout.
const MOVE_KEYS = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};
const BUTTON_KEYS = { Space: BUTTONS.DASH, ShiftLeft: BUTTONS.PARRY, ShiftRight: BUTTONS.PARRY };
const MOUSE_BUTTONS = { 0: BUTTONS.JAB, 2: BUTTONS.HEAVY };

// Keyboard + mouse. Mouse buttons are caught on target (the match screen, so clicks reach
// it through overlays). aimAt(clientX, clientY) turns the cursor into an aim angle (or null).
// sample() -> { move: {x, y}, buttons, aim: angle | null }.
export function desktopInput(target, { aimAt }) {
  const keys = new Set();
  let held = 0;
  let tapped = 0; // pressed since the last sample: a click shorter than one tick still counts
  let pointer = null;

  const press = (bit) => { held |= bit; tapped |= bit; };
  const release = (bit) => { held &= ~bit; };

  const listeners = [
    [window, 'keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (MOVE_KEYS[e.code] || BUTTON_KEYS[e.code]) e.preventDefault(); // no page scroll
      if (e.repeat) return;
      keys.add(e.code);
      if (BUTTON_KEYS[e.code]) press(BUTTON_KEYS[e.code]);
    }],
    [window, 'keyup', (e) => {
      keys.delete(e.code);
      if (BUTTON_KEYS[e.code]) release(BUTTON_KEYS[e.code]);
    }],
    // Alt-tab with a key down would otherwise leave it stuck.
    [window, 'blur', () => { keys.clear(); held = 0; }],
    [target, 'pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || !(e.button in MOUSE_BUTTONS)) return;
      if (e.target.closest('button')) return; // UI buttons, not attacks
      pointer = { x: e.clientX, y: e.clientY };
      press(MOUSE_BUTTONS[e.button]);
    }],
    [window, 'pointerup', (e) => {
      if (e.pointerType === 'mouse' && e.button in MOUSE_BUTTONS) release(MOUSE_BUTTONS[e.button]);
    }],
    [window, 'pointermove', (e) => {
      if (e.pointerType === 'mouse') pointer = { x: e.clientX, y: e.clientY };
    }],
    [target, 'contextmenu', (e) => e.preventDefault()],
  ];
  for (const [node, type, fn] of listeners) node.addEventListener(type, fn);

  function sample() {
    let x = 0;
    let y = 0;
    for (const code of keys) {
      const dir = MOVE_KEYS[code];
      if (dir) { x += dir[0]; y += dir[1]; }
    }
    const len = Math.hypot(x, y);
    const buttons = held | tapped;
    tapped = 0;
    return {
      move: len ? { x: x / len, y: y / len } : { x: 0, y: 0 },
      buttons,
      aim: pointer ? aimAt(pointer.x, pointer.y) : null,
    };
  }

  const destroy = () => {
    for (const [node, type, fn] of listeners) node.removeEventListener(type, fn);
  };

  return { sample, destroy };
}
