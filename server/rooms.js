import { randomBytes, randomInt } from 'node:crypto';
import { ROOM, TEAM_COLORS } from '../shared/constants.js';

// Pure room/lobby state. No sockets here; server/socket.js wires events to these calls.
// Methods return { error } with a stable code on failure.

export function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export class RoomManager {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.rooms = new Map();
    this.nextPlayerId = 1;
  }

  createRoom(nickname) {
    const name = cleanText(nickname, ROOM.MAX_NICKNAME_LENGTH);
    if (!name) return { error: 'BAD_NICKNAME' };
    if (this.rooms.size >= ROOM.MAX_ROOMS) return { error: 'SERVER_FULL' };
    const room = {
      code: this.#newCode(),
      state: 'lobby',
      hostId: null,
      players: new Map(),
      options: [],
      nextOptionId: 1,
      joinCounter: 0,
    };
    this.rooms.set(room.code, room);
    const player = this.#addPlayer(room, name);
    room.hostId = player.id;
    return { room, player };
  }

  joinRoom(code, nickname) {
    const room = this.getRoom(code);
    if (!room) return { error: 'ROOM_NOT_FOUND' };
    if (room.state !== 'lobby') return { error: 'ROOM_LOCKED' };
    if (room.players.size >= ROOM.MAX_PLAYERS) return { error: 'ROOM_FULL' };
    const name = cleanText(nickname, ROOM.MAX_NICKNAME_LENGTH);
    if (!name) return { error: 'BAD_NICKNAME' };
    const taken = [...room.players.values()].some((p) => p.nickname.toLowerCase() === name.toLowerCase());
    if (taken) return { error: 'NICKNAME_TAKEN' };
    return { room, player: this.#addPlayer(room, name) };
  }

  // Rejoin bypasses the start lock: the token proves you were already in this room.
  rejoin(code, token) {
    const room = this.getRoom(code);
    if (!room) return { error: 'ROOM_NOT_FOUND' };
    const player = [...room.players.values()].find((p) => p.token === token);
    if (!player) return { error: 'BAD_TOKEN' };
    player.connected = true;
    player.graceUntil = null;
    return { room, player };
  }

  leave(code, playerId) {
    const room = this.getRoom(code);
    if (room) this.#removePlayer(room, playerId);
  }

  // Socket dropped: keep the seat for a grace period so the player can rejoin.
  disconnect(code, playerId) {
    const player = this.getRoom(code)?.players.get(playerId);
    if (!player) return;
    const room = this.getRoom(code);
    player.connected = false;
    player.graceUntil = this.now() + (room.state === 'lobby' ? ROOM.LOBBY_GRACE_MS : ROOM.MATCH_GRACE_MS);
  }

  // Removes players whose grace ran out. Returns rooms that changed and still exist.
  sweep() {
    const t = this.now();
    const changed = [];
    for (const room of [...this.rooms.values()]) {
      const expired = [...room.players.values()].filter((p) => p.graceUntil !== null && p.graceUntil <= t);
      if (!expired.length) continue;
      expired.forEach((p) => this.#removePlayer(room, p.id));
      if (this.rooms.has(room.code)) changed.push(room);
    }
    return changed;
  }

  #removePlayer(room, playerId) {
    room.players.delete(playerId);
    if (room.players.size === 0) {
      this.rooms.delete(room.code);
      return;
    }
    if (room.hostId === playerId) {
      // Earliest joiner wins; connected players beat ones currently in grace.
      const [next] = [...room.players.values()].sort(
        (a, b) => (b.connected - a.connected) || (a.joinOrder - b.joinOrder),
      );
      room.hostId = next.id;
    }
  }

  addOption(code, playerId, text) {
    const ctx = this.#lobbyContext(code, playerId);
    if (ctx.error) return ctx;
    const { room } = ctx;
    const name = cleanText(text, ROOM.MAX_OPTION_LENGTH);
    if (!name) return { error: 'BAD_OPTION' };
    if (room.options.length >= ROOM.MAX_OPTIONS) return { error: 'TOO_MANY_OPTIONS' };
    if (room.options.some((o) => o.name.toLowerCase() === name.toLowerCase())) return { error: 'DUPLICATE_OPTION' };
    const used = new Set(room.options.map((o) => o.color));
    const option = {
      id: room.nextOptionId++,
      name,
      color: TEAM_COLORS.find((c) => !used.has(c)),
    };
    room.options.push(option);
    return { room, option };
  }

  removeOption(code, playerId, optionId) {
    const ctx = this.#lobbyContext(code, playerId, { hostOnly: true });
    if (ctx.error) return ctx;
    const { room } = ctx;
    const idx = room.options.findIndex((o) => o.id === optionId);
    if (idx === -1) return { error: 'OPTION_NOT_FOUND' };
    room.options.splice(idx, 1);
    for (const p of room.players.values()) if (p.teamId === optionId) p.teamId = null;
    return { room };
  }

  // optionId null = unassigned (spectates the match).
  pickTeam(code, playerId, optionId) {
    const ctx = this.#lobbyContext(code, playerId);
    if (ctx.error) return ctx;
    if (optionId !== null && !ctx.room.options.some((o) => o.id === optionId)) return { error: 'OPTION_NOT_FOUND' };
    ctx.player.teamId = optionId;
    return { room: ctx.room };
  }

  // Locks the room, drops options nobody picked. Returns the populated teams.
  startMatch(code, playerId) {
    const ctx = this.#lobbyContext(code, playerId, { hostOnly: true });
    if (ctx.error) return ctx;
    const { room } = ctx;
    const picked = new Set([...room.players.values()].map((p) => p.teamId));
    const teams = room.options.filter((o) => picked.has(o.id));
    if (teams.length < ROOM.MIN_OPTIONS) return { error: 'NEED_TWO_TEAMS' };
    room.options = teams;
    room.state = 'match';
    return { room, teams };
  }

  getRoom(code) {
    return typeof code === 'string' ? this.rooms.get(code.toUpperCase()) : undefined;
  }

  #lobbyContext(code, playerId, { hostOnly = false } = {}) {
    const room = this.getRoom(code);
    if (!room) return { error: 'ROOM_NOT_FOUND' };
    const player = room.players.get(playerId);
    if (!player) return { error: 'NOT_IN_ROOM' };
    if (room.state !== 'lobby') return { error: 'ROOM_LOCKED' };
    if (hostOnly && room.hostId !== playerId) return { error: 'NOT_HOST' };
    return { room, player };
  }

  #addPlayer(room, nickname) {
    const player = {
      id: this.nextPlayerId++,
      token: randomBytes(16).toString('hex'),
      nickname,
      teamId: null,
      joinOrder: room.joinCounter++,
      connected: true,
      graceUntil: null,
    };
    room.players.set(player.id, player);
    return player;
  }

  #newCode() {
    const { CODE_ALPHABET: abc, CODE_LENGTH: len } = ROOM;
    let code;
    do {
      code = Array.from({ length: len }, () => abc[randomInt(abc.length)]).join('');
    } while (this.rooms.has(code));
    return code;
  }
}

export function publicRoom(room) {
  return {
    code: room.code,
    state: room.state,
    hostId: room.hostId,
    options: room.options,
    players: [...room.players.values()].map(({ id, nickname, teamId, connected }) => ({
      id, nickname, teamId, connected,
    })),
  };
}
