import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createAppServer } from '../server/index.js';
import { Match } from '../server/game/match.js';

// Starts a server on a random port; returns a client factory and cleanup.
export async function startServer(t, options) {
  const app = createAppServer(options);
  await new Promise((r) => app.httpServer.listen(0, r));
  const url = `http://localhost:${app.httpServer.address().port}`;
  const clients = [];
  t.after(() => {
    clients.forEach((c) => c.disconnect());
    app.loop.stop();
    app.io.close();
  });
  const client = async (opts = {}) => {
    const c = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false, ...opts });
    clients.push(c);
    await new Promise((resolve, reject) => {
      c.once('connect', resolve);
      c.once('connect_error', reject);
    });
    return c;
  };
  return { ...app, url, client };
}

export const call = (socket, event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, resolve));

export const nextEvent = (socket, event) =>
  new Promise((resolve) => socket.once(event, resolve));

// Resolves with the first room:update that passes the check.
export async function roomUpdate(socket, check) {
  for (;;) {
    const room = await nextEvent(socket, 'room:update');
    if (check(room)) return room;
  }
}

// A well-formed match input, for match.input().
export const input = (seq, over = {}) => ({ seq, tick: 0, move: { x: 0, y: 0 }, aim: 0, buttons: 0, ...over });

// A Match with no sockets: sent is [event, payload] pairs, ended is onEnd's results.
export function fakeMatch(teamSizes = [1, 1], matchOptions = {}) {
  const players = new Map();
  let id = 1;
  const options = teamSizes.map((size, i) => {
    for (let k = 0; k < size; k++, id++) players.set(id, { id, teamId: i + 1 });
    return { id: i + 1 };
  });
  const sent = [];
  const ended = [];
  let empty = 0;
  const match = new Match({
    room: { players, options },
    emit: (event, payload) => sent.push([event, payload]),
    onEmpty: () => empty++,
    onEnd: (result) => ended.push(result),
    ...matchOptions,
  });
  return { match, players, sent, ended, emptyCalls: () => empty };
}

// Two players on two teams, match started. Returns the server, both sockets, and the room's details.
export async function startedMatch(t) {
  const server = await startServer(t);
  const a = await server.client();
  const b = await server.client();
  const { room, playerId, token } = await call(a, 'room:create', { nickname: 'Ana' });
  await call(b, 'room:join', { code: room.code, nickname: 'Ben' });
  await call(a, 'option:add', { name: 'Tacos' });
  const update = nextEvent(a, 'room:update');
  await call(a, 'option:add', { name: 'Sushi' });
  const { options } = await update;
  await call(a, 'team:pick', { optionId: options[0].id });
  await call(b, 'team:pick', { optionId: options[1].id });
  assert.deepEqual(await call(a, 'match:start'), { ok: true });
  return { ...server, a, b, code: room.code, playerId, token, options };
}
