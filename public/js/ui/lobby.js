import { ROOM } from '../../shared/constants.js';
import { h } from './dom.js';

// actions: { addOption(name), removeOption(id), pickTeam(id|null), start(), leave() }
// Returns { el, update(room), setError(msg) }. The skeleton is built once so typing isn't lost on updates.
export function lobbyScreen({ playerId, actions }) {
  const codeEl = h('span.room-code');
  const shareBtn = h('button.small', { onclick: () => share(codeEl.textContent) }, 'Share link');
  const optionsEl = h('div.options');
  const spectatorsEl = h('p.spectators');
  const status = h('p.error');
  const startBtn = h('button.primary', { onclick: actions.start }, 'Start fight');
  const hostNote = h('p.muted');

  const input = h('input', { placeholder: 'Add an option (e.g. Tacos)', maxlength: ROOM.MAX_OPTION_LENGTH });
  const add = () => {
    if (!input.value.trim()) return;
    actions.addOption(input.value);
    input.value = '';
    input.focus();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

  const el = h('main.screen.lobby', {},
    h('header.lobby-head', {},
      h('div', {}, h('div.muted', {}, 'Room'), codeEl),
      shareBtn,
      h('button.small.ghost', { onclick: actions.leave }, 'Leave'),
    ),
    h('div.row', {}, input, h('button', { onclick: add }, 'Add')),
    optionsEl,
    spectatorsEl,
    startBtn,
    hostNote,
    status,
  );

  function update(room) {
    codeEl.textContent = room.code;
    const isHost = room.hostId === playerId;
    const me = room.players.find((p) => p.id === playerId);

    optionsEl.replaceChildren(...room.options.map((opt) => {
      const members = room.players.filter((p) => p.teamId === opt.id);
      const mine = me?.teamId === opt.id;
      return h(`div.option${mine ? '.mine' : ''}`, {
        style: { '--team': opt.color },
        onclick: () => actions.pickTeam(mine ? null : opt.id),
      },
        h('div.option-head', {},
          h('span.dot'),
          h('strong', {}, opt.name),
          h('span.count', {}, String(members.length)),
          isHost && h('button.small.ghost.remove', {
            onclick: (e) => { e.stopPropagation(); actions.removeOption(opt.id); },
            'aria-label': `Remove ${opt.name}`,
          }, '✕'),
        ),
        h('div.members', {}, members.map((p) => playerChip(p, room, playerId))),
      );
    }));
    if (!room.options.length) optionsEl.append(h('p.muted', {}, 'Add at least two options, then tap one to fight for it.'));

    const unassigned = room.players.filter((p) => p.teamId === null);
    spectatorsEl.replaceChildren(
      unassigned.length ? 'Not picked yet: ' : '',
      ...unassigned.map((p) => playerChip(p, room, playerId)),
    );

    startBtn.hidden = !isHost;
    const host = room.players.find((p) => p.id === room.hostId);
    hostNote.textContent = isHost ? 'Players who have not picked will spectate.' : `Waiting for ${host?.nickname ?? 'host'} to start…`;
  }

  return { kind: 'lobby', el, update, setError: (msg) => { status.textContent = msg; } };
}

function playerChip(p, room, playerId) {
  return h(`span.chip${p.connected ? '' : '.away'}`, {},
    p.id === room.hostId ? '👑 ' : '',
    p.nickname,
    p.id === playerId ? ' (you)' : '',
  );
}

async function share(code) {
  const url = `${location.origin}${location.pathname}?room=${code}`;
  try {
    if (navigator.share) await navigator.share({ title: 'i-d-KO', text: `Settle it in room ${code}`, url });
    else await navigator.clipboard.writeText(url);
  } catch { /* user cancelled */ }
}
