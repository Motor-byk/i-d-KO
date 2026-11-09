import { h } from './dom.js';

const DESKTOP = [
  ['Move', 'WASD/arrow keys'],
  ['Aim', 'Mouse'],
  ['Light', 'Left click/C'],
  ['Spin', 'X'],
  ['Heavy', 'Right click/V, hold to charge'],
  ['Dash', 'Space in the direction you are moving'],
  ['Parry', 'Shift just before a hit lands'],
];

const MOBILE = [
  ['Move', 'Touch and drag anywhere on the left half'],
  ['Aim', 'Touch and drag anywhere on the right half'],
  ['Light', 'Tap while aiming for a jab string, tap without aiming to spin'],
  ['Heavy', 'Hold to charge'],
  ['Dash', 'Tap in the direction you are moving'],
  ['Parry', 'Tap just before a hit lands'],
];

const controls = (title, rows) => h('section', {},
  h('h3', {}, title),
  h('dl.help-controls', {}, rows.flatMap(([move, how]) => [h('dt', {}, move), h('dd', {}, how)])),
);

// A ? button that opens the rules and controls. The dialog lives inside the returned element,
// so it closes with the screen it was opened on.
export function helpButton() {
  const dialog = h('dialog.help', { 'aria-label': 'Rules and controls' }, h('div.help-body', {},
    h('div.help-head', {},
      h('h2', {}, 'How to play'),
      h('button.small.ghost', { onclick: () => dialog.close(), 'aria-label': 'Close' }, '✕'),
    ),
    h('section', {},
      h('p', {}, "Can't agree on dinner, a movie or a hot take? Fight about it. i‑d‑KO is a team arena brawler where every option is a team: add the options, pick the one you're fighting for, and brawl."),
      h('p', {}, 'Everyone gets one life, and the ring shrinks over time. The last team standing wins, and their option is the final decision.'),
    ),
    controls('Desktop', DESKTOP),
    controls('Mobile', MOBILE),
  ));
  // The dialog has no padding, so only a click on the backdrop lands on the dialog itself.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  return h('span.help-wrap', {},
    h('button.help-btn', { onclick: () => dialog.showModal(), 'aria-label': 'Rules and controls', title: 'Rules and controls' }, '?'),
    dialog,
  );
}
