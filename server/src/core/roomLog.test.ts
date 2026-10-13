import { describe, expect, test } from 'vitest';
import { fakeGame } from '../../test/fakeGame';
import { testWords } from '../../test/helpers';
import { seededRng } from './random';
import type { Member, Room } from './room';
import { Rooms } from './rooms';

// What a room notes in the log of the game it plays (docs/architecture.md#game-records).

function table() {
  const clock = { now: 0 };
  const rooms = new Rooms(testWords(), seededRng(3), () => clock.now);
  const created = rooms.create({
    game: fakeGame,
    language: 'en',
    fields: ['general'],
    key: 'key-ann',
    name: 'Ann',
    play: true,
    account: { id: 1, handle: 'a1b2c3d4e5f6', avatar: null, rank: 'undergraduate', agents: false },
  });
  if (!created.ok) throw new Error(created.error);
  const { room, member: ann } = created;
  room.attach(ann, 'socket-ann');
  const joined = room.join('key-bob', 'Bob', true);
  if (!joined.ok) throw new Error(joined.error);
  const bob = joined.member;
  room.attach(bob, 'socket-bob');
  return { room, ann, bob, clock };
}

const entries = (room: Room) => {
  room.act(room.chairId as string, 'test:finish', undefined);
  return (room.record()?.log?.entries ?? []).map(({ t, by, type, data }) => [t, by, type, data]);
};

describe('the log of a game', () => {
  test("notes where everyone began, the room's own events during the game, and nothing before it", () => {
    const { room, ann, bob, clock } = table();
    room.emote(bob.id, 'waiting');
    expect(room.start(0)).toMatchObject({ ok: true });
    // A quick reaction waits 10 seconds after the last.
    clock.now = 10_000;
    room.emote(bob.id, 'deadline');
    room.detach('socket-bob');
    clock.now = 11_000;
    room.attach(bob, 'socket-bob-2');
    room.act(ann.id, 'test:alarm', 500);
    clock.now = 12_000;
    room.expire();
    room.bench(bob.id);
    // Whoever comes during the game is noted with where the game has put them.
    const cat = room.join('key-cat', 'Cat', false);
    if (!cat.ok) throw new Error(cat.error);
    room.remove(cat.member.id);
    const dee = room.join('key-dee', 'Dee', true);
    if (!dee.ok) throw new Error(dee.error);
    room.handOver(bob.id);
    // The game started at 0 on the room's clock.
    expect(entries(room)).toEqual([
      [10_000, bob.id, 'emote', { emote: 'deadline' }],
      [10_000, bob.id, 'offline', undefined],
      [11_000, bob.id, 'online', undefined],
      [11_000, ann.id, 'test:alarm', undefined],
      [12_000, null, 'tick', undefined],
      [12_000, ann.id, 'bench', { player: bob.id }],
      [12_000, cat.member.id, 'join', { play: false, seat: 'watcher' }],
      [12_000, ann.id, 'remove', { player: cat.member.id }],
      [12_000, cat.member.id, 'leave', undefined],
      [12_000, dee.member.id, 'join', { play: true, seat: 'player' }],
      [12_000, ann.id, 'chair', { player: bob.id }],
      [12_000, bob.id, 'test:finish', undefined],
      [12_000, null, 'end', undefined],
    ]);
    // Where everyone was when the game began, as the game says.
    expect(room.record()?.log?.start).toEqual({ [ann.id]: 'player', [bob.id]: 'player' });
  });

  test('leaves out what the game calls minor once it has grown long, and keeps its own events', () => {
    // A game whose presses are minor.
    const game = { ...fakeGame, logged: (type: string) => ({ minor: type === 'test:press' }) };
    const rooms = new Rooms(testWords(), seededRng(3), () => 0);
    const created = rooms.create({
      game,
      language: 'en',
      fields: ['general'],
      key: 'key-kim',
      name: 'Kim',
      play: true,
    });
    if (!created.ok) throw new Error(created.error);
    const { room, member: kim } = created;
    room.attach(kim, 'socket-kim');
    const lee = room.join('key-lee', 'Lee', true);
    if (!lee.ok) throw new Error(lee.error);
    room.attach(lee.member, 'socket-lee');
    room.start(0);
    // More presses than the log keeps before it has grown long; then someone goes offline, which
    // is kept all the same.
    for (let i = 0; i < 1400; i += 1) room.act(kim.id, 'test:press', undefined);
    room.detach('socket-lee');
    room.act(kim.id, 'test:finish', undefined);
    const kept = room.record()?.log;
    expect(kept?.truncated).toBe(true);
    const types = kept?.entries.map(({ type }) => type) ?? [];
    expect(types.filter((type) => type === 'test:press').length).toBeLessThan(1400);
    expect(types.filter((type) => type === 'truncated')).toHaveLength(1);
    expect(types.slice(-3)).toEqual(['offline', 'test:finish', 'end']);
  });

  test('notes neither a message that was refused nor one that changed nothing', () => {
    const { room, ann } = table();
    room.start(0);
    expect(room.act(ann.id, 'test:refuse', undefined)).toMatchObject({ ok: false });
    expect(room.act(ann.id, 'test:nothing', undefined)).toEqual({ ok: true });
    room.act(ann.id, 'test:press', undefined);
    expect(entries(room).map(([, , type]) => type)).toEqual(['test:press', 'test:finish', 'end']);
  });

  test('says which account each player had, those who left included, and no guest', () => {
    const { room, ann, bob } = table();
    const fay = room.join('key-fay', 'Fay', true, {
      id: 3,
      handle: 'b2c3d4e5f6a1',
      avatar: null,
      rank: 'undergraduate',
      agents: false,
    });
    if (!fay.ok) throw new Error(fay.error);
    room.attach(fay.member as Member, 'socket-fay');
    room.start(0);
    room.drop(fay.member.id);
    room.act(ann.id, 'test:finish', undefined);
    expect(room.record()?.accounts).toEqual([
      { playerId: ann.id, accountId: 1 },
      { playerId: fay.member.id, accountId: 3 },
    ]);
    expect(room.record()?.accounts.some(({ playerId }) => playerId === bob.id)).toBe(false);
  });

  test('is for one game: none before its end, and a new one for the next game', () => {
    const { room, ann } = table();
    expect(room.record()).toBeNull();
    room.start(0);
    room.act(ann.id, 'test:press', undefined);
    expect(room.record()).toBeNull();
    room.act(ann.id, 'test:finish', undefined);
    const first = room.record()?.log;
    expect(room.again(room.gameId as string)).toEqual({ ok: true });
    expect(room.record()).toBeNull();
    room.start(1);
    room.act(ann.id, 'test:finish', undefined);
    const second = room.record()?.log;
    expect(second?.gameId).not.toBe(first?.gameId);
    expect(second?.entries.map(({ type }) => type)).toEqual(['test:finish', 'end']);
  });
});
