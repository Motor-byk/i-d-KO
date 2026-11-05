import { TICK_MS } from '../../shared/constants.js';
import { h } from './dom.js';
import { createRenderer } from '../render.js';
import { desktopInput } from '../input/desktop.js';
import { touchInput } from '../input/touch.js';
import { debugOverlay } from '../debug.js';
import { createClock, createInterpolator, createLinkWatch, createPredictor, createTicker } from '../net.js';
import { createJuice } from '../juice.js';

// Match screen: a full-screen canvas drawn every frame. Other players are interpolated between
// snapshots, a little in the past; your own fighter is predicted (net.js).
// Samples input on a fixed tick and hands it to sendInput(input) while you're fighting;
// sendInput returns false when offline.
// ping() resolves to an RTT in ms for the debug overlay.
// onStall(stalled) reports snapshots stopping and resuming; onDeadLink() asks for a forced reconnect.
// Returns { el, update(room), onSnapshot(snap), onConnected(), setError(), destroy() }.
export function matchScreen({ playerId, onLeave, sendInput, ping, onStall, onDeadLink }) {
  const canvas = h('canvas.arena');
  const touch = touchInput();
  const debug = debugOverlay({ ping });
  const notice = h('div.match-notice', { hidden: true }, 'Sudden death: first hit wins!');
  const el = h('main.match', {},
    canvas,
    touch.el,
    notice,
    debug.el,
    h('button.small.ghost.match-leave', { onclick: onLeave, 'aria-label': 'Leave match' }, '✕'),
    h('div.rotate-hint', {}, 'Turn your phone sideways to fight'),
  );
  const renderer = createRenderer(canvas);
  let room = null;
  let snap = null;
  let options = new Map(); // id -> option, rebuilt when the room changes
  const players = new Map(); // id -> player, kept after they leave (see update)
  const predictor = createPredictor();
  const clock = createClock();
  const interp = createInterpolator();
  const ticker = createTicker(performance.now());
  const juice = createJuice();
  const link = createLinkWatch(performance.now());
  let stalled = false;
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
    const tick = renderTick(now);
    return {
      meId: playerId,
      followId: playerId,
      ring: snap.ring, // moves a fraction of a unit per snapshot: no need to interpolate
      floats: juice.floatsAt(tick),
      shake: juice.shakeAt(now),
      fighters: interp.sample(tick).map((other) => {
        const f = other.id === playerId && me ? me : other;
        const player = players.get(f.id);
        const team = options.get(player?.teamId);
        return {
          ...f,
          color: team?.color ?? '#888888',
          label: team?.name ?? '?',
          nickname: player?.nickname ?? '',
          connected: player?.connected ?? true,
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
    aimAt: (clientX, clientY) => (serverMe() ? renderer.aimAngle(clientX, clientY) : null),
  });

  let seq = 0;
  function sendTick(now) {
    // Sampled even when nothing gets sent, so a press made while you can't act doesn't fire later.
    const keys = desktop.sample();
    const fingers = touch.sample();
    // No walking around a frozen world, and no burst of stale inputs if the link comes back.
    if (stalled) {
      predictor.reset();
      return;
    }
    const me = myFighter(now);
    if (!me) return; // spectating or KO'd
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
    const state = link.check(now);
    if (state.stalled !== stalled) {
      stalled = state.stalled;
      onStall(stalled);
    }
    if (state.reconnect) onDeadLink();
    for (let due = ticker.advance(now); due > 0; due--) sendTick(now);
  }, TICK_MS / 4);

  return {
    kind: 'match',
    el,
    update: (next) => {
      room = next;
      options = new Map(room.options.map((o) => [o.id, o]));
      // The room drops a leaver at once, but the delayed view still draws their fighter until its KO.
      for (const p of room.players) players.set(p.id, p);
    },
    onSnapshot: (next) => {
      if (snap && next.tick <= snap.tick) return; // stale
      snap = next;
      const now = performance.now();
      link.heard(now);
      clock.onSnapshot(next.tick, now);
      interp.push(next, clock.jitterMs);
      debug.onSnapshot(next);
      debug.setInterp(interp.delayMs, clock.jitterMs);
      notice.hidden = !next.suddenDeath;
      juice.onSnapshot(next, playerId);
      const me = serverMe();
      if (!me) predictor.reset();
      else debug.setCorrection(predictor.reconcile(me, next.acks[playerId] ?? -1));
    },
    onConnected: () => link.connected(performance.now()),
    setError: () => {},
    destroy() {
      if (stalled) onStall(false);
      cancelAnimationFrame(frameId);
      clearInterval(inputTimer);
      desktop.destroy();
      touch.destroy();
      debug.destroy();
      renderer.destroy();
    },
  };
}
