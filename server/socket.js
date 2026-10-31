import { ROOM, NET } from '../shared/constants.js';
import { publicRoom } from './rooms.js';
import { GameLoop } from './loop.js';
import { Match } from './game/match.js';

// Render sits behind Cloudflare, which overwrites CF-Connecting-IP with the real client address.
// The leftmost X-Forwarded-For entry is client-controlled, so it's only a local-dev fallback.
export function clientIp(handshake) {
  const { headers } = handshake;
  const trusted = headers['cf-connecting-ip'] || headers['true-client-ip'];
  if (typeof trusted === 'string' && trusted) return trusted.trim();
  const fwd = headers['x-forwarded-for'];
  return (typeof fwd === 'string' && fwd.split(',')[0].trim()) || handshake.address;
}

// Fixed-window counter per key. Expired windows are swept at most once per window.
export function createRateLimiter(limit, windowMs, now = Date.now) {
  const hits = new Map();
  let lastSweep = now();
  return (key) => {
    const t = now();
    if (t - lastSweep >= windowMs) {
      for (const [k, e] of hits) if (t - e.start >= windowMs) hits.delete(k);
      lastSweep = t;
    }
    const entry = hits.get(key);
    if (!entry || t - entry.start >= windowMs) {
      hits.set(key, { start: t, count: 1 });
      return true;
    }
    entry.count++;
    return entry.count <= limit;
  };
}

export function attachSocketHandlers(io, rooms) {
  const allowJoin = createRateLimiter(ROOM.JOIN_ATTEMPTS_PER_MINUTE, 60_000);
  // Rejoins get their own, larger budget: a whole friend group on one wifi may reconnect at once,
  // and a 128-bit token can't be brute-forced anyway.
  const allowRejoin = createRateLimiter(ROOM.REJOIN_ATTEMPTS_PER_MINUTE, 60_000);

  const broadcastRoom = (room) => io.to(room.code).emit('room:update', publicRoom(room));
  // One live socket per player; a rejoin from a new tab/socket replaces the old one.
  const socketByPlayer = new Map();

  const detach = (socket) => {
    const { code, playerId } = socket.data;
    if (!code) return null;
    socket.leave(code);
    socket.data.code = socket.data.playerId = undefined;
    if (socketByPlayer.get(playerId) === socket) socketByPlayer.delete(playerId);
    return { code, playerId };
  };

  const sweepTimer = setInterval(() => rooms.sweep().forEach(broadcastRoom), 1000);
  sweepTimer.unref();

  // A crashed match sends its room back to the lobby instead of taking the server down.
  const loop = new GameLoop({
    onError: (match, err) => {
      console.error(`match in room ${match.room.code} failed, ending it`, err);
      const res = rooms.endMatch(match.room.code);
      if (!res.error) broadcastRoom(res.room);
    },
  });

  const startMatch = (room) => {
    const target = io.to(room.code);
    const match = new Match({
      room,
      emit: (event, payload, { volatile = false } = {}) => (volatile ? target.volatile : target).emit(event, payload),
      onEmpty: () => loop.remove(match),
    });
    room.match = match;
    loop.add(match);
  };

  io.on('connection', (socket) => {
    const ip = clientIp(socket.handshake);
    const allowEvent = createRateLimiter(ROOM.EVENTS_PER_SECOND, 1000);
    const allowInput = createRateLimiter(NET.MAX_INPUTS_PER_SECOND, 1000);

    // Every handler takes (payload, ack). Bad payloads or missing acks never throw.
    const on = (event, handler) => {
      socket.on(event, (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        if (!allowEvent('all')) return reply({ error: 'RATE_LIMITED' });
        try {
          handler(payload && typeof payload === 'object' ? payload : {}, reply);
        } catch (err) {
          console.error(`handler ${event} failed`, err);
          reply({ error: 'SERVER_ERROR' });
        }
      });
    };

    const enter = (room, player, reply) => {
      const previous = socketByPlayer.get(player.id);
      if (previous && previous !== socket) {
        detach(previous);
        previous.emit('room:kicked', { reason: 'REJOINED_ELSEWHERE' });
        previous.disconnect(true);
      }
      socketByPlayer.set(player.id, socket);
      room.match?.resetInput(player.id);
      socket.data.code = room.code;
      socket.data.playerId = player.id;
      socket.join(room.code);
      reply({ playerId: player.id, token: player.token, room: publicRoom(room) });
      broadcastRoom(room);
    };

    // Seat-taking events: [rate limiter, room call].
    const seatEvents = {
      'room:create': [allowJoin, (p) => rooms.createRoom(p.nickname)],
      'room:join': [allowJoin, (p) => rooms.joinRoom(p.code, p.nickname)],
      'room:rejoin': [allowRejoin, (p) => rooms.rejoin(p.code, p.token)],
    };
    for (const [event, [allow, take]] of Object.entries(seatEvents)) {
      on(event, (payload, reply) => {
        if (socket.data.code) return reply({ error: 'ALREADY_IN_ROOM' });
        if (!allow(ip)) return reply({ error: 'RATE_LIMITED' });
        const res = take(payload);
        if (res.error) return reply(res);
        enter(res.room, res.player, reply);
      });
    }

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
    lobbyAction('match:start', (code, id) => {
      const res = rooms.startMatch(code, id);
      if (!res.error) startMatch(res.room);
      return res;
    });

    // Inputs are fire-and-forget at ~30/s: no ack, their own rate limit, invalid ones dropped.
    socket.on('match:input', (payload) => {
      if (!allowInput('all')) return;
      rooms.getRoom(socket.data.code)?.match?.input(socket.data.playerId, payload);
    });

    // Explicit leave frees the seat now; a dropped socket keeps it for the grace period.
    const exit = (release) => {
      const seat = detach(socket);
      if (!seat) return;
      release.call(rooms, seat.code, seat.playerId);
      const room = rooms.getRoom(seat.code);
      if (room) broadcastRoom(room);
    };

    on('room:leave', (_payload, reply) => {
      exit(rooms.leave);
      reply({ ok: true });
    });

    socket.on('disconnect', () => exit(rooms.disconnect));
  });

  return { loop };
}
