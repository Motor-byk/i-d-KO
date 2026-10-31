import { PLAYER, TICK_RATE } from '../../shared/constants.js';
import { h } from './dom.js';
import { createRenderer } from '../render.js';
import { desktopInput } from '../input/desktop.js';
import { touchInput } from '../input/touch.js';
import { debugOverlay } from '../debug.js';

// Match screen: a full-screen canvas drawn every frame from the latest snapshot.
// Samples input at the tick rate and hands it to sendInput(input) while you're fighting.
// ping() resolves to an RTT in ms for the debug overlay.
// Returns { el, update(room), onSnapshot(snap), setError() }.
export function matchScreen({ playerId, onLeave, sendInput, ping }) {
  const canvas = h('canvas.arena');
  const touch = touchInput();
  const debug = debugOverlay({ ping });
  const el = h('main.match', {},
    canvas,
    touch.el,
    debug.el,
    h('button.small.ghost.match-leave', { onclick: onLeave, 'aria-label': 'Leave match' }, '✕'),
    h('div.rotate-hint', {}, 'Turn your phone sideways to fight'),
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

  const myFighter = () => snap?.fighters.find((f) => f.id === playerId && f.alive);
  const desktop = desktopInput(el, {
    aimAt: (clientX, clientY) => {
      const me = myFighter();
      const target = me && renderer.toWorld(clientX, clientY);
      return target ? Math.atan2(target.y - me.y, target.x - me.x) : null;
    },
  });

  let seq = 0;
  let aim = null;
  const inputTimer = setInterval(() => {
    if (!el.isConnected) {
      clearInterval(inputTimer);
      desktop.destroy();
      debug.destroy();
      return;
    }
    const me = myFighter();
    if (!me) return; // spectating or KO'd
    const keys = desktop.sample();
    const fingers = touch.sample();
    aim = fingers.aim ?? keys.aim ?? aim ?? me.aim;
    sendInput({
      seq: ++seq,
      tick: snap.tick,
      move: fingers.move ?? keys.move,
      aim,
      buttons: keys.buttons | fingers.buttons,
    });
  }, 1000 / TICK_RATE);

  return {
    kind: 'match',
    el,
    update: (next) => { room = next; },
    onSnapshot: (next) => {
      snap = next;
      debug.onSnapshot(next);
    },
    setError: () => {},
  };
}
