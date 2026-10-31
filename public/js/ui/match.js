import { PLAYER } from '../../shared/constants.js';
import { h } from './dom.js';
import { createRenderer } from '../render.js';

// Match screen: a full-screen canvas drawn every frame from the latest snapshot.
// Returns { el, update(room), onSnapshot(snap), setError() }.
export function matchScreen({ playerId, onLeave }) {
  const canvas = h('canvas.arena');
  const el = h('main.match', {},
    canvas,
    h('button.small.ghost.match-leave', { onclick: onLeave, 'aria-label': 'Leave match' }, '✕'),
  );
  const renderer = createRenderer(canvas);
  let room = null;
  let snap = null;

  function view() {
    const options = new Map(room.options.map((o) => [o.id, o]));
    const players = new Map(room.players.map((p) => [p.id, p]));
    return {
      meId: playerId,
      followId: playerId,
      fighters: snap.fighters.map((f) => {
        const player = players.get(f.id);
        const team = options.get(player?.teamId);
        return {
          ...f,
          maxHp: PLAYER.BASE_HP,
          color: team?.color ?? '#888888',
          label: team?.name ?? '?',
          nickname: player?.nickname ?? '',
        };
      }),
    };
  }

  const frame = () => {
    if (!el.isConnected) return; // screen was replaced
    if (room && snap) renderer.draw(view());
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    kind: 'match',
    el,
    update: (next) => { room = next; },
    onSnapshot: (next) => { snap = next; },
    setError: () => {},
  };
}
