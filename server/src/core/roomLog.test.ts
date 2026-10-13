import { describe, expect, test } from 'vitest';
import { fakeGame } from '../../test/fakeGame';
import { testWords } from '../../test/helpers';
import { seededRng } from './random';
import type { Member, Room } from './room';
import { Rooms } from './rooms';

// What a room notes in the log of the game it plays (docs/architecture.md#game-records).

function table(game: typeof fakeGame = fakeGame) {
  const clock = { now: 0 };
  const rooms = new Rooms(testWords(), seededRng(3), () => clock.now);
  const created = rooms.create({
    game,
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
  return (room.record()?.log?.entries ?? []).map(({ t, by, type, data, said }) =>
    said === undefined ? [t, by, type, data] : [t, by, type, data, said],
  );
};

describe('the log of a game', () => {
  test("notes where everyone began, the room's own events during the game, and nothing before it", () => {
    const { room, ann, bob, clock } = table();
    room.emote(bob.id);
    expect(room.start(0)).toMatchObject({ ok: true });
    // Quick reactions and who goes offline and comes back are not noted.
    clock.now = 10_000;
    room.emote(bob.id);
    room.detach('socket-bob');
    clock.now = 10_500;
    room.attach(bob, 'socket-bob-2');
    room.detach('socket-bob-2');
    room.act(ann.id, 'test:alarm', 500);
    room.act(bob.id, 'test:say', 'one moment');
    // An AI plays for Bob for a while.
    room.takeOver(bob.id, true);
    room.takeOver(bob.id, false);
    // The timer rings while the game waits for its players, and Bob is offline.
    clock.now = 12_000;
    room.expire();
    room.attach(bob, 'socket-bob-3');
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
      [10_500, ann.id, 'test:alarm', undefined],
      [10_500, bob.id, 'test:say', undefined, 'one moment'],
      [10_500, null, 'takeover', { player: bob.id, on: true }],
      [10_500, null, 'takeover', { player: bob.id, on: false }],
      [12_000, null, 'tick', { offline: [bob.id] }],
      [12_000, ann.id, 'bench', { player: bob.id }],
      [12_000, cat.member.id, 'join', { play: false, seat: 'watcher' }],
      [12_000, ann.id, 'remove', { player: cat.member.id }],
      [12_000, cat.member.id, 'leave', undefined],
      [12_000, dee.member.id, 'join', { play: true, seat: 'player' }],
      [12_000, ann.id, 'chair', { player: bob.id }],
      [12_000, bob.id, 'test:finish', undefined],
      [12_000, null, 'end', undefined],
    ]);
    // Where everyone was when the game began, as the game says, and how the game began.
    expect(room.record()?.log?.start).toEqual({ [ann.id]: 'player', [bob.id]: 'player' });
    expect(room.record()?.setup).toEqual({ words: expect.any(Array) });
  });

  test('names nobody on a timer when everyone it waited for was online', () => {
    const { room, ann, clock } = table();
    room.start(0);
    room.act(ann.id, 'test:alarm', 500);
    clock.now = 1_000;
    room.expire();
    expect(entries(room).find(([, , type]) => type === 'tick')).toEqual([1_000, null, 'tick', undefined]);
  });

  test('leaves out what is said once the chat has taken up its share, and keeps its own events', () => {
    const { room, ann, bob } = table();
    room.start(0);
    // More chat than the log keeps; then someone is moved to the spectators, which is kept all the
    // same.
    for (let i = 0; i < 600; i += 1) room.act(ann.id, 'test:say', 'x'.repeat(100));
    room.bench(bob.id);
    room.act(ann.id, 'test:finish', undefined);
    const kept = room.record()?.log;
    expect(kept?.truncated).toBe(true);
    const types = kept?.entries.map(({ type }) => type) ?? [];
    expect(types.filter((type) => type === 'test:say').length).toBeLessThan(600);
    expect(types.filter((type) => type === 'truncated')).toHaveLength(1);
    expect(types.slice(-3)).toEqual(['bench', 'test:finish', 'end']);
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

describe('the record of a game', () => {
  test('says how a game that finished ended, and what kind of game it was', () => {
    const { room, ann, clock } = table();
    room.start(0);
    clock.now = 90_000;
    room.act(ann.id, 'test:finish', undefined);
    expect(room.ending).toBe('finished');
    expect(room.record()).toMatchObject({
      ending: 'finished',
      outcome: { winner: 'all', reason: 'finish' },
      durationMs: 90_000,
      counts: { accounts: 1, guests: 1, agents: 0 },
      takeover: false,
      match: false,
      language: 'en',
      fields: ['general'],
      rules: 7,
      words: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
  });

  test('is kept of a game that the chair withdrew, which says so', () => {
    const { room } = table();
    room.start(0);
    expect(room.withdraw(room.gameId as string)).toEqual({ ok: true });
    const record = room.record();
    expect(record?.ending).toBe('withdrawn');
    expect(record?.outcome).toBeNull();
    expect(record?.log?.entries.at(-1)).toMatchObject({ by: null, type: 'end', data: { ending: 'withdrawn' } });
  });

  test('keeps what the game says of a change before it, when the chair withdraws the game too', () => {
    // A game that notes, with the end of the game, how many presses there had been.
    const noting: typeof fakeGame = {
      ...fakeGame,
      logChanges: (before, after) =>
        after.over && !before.over ? [{ type: 'test:last', data: { presses: after.presses } }] : [],
    };
    const finished = table(noting);
    finished.room.start(0);
    finished.room.act(finished.ann.id, 'test:press', 'hard');
    finished.clock.now = 5_000;
    finished.room.act(finished.ann.id, 'test:finish', undefined);
    // After the message that brought the change, and before the end.
    expect(finished.room.record()?.log?.entries.slice(-3)).toMatchObject([
      { t: 5_000, by: finished.ann.id, type: 'test:finish' },
      { t: 5_000, by: null, type: 'test:last', data: { presses: 1 } },
      { t: 5_000, by: null, type: 'end' },
    ]);
    const withdrawn = table(noting);
    withdrawn.room.start(0);
    withdrawn.room.act(withdrawn.ann.id, 'test:press', 'soft');
    withdrawn.room.act(withdrawn.ann.id, 'test:press', 'hard');
    withdrawn.clock.now = 7_000;
    expect(withdrawn.room.withdraw(withdrawn.room.gameId as string)).toEqual({ ok: true });
    expect(withdrawn.room.record()?.log?.entries.slice(-2)).toMatchObject([
      { t: 7_000, by: null, type: 'test:last', data: { presses: 2 } },
      { t: 7_000, by: null, type: 'end', data: { ending: 'withdrawn' } },
    ]);
  });

  test('is kept of a game cut short when its room closes, which says why', () => {
    const { room } = table();
    expect(room.cut('empty')).toBe(false);
    room.start(0);
    expect(room.record()).toBeNull();
    expect(room.cut('idle')).toBe(true);
    expect(room.cut('idle')).toBe(false);
    expect(room.record()?.ending).toBe('abandoned');
    expect(room.record()?.log?.entries.at(-1)).toMatchObject({
      type: 'end',
      data: { ending: 'abandoned', why: 'idle' },
    });
    // The record has no results: the game was never over.
    expect(room.results()).toBeNull();
  });

  test('is kept of a game that the server stopped', () => {
    const { room } = table();
    room.start(0);
    room.cut('restart');
    expect(room.record()?.ending).toBe('interrupted');
    expect(room.record()?.log?.entries.at(-1)).toMatchObject({ type: 'end', data: { ending: 'interrupted' } });
  });

  test('says when an AI played for someone who was offline', () => {
    const { room, ann, bob } = table();
    room.start(0);
    room.act(bob.id, 'test:press', 'for Bob', 'reviewer1');
    room.act(ann.id, 'test:finish', undefined);
    expect(room.record()?.takeover).toBe(true);
    expect(room.record()?.log?.entries[0]).toMatchObject({ by: bob.id, agent: 'reviewer1' });
  });
});
