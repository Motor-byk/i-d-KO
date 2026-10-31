import { BUTTONS, TOUCH } from '../../shared/constants.js';
import { h } from '../ui/dom.js';
import { buttonLatch } from './latch.js';

// Right-side buttons. aim: drag from the button to aim. onRelease: the press happens when the
// finger lifts (so a drag can aim first); otherwise the button is held while touched.
const CONTROLS = [
  { name: 'jab', label: 'Jab', bit: BUTTONS.JAB, aim: true, onRelease: true },
  { name: 'heavy', label: 'Heavy', bit: BUTTONS.HEAVY, aim: true },
  { name: 'dash', label: 'Dash', bit: BUTTONS.DASH },
  { name: 'parry', label: 'Parry', bit: BUTTONS.PARRY },
];

// Virtual joystick (appears wherever the left half is touched) + drag-to-aim buttons.
// Every touch is tracked by its pointerId, so moving, aiming and dashing can overlap.
// sample() -> { move: {x, y} | null, buttons, aim: angle | null, aimed }; null = no touch input.
// aimed: the aim came from a drag (manual) rather than the joystick (attacks get aim assist).
export function touchInput() {
  const knob = h('div.stick-knob');
  const stickEl = h('div.stick', { hidden: true }, knob);
  const buttonEls = CONTROLS.map((c) => h(`div.touch-btn.${c.name}`, { 'data-control': c.name }, c.label));
  const el = h('div.touch', {}, stickEl, h('div.touch-buttons', {}, buttonEls));

  const pointers = new Map(); // pointerId -> { move(e), up() }
  let stick = null;           // { x, y } normalized, while the joystick is held
  const buttons = buttonLatch();
  let dragAim = null;         // { pointerId, angle } of the aim button being dragged
  let releaseAim = null;      // aim of a drag that just ended (jab), applied with its press

  function startStick(e) {
    const ox = e.clientX;
    const oy = e.clientY;
    stickEl.hidden = false;
    stickEl.style.left = `${ox}px`;
    stickEl.style.top = `${oy}px`;
    knob.style.transform = '';
    stick = { x: 0, y: 0 };
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
        stick = d < TOUCH.STICK_DEADZONE ? { x: 0, y: 0 } : { x: dx / TOUCH.STICK_RADIUS, y: dy / TOUCH.STICK_RADIUS };
      },
      up() {
        stick = null;
        stickEl.hidden = true;
      },
    };
  }

  function startButton(e, control, btnEl) {
    const ox = e.clientX;
    const oy = e.clientY;
    let aimed = null;
    btnEl.classList.add('down');
    if (!control.onRelease) buttons.press(control.bit);
    return {
      move(ev) {
        if (!control.aim) return;
        const dx = ev.clientX - ox;
        const dy = ev.clientY - oy;
        if (Math.hypot(dx, dy) < TOUCH.AIM_DEADZONE) return;
        aimed = Math.atan2(dy, dx);
        dragAim = { pointerId: e.pointerId, angle: aimed };
      },
      up() {
        btnEl.classList.remove('down');
        // Only clear the aim if it's ours: Jab and Heavy can be dragged at the same time.
        if (dragAim?.pointerId === e.pointerId) dragAim = null;
        if (control.onRelease) {
          buttons.tap(control.bit);
          releaseAim = aimed;
        } else {
          buttons.release(control.bit);
        }
      },
    };
  }

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return; // desktop input handles the mouse
    e.preventDefault();
    const btnEl = e.target.closest('[data-control]');
    const control = btnEl && CONTROLS.find((c) => c.name === btnEl.dataset.control);
    const wantsStick = !control && e.clientX < window.innerWidth / 2 && !stick;
    // One finger per button, so a second finger lifting can't release the first one's hold.
    if (!wantsStick && !(control && !btnEl.classList.contains('down'))) return;
    // Capture before touching any state: if it throws, no up() would ever undo that state.
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      return;
    }
    pointers.set(e.pointerId, control ? startButton(e, control, btnEl) : startStick(e));
  });
  el.addEventListener('pointermove', (e) => pointers.get(e.pointerId)?.move(e));
  const end = (e) => {
    pointers.get(e.pointerId)?.up();
    pointers.delete(e.pointerId);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  function sample() {
    // Facing follows the aim drag, else a just-released aim, else the joystick direction.
    let aim = dragAim?.angle ?? releaseAim;
    releaseAim = null;
    const aimed = aim !== null;
    if (!aimed && stick && (stick.x || stick.y)) aim = Math.atan2(stick.y, stick.x);
    return { move: stick, buttons: buttons.take(), aim, aimed };
  }

  return { el, sample };
}
