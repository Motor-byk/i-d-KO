import { UI } from '../../shared/constants.js';
import { h } from './dom.js';

const TIPS = [
  'Complete a full light combo to recharge dash',
  'Use heavy attacks to bounce off walls',
  'Spin attacks are useful for stunning surrounding enemies',
  'Parry to stun the enemy opponent',
  'Cancel a heavy charge by dashing',
  'Heavy charges block stun after 50% charge',
  'Get more knockback with higher heavy charges',
  'Complete a full light combo to break a heavy charge',
  'Repeated fast combos on an enemy cause them to create a knockback shockwave',
];

// A different random tip than `last`.
function pick(last) {
  let i;
  do i = Math.floor(Math.random() * TIPS.length); while (TIPS.length > 1 && i === last);
  return i;
}

// A muted line that shows one random tip at a time, fading to a new one every UI.TIP_INTERVAL_MS.
// Returns { el, destroy() }; the owning screen calls destroy() when it goes away.
export function rotatingTip() {
  let index = pick(-1);
  const el = h('p.muted.tip', { 'aria-live': 'polite' }, `Tip: ${TIPS[index]}`);
  let fade;
  const timer = setInterval(() => {
    el.classList.add('fading');
    fade = setTimeout(() => {
      index = pick(index);
      el.textContent = `Tip: ${TIPS[index]}`;
      el.classList.remove('fading');
    }, UI.TIP_FADE_MS);
  }, UI.TIP_INTERVAL_MS);
  return {
    el,
    destroy() {
      clearInterval(timer);
      clearTimeout(fade);
    },
  };
}
