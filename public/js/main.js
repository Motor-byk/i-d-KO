import { connect, call, wakeServer, keepAwake, session } from './connection.js';
import { h, errorText, logo } from './ui/dom.js';
import { homeScreen } from './ui/home.js';
import { lobbyScreen } from './ui/lobby.js';
import { matchScreen } from './ui/match.js';
import { resultsScreen } from './ui/results.js';

const app = document.getElementById('app');
const banner = h('div.banner', { hidden: true });
document.body.append(banner);

let socket;
let me = null;       // { playerId, code }
let screen = null;   // current screen object
let restarting = false; // the server warned it's going down, until we reconnect
let rejoinRun = 0;      // only the newest tryRejoin() may act

// Rejoin errors that mean the seat is really gone; anything else (timeout, offline) is retried.
const SEAT_GONE = new Set(['BAD_TOKEN', 'ROOM_NOT_FOUND']);

function show(next) {
  screen?.destroy?.();
  screen = next;
  app.replaceChildren(next.el);
}

function setError(code) {
  screen?.setError?.(code ? errorText(code) : '');
}

function showHome(error = '') {
  me = null;
  const initialCode = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';
  show(homeScreen({ initialCode, error, onSubmit: enterRoom }));
}

async function enterRoom({ nickname, code }) {
  const res = code
    ? await call(socket, 'room:join', { code, nickname })
    : await call(socket, 'room:create', { nickname });
  if (res.error) return setError(res.error);
  onEntered(res);
}

// Updates ?room= without dropping other params (like ?debug).
function setRoomParam(code) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}

function onEntered({ playerId, token, room }) {
  me = { playerId, code: room.code };
  session.save(room.code, token);
  setRoomParam(room.code);
  onRoom(room);
}

const act = async (event, payload) => {
  const res = await call(socket, event, payload);
  setError(res.error);
};

async function leaveRoom() {
  // Forget the seat first so a reconnect mid-leave can't silently rejoin it.
  session.clear();
  rejoinRun++;
  setRoomParam(null);
  showHome();
  await call(socket, 'room:leave');
}

function showLobby() {
  show(lobbyScreen({
    playerId: me.playerId,
    actions: {
      addOption: (name) => act('option:add', { name }),
      removeOption: (optionId) => act('option:remove', { optionId }),
      pickTeam: (optionId) => act('team:pick', { optionId }),
      start: () => act('match:start'),
      leave: leaveRoom,
    },
  }));
}

function onRoom(room) {
  if (!me || room.code !== me.code) return;
  if (room.state === 'lobby') {
    if (screen?.kind !== 'lobby') showLobby();
    screen.update(room);
  } else if (room.state === 'results') {
    if (screen?.kind !== 'results') show(resultsScreen({ onHome: leaveRoom }));
    screen.update(room);
  } else {
    if (screen?.kind !== 'match') {
      show(matchScreen({
        playerId: me.playerId,
        onLeave: leaveRoom,
        // Never buffered while offline (no replay after a reconnect). Not volatile either:
        // socket.io drops a volatile emit while the previous write is in flight, which loses
        // the 2nd and 3rd input of a catch-up burst.
        sendInput: (input) => {
          if (!socket.connected) return false;
          socket.emit('match:input', input);
          return true;
        },
        ping: async () => {
          const start = performance.now();
          const res = await call(socket, 'net:ping');
          return res.error ? null : performance.now() - start;
        },
      }));
    }
    screen.update(room);
  }
}

// Returns 'seated'; 'retry' if a later attempt takes over (the next 'connect', or a newer run);
// 'none' if there's no saved seat; or the error that says the seat is gone.
async function tryRejoin() {
  const run = ++rejoinRun;
  for (;;) {
    const saved = session.load();
    if (!saved) return 'none';
    const res = await call(socket, 'room:rejoin', saved);
    if (run !== rejoinRun) return 'retry';
    if (!res.error) {
      onEntered(res);
      return 'seated';
    }
    if (SEAT_GONE.has(res.error)) {
      session.clear();
      return res.error;
    }
    if (!socket.connected) return 'retry';
    await new Promise((r) => setTimeout(r, 2000));
    if (run !== rejoinRun) return 'retry';
  }
}

function setBanner(text) {
  banner.textContent = text;
  banner.hidden = !text;
}

function showMovedTab() {
  me = null;
  setBanner('');
  show({
    kind: 'moved',
    el: h('main.screen.waking', {},
      h('h2', {}, 'You opened this room in another tab.'),
      h('button.primary', { onclick: () => location.reload() }, 'Use this tab instead'),
    ),
  });
}

async function boot() {
  const waking = h('p.muted');
  const retry = h('button', { hidden: true, onclick: () => location.reload() }, 'Try again');
  show({ el: h('main.screen.waking', {}, logo(), h('div.spinner'), waking, retry) });
  const awake = await wakeServer((n) => {
    waking.textContent = n === 1 ? 'Connecting…' : 'Waking the server up (free hosting naps). This can take up to a minute…';
  });
  if (!awake) {
    waking.textContent = "Can't reach the game server. Check your connection and try again.";
    retry.hidden = false;
    return;
  }
  keepAwake();

  socket = connect();
  socket.on('room:update', onRoom);
  socket.on('room:kicked', showMovedTab);
  socket.on('match:snapshot', (snap) => screen?.onSnapshot?.(snap));
  socket.on('server:restarting', () => {
    restarting = true;
    setBanner('The server is restarting, so any room in progress is lost. Reconnecting…');
  });
  socket.on('disconnect', (reason) => {
    // A server-initiated disconnect (kick) does not auto-reconnect, so don't promise it will.
    if (reason !== 'io server disconnect' && !restarting) setBanner('Connection lost. Reconnecting…');
  });
  socket.on('connect', async () => {
    setBanner('');
    restarting = false;
    const outcome = await tryRejoin();
    if (outcome === 'seated' || outcome === 'retry') return;
    if (me) {
      setRoomParam(null); // or Join stays filled in with a dead code
      showHome(outcome === 'ROOM_NOT_FOUND'
        ? 'Your room is gone. The server may have restarted.'
        : 'You were away too long and lost your seat.');
    } else if (screen?.kind !== 'home') showHome();
  });
}

boot();
