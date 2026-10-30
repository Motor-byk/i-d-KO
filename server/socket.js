import { ROOM } from '../shared/constants.js';
import { publicRoom } from './rooms.js';

function clientIp(socket) {
  const fwd = socket.handshake.headers['x-forwarded-for'];
  return (typeof fwd === 'string' && fwd.split(',')[0].trim()) || socket.handshake.address;
}

// Fixed-window counter per key; old windows are dropped lazily.
export function createRateLimiter(limit, windowMs, now = Date.now) {
  const hits = new Map();
  return (key) => {
    const t = now();
    const entry = hits.get(key);
    if (!entry || t - entry.start >= windowMs) {
      hits.set(key, { start: t, count: 1 });
      if (hits.size > 10_000) {
        for (const [k, e] of hits) if (t - e.start >= windowMs) hits.delete(k);
      }
      return true;
    }
    entry.count++;
    return entry.count <= limit;
  };
}

export function attachSocketHandlers(io, rooms) {
  const allowJoin = createRateLimiter(ROOM.JOIN_ATTEMPTS_PER_MINUTE, 60_000);

  const broadcastRoom = (room) => io.to(room.code).emit('room:update', publicRoom(room));

  io.on('connection', (socket) => {
    const ip = clientIp(socket);

    // Every handler takes (payload, ack). Bad payloads or missing acks never throw.
    const on = (event, handler) => {
      socket.on(event, (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          handler(payload && typeof payload === 'object' ? payload : {}, reply);
        } catch (err) {
          console.error(`handler ${event} failed`, err);
          reply({ error: 'SERVER_ERROR' });
        }
      });
    };

    const enter = (room, player, reply) => {
      socket.data.code = room.code;
      socket.data.playerId = player.id;
      socket.join(room.code);
      reply({ playerId: player.id, token: player.token, room: publicRoom(room) });
      broadcastRoom(room);
    };

    const guardJoin = (reply) => {
      if (socket.data.code) return reply({ error: 'ALREADY_IN_ROOM' }), false;
      if (!allowJoin(ip)) return reply({ error: 'RATE_LIMITED' }), false;
      return true;
    };

    on('room:create', ({ nickname }, reply) => {
      if (!guardJoin(reply)) return;
      const res = rooms.createRoom(nickname);
      if (res.error) return reply(res);
      enter(res.room, res.player, reply);
    });

    on('room:join', ({ code, nickname }, reply) => {
      if (!guardJoin(reply)) return;
      const res = rooms.joinRoom(code, nickname);
      if (res.error) return reply(res);
      enter(res.room, res.player, reply);
    });

    on('room:rejoin', ({ code, token }, reply) => {
      if (!guardJoin(reply)) return;
      const res = rooms.rejoin(code, token);
      if (res.error) return reply(res);
      enter(res.room, res.player, reply);
    });

    // Lobby actions: result.room present => broadcast, then ack.
    const lobbyAction = (event, fn) => on(event, (payload, reply) => {
      const res = fn(socket.data.code, socket.data.playerId, payload);
      if (res.error) return reply({ error: res.error });
      broadcastRoom(res.room);
      reply({ ok: true });
    });

    lobbyAction('option:add', (code, id, { name }) => rooms.addOption(code, id, name));
    lobbyAction('option:remove', (code, id, { optionId }) => rooms.removeOption(code, id, optionId));
    lobbyAction('team:pick', (code, id, { optionId = null }) => rooms.pickTeam(code, id, optionId));
    lobbyAction('match:start', (code, id) => rooms.startMatch(code, id));

    const leave = () => {
      const { code, playerId } = socket.data;
      if (!code) return;
      socket.leave(code);
      socket.data.code = socket.data.playerId = undefined;
      rooms.leave(code, playerId);
      const room = rooms.getRoom(code);
      if (room) broadcastRoom(room);
    };

    on('room:leave', (_payload, reply) => {
      leave();
      reply({ ok: true });
    });

    socket.on('disconnect', leave);
  });
}
