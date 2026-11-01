import { PLAYER, TICK_RATE } from '../../shared/constants.js';
import { h } from './dom.js';
import { createRenderer } from '../render.js';
import { desktopInput } from '../input/desktop.js';
import { touchInput } from '../input/touch.js';
import { debugOverlay } from '../debug.js';
import { createPredictor } from '../net.js';

// Match screen: a full-screen canvas drawn every frame from the latest snapshot.
// Samples input at the tick rate and hands it to sendInput(input) while you're fighting;
// sendInput returns false when offline. Your own fighter is predicted (net.js).
// ping() resolves to an RTT in ms for the debug overlay.
// Returns { el, update(room), onSnapshot(snap), setError(), destroy() }.
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
  let options = new Map(); // id -> option, rebuilt when the room changes
  let players = new Map(); // id -> player
  const predictor = createPredictor();
  let aim = null; // last aim sent

  // Your fighter as last seen by the server, alive, or null (spectating or KO'd).
  const serverMe = () => snap?.fighters.find((f) => f.id === playerId && f.alive) ?? null;

  // Your predicted fighter for drawing and aiming: server data with predicted position and combat state.
  function myFighter() {
    const me = serverMe();
    const predicted = predictor.state;
    if (!me || !predicted) return me;
    return { ...me, ...predicted.body, ...predictor.drawn, aim: aim ?? me.aim, cs: predicted.cs };
  }

  function view() {
    const me = myFighter();
    return {
      meId: playerId,
      followId: playerId,
      fighters: snap.fighters.map((server) => {
        const f = server.id === playerId && me ? me : server;
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

  let frameId;
  const frame = () => {
    if (room && snap) renderer.draw(view());
    frameId = requestAnimationFrame(frame);
  };
  frameId = requestAnimationFrame(frame);

  const desktop = desktopInput(el, {
    aimAt: (clientX, clientY) => {
      const me = myFighter();
      const target = me && renderer.toWorld(clientX, clientY);
      return target ? Math.atan2(target.y - me.y, target.x - me.x) : null;
    },
  });

  let seq = 0;
  const inputTimer = setInterval(() => {
    const me = myFighter();
    if (!me) return; // spectating or KO'd
    const keys = desktop.sample();
    const fingers = touch.sample();
    aim = fingers.aim ?? keys.aim ?? aim ?? me.aim;
    const input = {
      seq: ++seq,
      tick: snap.tick,
      move: fingers.move ?? keys.move,
      aim,
      // The mouse always aims on purpose; touch only when dragging.
      aimed: fingers.aim !== null ? fingers.aimed : keys.aim !== null,
      buttons: keys.buttons | fingers.buttons,
    };
    // Offline inputs never arrive, so don't predict them; start over from the next snapshot.
    if (sendInput(input)) predictor.step(input);
    else predictor.reset();
  }, 1000 / TICK_RATE);

  return {
    kind: 'match',
    el,
    update: (next) => {
      room = next;
      options = new Map(room.options.map((o) => [o.id, o]));
      players = new Map(room.players.map((p) => [p.id, p]));
    },
    onSnapshot: (next) => {
      if (snap && next.tick <= snap.tick) return; // stale
      snap = next;
      debug.onSnapshot(next);
      const me = serverMe();
      if (!me) predictor.reset();
      else debug.setCorrection(predictor.reconcile(me, next.acks[playerId] ?? -1));
    },
    setError: () => {},
    destroy() {
      cancelAnimationFrame(frameId);
      clearInterval(inputTimer);
      desktop.destroy();
      debug.destroy();
      renderer.destroy();
    },
  };
}
