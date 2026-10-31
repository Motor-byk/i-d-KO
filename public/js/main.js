import { connect, call, wakeServer, keepAwake, session } from './connection.js';
import { h, errorText, logo } from './ui/dom.js';
import { homeScreen } from './ui/home.js';
import { lobbyScreen } from './ui/lobby.js';
import { matchScreen } from './ui/match.js';

const app = document.getElementById('app');
const banner = h('div.banner', { hidden: true });
document.body.append(banner);

let socket;
let me = null;       // { playerId, code }
let screen = null;   // current screen object

// Rejoin errors that mean the seat is really gone; anything else (timeout, offline) is retried.
const SEAT_GONE = new Set(['BAD_TOKEN', 'ROOM_NOT_FOUND']);

function show(next) {
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

function onEntered({ playerId, token, room }) {
  me = { playerId, code: room.code };
  session.save(room.code, token);
  history.replaceState(null, '', `?room=${room.code}`);
  onRoom(room);
}

const act = async (event, payload) => {
  const res = await call(socket, event, payload);
  setError(res.error);
};

async function leaveRoom() {
  // Forget the seat first so a reconnect mid-leave can't silently rejoin it.
  session.clear();
  history.replaceState(null, '', location.pathname);
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
  } else {
    if (screen?.kind !== 'match') {
      show(matchScreen({
        playerId: me.playerId,
        onLeave: leaveRoom,
        // Volatile: dropped while offline instead of replayed late after a reconnect.
        sendInput: (input) => socket.volatile.emit('match:input', input),
      }));
    }
    screen.update(room);
  }
}

// Returns true once seated, false if there is no seat to go back to.
async function tryRejoin() {
  const saved = session.load();
  if (!saved) return false;
  for (;;) {
    const res = await call(socket, 'room:rejoin', saved);
    if (!res.error) {
      onEntered(res);
      return true;
    }
    if (SEAT_GONE.has(res.error)) {
      session.clear();
      return false;
    }
    if (!socket.connected) return false; // the next 'connect' will try again
    await new Promise((r) => setTimeout(r, 2000));
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
  socket.on('disconnect', (reason) => {
    // A server-initiated disconnect (kick) does not auto-reconnect, so don't promise it will.
    if (reason !== 'io server disconnect') setBanner('Connection lost. Reconnecting…');
  });
  socket.on('connect', async () => {
    setBanner('');
    const wasInRoom = me !== null;
    if (await tryRejoin()) return;
    if (wasInRoom) showHome('You were away too long and lost your seat.');
    else if (screen?.kind !== 'home') showHome();
  });
}

boot();
