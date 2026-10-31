import { BUTTONS, TOUCH } from '../../shared/constants.js';
import { h } from '../ui/dom.js';

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
// sample() -> { move: {x, y} | null, buttons, aim: angle | null }; null = no touch input.
export function touchInput() {
  const knob = h('div.stick-knob');
  const stickEl = h('div.stick', { hidden: true }, knob);
  const buttonEls = CONTROLS.map((c) => h(`div.touch-btn.${c.name}`, { 'data-control': c.name }, c.label));
  const el = h('div.touch', {}, stickEl, h('div.touch-buttons', {}, buttonEls));

  const pointers = new Map(); // pointerId -> { move(e), up() }
  let stick = null;           // { x, y } normalized, while the joystick is held
  let held = 0;
  let tapped = 0;
  let dragAim = null;         // live aim while dragging an aim button
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
    if (!control.onRelease) { held |= control.bit; tapped |= control.bit; }
    return {
      move(ev) {
        if (!control.aim) return;
        const dx = ev.clientX - ox;
        const dy = ev.clientY - oy;
        if (Math.hypot(dx, dy) < TOUCH.AIM_DEADZONE) return;
        aimed = Math.atan2(dy, dx);
        dragAim = aimed;
      },
      up() {
        btnEl.classList.remove('down');
        if (control.aim) dragAim = null;
        if (control.onRelease) {
          tapped |= control.bit;
          releaseAim = aimed;
        } else {
          held &= ~control.bit;
        }
      },
    };
  }

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return; // desktop input handles the mouse
    e.preventDefault();
    const btnEl = e.target.closest('[data-control]');
    const control = btnEl && CONTROLS.find((c) => c.name === btnEl.dataset.control);
    let handler;
    if (control) handler = startButton(e, control, btnEl);
    else if (e.clientX < window.innerWidth / 2 && !stick) handler = startStick(e);
    else return;
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, handler);
  });
  el.addEventListener('pointermove', (e) => pointers.get(e.pointerId)?.move(e));
  const end = (e) => {
    pointers.get(e.pointerId)?.up();
    pointers.delete(e.pointerId);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  function sample() {
    const buttons = held | tapped;
    tapped = 0;
    // Facing follows the aim drag, else a just-released aim, else the joystick direction.
    let aim = dragAim ?? releaseAim;
    releaseAim = null;
    if (aim === null && stick && (stick.x || stick.y)) aim = Math.atan2(stick.y, stick.x);
    return { move: stick, buttons, aim };
  }

  return { el, sample };
}
