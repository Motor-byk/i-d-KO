import { BUTTONS, TOUCH } from '../../shared/constants.js';
import { h } from '../ui/dom.js';
import { buttonLatch } from './latch.js';

// Top-right buttons, in order along the arc. tap: pressed once when touched; otherwise held while touched.
const CONTROLS = [
  { name: 'dash', label: 'Dash', bit: BUTTONS.DASH },
  { name: 'heavy', label: 'Heavy', bit: BUTTONS.HEAVY },
  { name: 'jab', label: 'Light', bit: BUTTONS.JAB, tap: true },
  { name: 'parry', label: 'Parry', bit: BUTTONS.PARRY },
];

// Spot i along the arc, as CSS offsets from the arc's top-right anchor (where the 90° end sits).
function arcOffset(i) {
  const deg = TOUCH.ARC_FROM_DEG + ((TOUCH.ARC_TO_DEG - TOUCH.ARC_FROM_DEG) * i) / (CONTROLS.length - 1);
  const rad = (deg * Math.PI) / 180;
  return {
    right: `${-Math.cos(rad) * TOUCH.ARC_RADIUS}px`,
    top: `${(1 - Math.sin(rad)) * TOUCH.ARC_RADIUS}px`,
  };
}

// A joystick's knob and value. hold(ox, oy) grabs it around that center point.
// value() -> { x, y } normalized (zero inside the deadzone), or null when not held.
function stick(name, deadzone) {
  const knob = h('div.stick-knob');
  const el = h(`div.stick.${name}`, {}, knob);
  let value = null;
  return {
    el,
    value: () => value,
    hold(ox, oy) {
      value = { x: 0, y: 0 };
      return {
        move(ev) {
          let dx = ev.clientX - ox;
          let dy = ev.clientY - oy;
          const d = Math.hypot(dx, dy);
          if (d > TOUCH.STICK_RADIUS) {
            dx *= TOUCH.STICK_RADIUS / d;
            dy *= TOUCH.STICK_RADIUS / d;
          }
          knob.style.transform = `translate(${dx}px, ${dy}px)`;
          value = d < deadzone ? { x: 0, y: 0 } : { x: dx / TOUCH.STICK_RADIUS, y: dy / TOUCH.STICK_RADIUS };
        },
        up() {
          value = null;
          knob.style.transform = '';
        },
      };
    },
  };
}

// Appears wherever its half of the screen is touched, centered on the finger.
function floatingStick(name, deadzone) {
  const base = stick(name, deadzone);
  base.el.hidden = true;
  return {
    ...base,
    start(e) {
      base.el.hidden = false;
      base.el.style.left = `${e.clientX}px`;
      base.el.style.top = `${e.clientY}px`;
      const held = base.hold(e.clientX, e.clientY);
      return {
        move: held.move,
        up() {
          held.up();
          base.el.hidden = true;
        },
      };
    },
  };
}

// Always on screen, placed by CSS. The first touch counts at once, so a touch off center aims right away.
function fixedStick(name, deadzone) {
  const base = stick(name, deadzone);
  // Read at touch time, so a resize or rotation can't leave it stale.
  const center = () => {
    const rect = base.el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  return {
    ...base,
    catches(e) {
      const c = center();
      return Math.hypot(e.clientX - c.x, e.clientY - c.y) <= TOUCH.AIM_CATCH_RADIUS;
    },
    start(e) {
      const c = center();
      const held = base.hold(c.x, c.y);
      held.move(e);
      return held;
    },
  };
}

// Move stick anywhere on the left half, fixed aim stick lower right, action buttons top right.
// Every touch is tracked by its pointerId, so moving, aiming and pressing can overlap.
// sample() -> { move: {x, y} | null, buttons, aim: angle | null, aimed }; null = no touch input.
// aimed: the aim came from the aim stick (manual) rather than the move stick (attacks get aim assist).
export function touchInput() {
  const moveStick = floatingStick('move', TOUCH.STICK_DEADZONE);
  const aimStick = fixedStick('aim', TOUCH.AIM_DEADZONE);
  const buttonEls = CONTROLS.map((c, i) => h('div.touch-btn', { 'data-control': c.name, style: arcOffset(i) }, c.label));
  const el = h('div.touch', {}, moveStick.el, aimStick.el, h('div.touch-buttons', {}, buttonEls));

  const pointers = new Map(); // pointerId -> { move(e), up() }
  const buttons = buttonLatch();

  function startButton(control, btnEl) {
    btnEl.classList.add('down');
    if (control.tap) buttons.tap(control.bit);
    else buttons.press(control.bit);
    return {
      move() {},
      up() {
        btnEl.classList.remove('down');
        if (!control.tap) buttons.release(control.bit);
      },
    };
  }

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return; // desktop input handles the mouse
    e.preventDefault();
    const btnEl = e.target.closest('[data-control]');
    const control = btnEl && CONTROLS.find((c) => c.name === btnEl.dataset.control);
    let held = null;
    if (!control) {
      if (aimStick.catches(e)) held = aimStick;
      else if (e.clientX < window.innerWidth / 2) held = moveStick;
      else return; // the rest of the right side does nothing
    }
    // One finger per button and per stick, so a second finger lifting can't end the first one's hold.
    if (control ? btnEl.classList.contains('down') : held.value()) return;
    // Capture before touching any state: if it throws, no up() would ever undo that state.
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      return;
    }
    pointers.set(e.pointerId, control ? startButton(control, btnEl) : held.start(e));
  });
  el.addEventListener('pointermove', (e) => pointers.get(e.pointerId)?.move(e));
  const end = (e) => {
    pointers.get(e.pointerId)?.up();
    pointers.delete(e.pointerId);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  function sample() {
    // Facing follows the aim stick when it's pushed past its deadzone, else the move stick.
    const move = moveStick.value();
    const a = aimStick.value();
    const aimed = !!(a && (a.x || a.y));
    let aim = aimed ? Math.atan2(a.y, a.x) : null;
    if (!aimed && move && (move.x || move.y)) aim = Math.atan2(move.y, move.x);
    return { move, buttons: buttons.take(), aim, aimed };
  }

  return { el, sample };
}
