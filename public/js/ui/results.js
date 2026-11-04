import { h } from './dom.js';

// The winner reveal: the option that won is the group's decision. Home leaves the room.
// update(room) reads room.result: { optionId } (null when nobody was left to win).
export function resultsScreen({ onHome }) {
  const title = h('h1.results-winner');
  const el = h('main.screen.results', {},
    h('p.muted', {}, 'The group has decided'),
    title,
    h('button.primary', { onclick: onHome }, 'Back to home'),
  );

  function update(room) {
    const winner = room.options.find((o) => o.id === room.result?.optionId);
    title.textContent = winner?.name ?? 'Nobody won';
    title.style.setProperty('--team', winner?.color ?? 'var(--muted)');
  }

  return { kind: 'results', el, update };
}
