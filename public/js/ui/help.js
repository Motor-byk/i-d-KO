import { h } from './dom.js';

const DESKTOP = [
  ['Move', 'WASD or arrow keys'],
  ['Aim', 'Mouse'],
  ['Light', 'Left click or C. Tap up to 3 times for a jab, jab, clap string'],
  ['Spin', 'X. Hits everyone right around you'],
  ['Heavy', 'Hold right click or V to charge, let go to throw'],
  ['Dash', 'Space, in the direction you are moving'],
  ['Parry', 'Shift, just before a hit lands'],
];

const MOBILE = [
  ['Move', 'Touch and drag anywhere on the left half'],
  ['Aim', 'Touch and drag anywhere on the right half'],
  ['Light', 'Tap while aiming for a jab string, tap without aiming to spin'],
  ['Heavy', 'Hold to charge, let go to throw where you aim'],
  ['Dash', 'Tap, in the direction you are moving'],
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
      h('p', {}, 'Everyone gets one life, and the ring shrinks over time. The last team standing wins, and their option is the decision. A heavily outnumbered team is a dark horse 🐴 and gets a little extra HP and damage.'),
      h('p.muted', {}, 'Tips: dash to cancel a light attack, a charged heavy launches people into walls, and a parry stuns the attacker. Hits on teammates only push them.'),
    ),
    controls('Desktop', DESKTOP),
    controls('Mobile', MOBILE),
    h('p.muted', {}, 'On a phone, play in landscape.'),
  ));
  // The dialog has no padding, so only a click on the backdrop lands on the dialog itself.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  return h('span.help-wrap', {},
    h('button.help-btn', { onclick: () => dialog.showModal(), 'aria-label': 'Rules and controls', title: 'Rules and controls' }, '?'),
    dialog,
  );
}
