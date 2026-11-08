import { BUTTONS, TOUCH } from '../../shared/constants.js';
import { h } from '../ui/dom.js';
import { buttonLatch } from './latch.js';

// Top-right buttons, placed by TOUCH.BUTTON_SPOTS. tap: pressed once when touched; otherwise held while touched.
const CONTROLS = [
  { name: 'dash', label: 'Dash', bit: BUTTONS.DASH },
  { name: 'heavy', label: 'Heavy', bit: BUTTONS.HEAVY },
  { name: 'jab', label: 'Light', bit: BUTTONS.JAB, tap: true },
  { name: 'parry', label: 'Parry', bit: BUTTONS.PARRY },
];

// A joystick that appears wherever its half of the screen is touched, centered on the finger.
// value() -> { x, y } normalized (zero inside the deadzone), or null when not held.
function floatingStick(name, deadzone) {
  const knob = h('div.stick-knob');
  const el = h(`div.stick.${name}`, { hidden: true }, knob);
  let value = null;
  return {
    el,
    value: () => value,
    start(e) {
      const ox = e.clientX;
      const oy = e.clientY;
      el.hidden = false;
      el.style.left = `${ox}px`;
      el.style.top = `${oy}px`;
      knob.style.transform = '';
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
          el.hidden = true;
        },
      };
    },
  };
}

// Move stick on the left half, aim stick on the right half, action buttons top right.
// Every touch is tracked by its pointerId, so moving, aiming and pressing can overlap.
// sample() -> { move: {x, y} | null, buttons, aim: angle | null }; null = no touch input.
export function touchInput() {
  const moveStick = floatingStick('move', TOUCH.STICK_DEADZONE);
  const aimStick = floatingStick('aim', TOUCH.AIM_DEADZONE);
  const buttonEls = CONTROLS.map((c) => {
    const { right, top } = TOUCH.BUTTON_SPOTS[c.name];
    return h('div.touch-btn', { 'data-control': c.name, style: { right: `${right}px`, top: `${top}px` } }, c.label);
  });
  const el = h('div.touch', {}, moveStick.el, aimStick.el, h('div.touch-buttons', {}, buttonEls));

  const pointers = new Map(); // pointerId -> { owner, move(e), up() }
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

  el.addEventListener('touchstart', (e) => {
    // Stops the browser's long-press gestures (text selection, callouts), which pointerdown's preventDefault doesn't.
    e.preventDefault();
    // Every finger on the controls is tracked, so more tracked than on screen means a lift never arrived.
    // Which one is unknown, so free them all: the next touch works, even on a stuck stick.
    if (pointers.size > e.touches.length) releaseAll();
  }, { passive: false });
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return; // desktop input handles the mouse
    e.preventDefault();
    const btnEl = e.target.closest('[data-control]');
    const control = btnEl && CONTROLS.find((c) => c.name === btnEl.dataset.control);
    const owner = control ?? (e.clientX < window.innerWidth / 2 ? moveStick : aimStick);
    // Capture before touching any state: if it throws, no up() would ever undo that state.
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      return;
    }
    const holder = [...pointers].find(([, pointer]) => pointer.owner === owner);
    if (holder && !control) {
      // A held stick stays put: a stray touch on its half only gets tracked, so the finger count stays right.
      pointers.set(e.pointerId, { owner: null, move() {}, up() {} });
      return;
    }
    // One finger per button, and the newest wins: if the browser never reports a finger's lift,
    // touching that button again frees it. The old finger's events stop counting.
    if (holder) {
      holder[1].up();
      pointers.delete(holder[0]);
    }
    pointers.set(e.pointerId, { owner, ...(control ? startButton(control, btnEl) : owner.start(e)) });
  });
  el.addEventListener('pointermove', (e) => pointers.get(e.pointerId)?.move(e));
  const end = (e) => {
    pointers.get(e.pointerId)?.up();
    pointers.delete(e.pointerId);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end); // no-op after an up: that pointer is already gone

  // Switching apps or tabs may never send a pointer's up or cancel, which would leave its control held.
  const releaseAll = () => {
    for (const pointer of pointers.values()) pointer.up();
    pointers.clear();
  };
  const onVisibility = () => {
    if (document.hidden) releaseAll();
  };
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', onVisibility);

  function sample() {
    // Facing follows the aim stick when it's pushed past its deadzone, else the move stick.
    const move = moveStick.value();
    const a = aimStick.value();
    const aimed = !!(a && (a.x || a.y));
    let aim = aimed ? Math.atan2(a.y, a.x) : null;
    if (!aimed && move && (move.x || move.y)) aim = Math.atan2(move.y, move.x);
    return { move, buttons: buttons.take(), aim };
  }

  const destroy = () => {
    window.removeEventListener('blur', releaseAll);
    document.removeEventListener('visibilitychange', onVisibility);
  };

  return { el, sample, destroy };
}
