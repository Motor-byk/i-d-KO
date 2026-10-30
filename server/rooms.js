import { randomBytes, randomInt } from 'node:crypto';
import { ROOM } from '../shared/constants.js';

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
    if (!room) return;
    room.players.delete(playerId);
    if (room.players.size === 0) this.rooms.delete(room.code);
  }

  getRoom(code) {
    return typeof code === 'string' ? this.rooms.get(code.toUpperCase()) : undefined;
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
