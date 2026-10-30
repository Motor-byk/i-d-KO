import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, cleanText } from '../server/rooms.js';
import { ROOM } from '../shared/constants.js';

test('createRoom makes host with a valid code', () => {
  const rm = new RoomManager();
  const { room, player } = rm.createRoom('  Ana  ');
  assert.match(room.code, /^[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(room.hostId, player.id);
  assert.equal(player.nickname, 'Ana');
  assert.equal(player.token.length, 32);
});

test('join is case-insensitive on code and enforces unique nicknames', () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom('Ana');
  assert.ok(rm.joinRoom(room.code.toLowerCase(), 'Ben').player);
  assert.equal(rm.joinRoom(room.code, 'ana').error, 'NICKNAME_TAKEN');
  assert.equal(rm.joinRoom('ZZZZ', 'Cy').error, 'ROOM_NOT_FOUND');
  assert.equal(rm.joinRoom(room.code, '   ').error, 'BAD_NICKNAME');
});

test('room caps at MAX_PLAYERS', () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom('p0');
  for (let i = 1; i < ROOM.MAX_PLAYERS; i++) assert.ok(rm.joinRoom(room.code, `p${i}`).player);
  assert.equal(rm.joinRoom(room.code, 'extra').error, 'ROOM_FULL');
});

test('locked room rejects joins but accepts rejoin tokens', () => {
  const rm = new RoomManager();
  const { room, player } = rm.createRoom('Ana');
  room.state = 'match';
  assert.equal(rm.joinRoom(room.code, 'Ben').error, 'ROOM_LOCKED');
  player.connected = false;
  const res = rm.rejoin(room.code, player.token);
  assert.equal(res.player, player);
  assert.equal(player.connected, true);
  assert.equal(rm.rejoin(room.code, 'nope').error, 'BAD_TOKEN');
});

test('last player leaving deletes the room', () => {
  const rm = new RoomManager();
  const { room, player } = rm.createRoom('Ana');
  rm.leave(room.code, player.id);
  assert.equal(rm.getRoom(room.code), undefined);
});

test('cleanText strips control chars and collapses whitespace', () => {
  assert.equal(cleanText('a\u0000b   c\n', 10), 'ab c');
  assert.equal(cleanText(42, 10), '');
  assert.equal(cleanText('abcdefghijkl', 5), 'abcde');
});
