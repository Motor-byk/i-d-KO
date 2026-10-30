import { connect, call, wakeServer, keepAwake, session } from './connection.js';
import { h, errorText } from './ui/dom.js';
import { homeScreen } from './ui/home.js';
import { lobbyScreen } from './ui/lobby.js';

const app = document.getElementById('app');
const banner = h('div.banner', { hidden: true });
document.body.append(banner);

let socket;
let me = null;       // { playerId, code }
let screen = null;   // current screen object

function show(next) {
  screen = next;
  app.replaceChildren(next.el);
}

function showError(code) {
  screen?.setError?.(errorText(code));
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
  if (res.error) return showError(res.error);
  onEntered(res);
}

function onEntered({ playerId, token, room }) {
  me = { playerId, code: room.code };
  session.save(room.code, token);
  history.replaceState(null, '', `?room=${room.code}`);
  showLobby(room);
}

const act = (event) => async (payload) => {
  const res = await call(socket, event, payload);
  showError(res.error ?? '');
  if (!res.error) screen?.setError?.('');
};

function showLobby(room) {
  const lobby = lobbyScreen({
    playerId: me.playerId,
    actions: {
      addOption: (name) => act('option:add')({ name }),
      removeOption: (optionId) => act('option:remove')({ optionId }),
      pickTeam: (optionId) => act('team:pick')({ optionId }),
      start: () => act('match:start')(),
      leave: async () => {
        await call(socket, 'room:leave');
        session.clear();
        history.replaceState(null, '', location.pathname);
        showHome();
      },
    },
  });
  show(lobby);
  onRoom(room);
}

function onRoom(room) {
  if (!me || room.code !== me.code) return;
  if (room.state === 'lobby') {
    if (screen?.update) screen.update(room);
    else showLobby(room);
  } else {
    // Match screen arrives with the match loop.
    show({ el: h('main.screen', {}, h('h2', {}, 'Fight!')) });
  }
}

async function tryRejoin() {
  const saved = session.load();
  if (!saved) return false;
  const res = await call(socket, 'room:rejoin', saved);
  if (res.error) {
    session.clear();
    return false;
  }
  onEntered(res);
  return true;
}

function setBanner(text) {
  banner.textContent = text;
  banner.hidden = !text;
}

async function boot() {
  const waking = h('p.muted');
  show({ el: h('main.screen.waking', {}, h('h1.logo', {}, 'i-d-', h('span', {}, 'KO')), h('div.spinner'), waking) });
  await wakeServer((n) => {
    waking.textContent = n === 1 ? 'Connecting…' : 'Waking the server up (free hosting naps). This can take up to a minute…';
  });
  keepAwake();

  socket = connect();
  socket.on('room:update', onRoom);
  socket.on('room:kicked', () => {
    session.clear();
    showHome('You joined from another tab.');
  });
  socket.on('disconnect', () => setBanner('Connection lost. Reconnecting…'));
  socket.on('connect', async () => {
    setBanner('');
    const wasInRoom = me !== null;
    if (!(await tryRejoin())) showHome(wasInRoom ? 'You were away too long and lost your seat.' : '');
  });
}

boot();
