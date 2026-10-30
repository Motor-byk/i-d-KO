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

function lobby() {
  const rm = new RoomManager();
  const { room, player: host } = rm.createRoom('Host');
  const { player: guest } = rm.joinRoom(room.code, 'Guest');
  return { rm, room, host, guest };
}

test('anyone can add options; duplicates and overflow rejected', () => {
  const { rm, room, guest } = lobby();
  const { option } = rm.addOption(room.code, guest.id, ' Tacos ');
  assert.equal(option.name, 'Tacos');
  assert.ok(option.color);
  assert.equal(rm.addOption(room.code, guest.id, 'TACOS').error, 'DUPLICATE_OPTION');
  for (let i = 1; i < ROOM.MAX_OPTIONS; i++) rm.addOption(room.code, guest.id, `opt${i}`);
  assert.equal(rm.addOption(room.code, guest.id, 'one more').error, 'TOO_MANY_OPTIONS');
  assert.equal(new Set(room.options.map((o) => o.color)).size, ROOM.MAX_OPTIONS);
});

test('only host removes options; removal unassigns pickers', () => {
  const { rm, room, host, guest } = lobby();
  const { option } = rm.addOption(room.code, guest.id, 'Sushi');
  rm.pickTeam(room.code, guest.id, option.id);
  assert.equal(rm.removeOption(room.code, guest.id, option.id).error, 'NOT_HOST');
  assert.ok(rm.removeOption(room.code, host.id, option.id).room);
  assert.equal(guest.teamId, null);
});

test('pickTeam validates option and allows unassigning', () => {
  const { rm, room, guest } = lobby();
  const { option } = rm.addOption(room.code, guest.id, 'Pizza');
  assert.equal(rm.pickTeam(room.code, guest.id, 999).error, 'OPTION_NOT_FOUND');
  rm.pickTeam(room.code, guest.id, option.id);
  assert.equal(guest.teamId, option.id);
  rm.pickTeam(room.code, guest.id, null);
  assert.equal(guest.teamId, null);
});

test('startMatch needs two populated teams, drops empty options, locks room', () => {
  const { rm, room, host, guest } = lobby();
  const a = rm.addOption(room.code, host.id, 'A').option;
  const b = rm.addOption(room.code, host.id, 'B').option;
  rm.addOption(room.code, host.id, 'Nobody');
  rm.pickTeam(room.code, host.id, a.id);
  assert.equal(rm.startMatch(room.code, host.id).error, 'NEED_TWO_TEAMS');
  rm.pickTeam(room.code, guest.id, b.id);
  assert.equal(rm.startMatch(room.code, guest.id).error, 'NOT_HOST');
  const { teams } = rm.startMatch(room.code, host.id);
  assert.deepEqual(teams.map((t) => t.name), ['A', 'B']);
  assert.equal(room.state, 'match');
  assert.equal(rm.addOption(room.code, host.id, 'late').error, 'ROOM_LOCKED');
});
