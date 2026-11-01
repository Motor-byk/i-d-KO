import { PLAYER, TICK_MS } from '../../shared/constants.js';
import { h } from './dom.js';
import { createRenderer } from '../render.js';
import { desktopInput } from '../input/desktop.js';
import { touchInput } from '../input/touch.js';
import { debugOverlay } from '../debug.js';
import { createClock, createInterpolator, createPredictor, createTicker } from '../net.js';

// Match screen: a full-screen canvas drawn every frame. Other players are interpolated between
// snapshots, a little in the past; your own fighter is predicted (net.js).
// Samples input on a fixed tick and hands it to sendInput(input) while you're fighting;
// sendInput returns false when offline.
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
  const clock = createClock();
  const interp = createInterpolator();
  const ticker = createTicker(performance.now());
  let aim = null; // last aim sent

  // The (fractional) server tick other players are shown at.
  const renderTick = (now) => clock.tickAt(now) - interp.delayMs / TICK_MS;

  // Your fighter as last seen by the server, alive, or null (spectating or KO'd).
  const serverMe = () => snap?.fighters.find((f) => f.id === playerId && f.alive) ?? null;

  // Your predicted fighter for drawing and aiming: server data with predicted position and combat state.
  function myFighter(now = performance.now()) {
    const me = serverMe();
    const predicted = predictor.state;
    if (!me || !predicted) return me;
    const at = predictor.drawnAt(ticker.alpha(now));
    return { ...me, ...predicted.body, ...at, aim: aim ?? me.aim, cs: predicted.cs };
  }

  function view(now) {
    const me = myFighter(now);
    return {
      meId: playerId,
      followId: playerId,
      fighters: interp.sample(renderTick(now)).map((other) => {
        const f = other.id === playerId && me ? me : other;
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
    if (room && snap) renderer.draw(view(performance.now()));
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
  function sendTick(now) {
    const me = myFighter(now);
    if (!me) return; // spectating or KO'd
    const keys = desktop.sample();
    const fingers = touch.sample();
    aim = fingers.aim ?? keys.aim ?? aim ?? me.aim;
    const input = {
      seq: ++seq,
      // What you're looking at, for lag compensation.
      tick: Math.max(0, Math.round(renderTick(now))),
      move: fingers.move ?? keys.move,
      aim,
      // The mouse always aims on purpose; touch only when dragging.
      aimed: fingers.aim !== null ? fingers.aimed : keys.aim !== null,
      buttons: keys.buttons | fingers.buttons,
    };
    // Offline inputs never arrive, so don't predict them; start over from the next snapshot.
    if (sendInput(input)) predictor.step(input);
    else predictor.reset();
  }
  // Polled faster than the tick so steps start close to on time; the ticker keeps the rate.
  const inputTimer = setInterval(() => {
    const now = performance.now();
    for (let due = ticker.advance(now); due > 0; due--) sendTick(now);
  }, TICK_MS / 4);

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
      const now = performance.now();
      clock.onSnapshot(next.tick, now);
      interp.push(next, clock.jitterMs);
      debug.onSnapshot(next);
      debug.setInterp(interp.delayMs, clock.jitterMs);
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
