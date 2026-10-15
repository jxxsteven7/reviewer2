import type { KeywordsReplay } from '@reviewer2/shared';
import { describe, expect, test, vi } from 'vitest';
import { shownReplay } from './replay';

// A replay kept before the groups were, as an account opens it (docs/architecture.md#replays).
const old: KeywordsReplay = {
  gameId: 'g1',
  language: 'en',
  startingTeam: 'red',
  cards: [
    { word: 'Model', color: 'red' },
    { word: 'Journal', color: 'blue' },
  ],
  history: [
    {
      turn: 1,
      team: 'red',
      word: 'Hint',
      count: 1,
      captain: 'ann',
      guesses: [{ card: 0, color: 'red', player: 'bob' }],
    },
    {
      turn: 2,
      team: 'blue',
      word: 'Paper',
      count: 1,
      captain: 'cat',
      guesses: [{ card: 1, color: 'blue', player: 'r1' }],
    },
  ],
  result: { winner: 'blue', reason: 'found' },
  agents: { r1: 'reviewer1' },
} as KeywordsReplay;

describe('a replay from before the groups were kept', () => {
  test('without a record of the game, has the PIs who gave the clues and the students who revealed the cards', () => {
    const shown = shownReplay({
      replay: old,
      log: () => null,
      accounts: new Map([['ann', { username: 'Ann', avatar: '/avatars/a.webp', handle: 'h1' }]]),
      viewer: new Set(['ann']),
    });
    expect(shown.groups).toEqual([
      { team: 'red', captain: 'ann', guessers: ['bob'] },
      { team: 'blue', captain: 'cat', guessers: ['r1'] },
    ]);
    // Bob, with no account there, is a guest, as Cat is.
    expect(shown.people).toEqual({
      ann: { name: 'Ann', avatar: '/avatars/a.webp', handle: 'h1' },
      bob: { guest: 1 },
      cat: { guest: 2 },
      r1: { agent: 'reviewer1' },
    });
    expect(shown.me).toBe('ann');
  });

  test('with a record, has the groups as the game ended: the seats as it began, then every seat taken or left', () => {
    const shown = shownReplay({
      replay: old,
      log: () => ({
        v: 2,
        game: 'keywords',
        gameId: 'g1',
        start: {
          ann: { team: 'red', role: 'captain' },
          eve: { team: null, role: 'spectator' },
          bob: { team: 'red', role: 'guesser' },
          cat: { team: 'blue', role: 'captain' },
          dan: { team: 'blue', role: 'guesser' },
          fay: { team: 'blue', role: 'guesser' },
        },
        entries: [
          { t: 5, by: 'gus', type: 'join', data: { play: true, seat: { team: 'red', role: 'guesser' } } },
          { t: 6, by: 'r1', type: 'join', data: { play: true, seat: { team: 'blue', role: 'guesser' } } },
          { t: 7, by: 'hal', type: 'join', data: { play: false, seat: { team: null, role: 'spectator' } } },
          // Cat leaves, and Dan takes the PI seat she held; Eve sits down in Dan's.
          { t: 8, by: 'cat', type: 'leave' },
          { t: 9, by: 'dan', type: 'keywords:seat', data: { team: 'blue', role: 'captain' } },
          { t: 10, by: 'eve', type: 'keywords:seat', data: { team: 'blue', role: 'guesser' } },
          // The chair moves Gus to the spectators and removes Fay.
          { t: 11, by: 'ann', type: 'bench', data: { player: 'gus' } },
          { t: 12, by: 'ann', type: 'remove', data: { player: 'fay' } },
        ],
      }),
      accounts: new Map(),
      viewer: new Set(),
    });
    expect(shown.groups).toEqual([
      { team: 'red', captain: 'ann', guessers: ['bob'] },
      { team: 'blue', captain: 'dan', guessers: ['r1', 'eve'] },
    ]);
    // Cat, who gave blue's first clue, is in the record still, after everyone in the groups.
    expect(Object.keys(shown.people)).toEqual(['ann', 'bob', 'dan', 'r1', 'eve', 'cat']);
    expect(shown.people.dan).toEqual({ guest: 3 });
    expect(shown.people.cat).toEqual({ guest: 5 });
    expect(shown.me).toBeNull();
  });

  test('with a record, shows the accounts it marks as deleted since as deleted, among guests numbered as before', () => {
    const log = {
      v: 2 as const,
      game: 'keywords',
      gameId: 'g1',
      start: {
        ann: { team: 'red', role: 'captain' },
        bob: { team: 'red', role: 'guesser' },
        cat: { team: 'blue', role: 'captain' },
        r1: { team: 'blue', role: 'guesser' },
      },
      entries: [],
    };
    const ann = { username: 'Ann', avatar: null, handle: 'h1' };
    const before = shownReplay({
      replay: old,
      log: () => log,
      accounts: new Map([
        ['ann', ann],
        ['bob', { username: 'Bob', avatar: null, handle: 'h2' }],
      ]),
      viewer: new Set(['ann']),
    });
    expect(before.people).toMatchObject({ bob: { name: 'Bob' }, cat: { guest: 1 } });
    // Bob deletes his account: the record marks his player ID, and Cat keeps her number.
    const after = shownReplay({
      replay: old,
      log: () => ({ ...log, deleted: ['bob'] }),
      accounts: new Map([['ann', ann]]),
      viewer: new Set(['ann']),
    });
    expect(after.people).toEqual({
      ann: { name: 'Ann', handle: 'h1' },
      bob: { deleted: true },
      cat: { guest: 1 },
      r1: { agent: 'reviewer1' },
    });
  });

  test('that keeps the groups reads no record', () => {
    const kept: KeywordsReplay = {
      ...old,
      agents: undefined,
      groups: [
        { team: 'red', captain: 'ann', guessers: ['bob'] },
        { team: 'blue', captain: 'cat', guessers: ['r1'] },
      ],
      members: { ann: { account: true }, bob: { guest: 3 }, cat: { guest: 1 }, r1: { agent: 'reviewer1' } },
    };
    const read = vi.fn(() => null);
    const shown = shownReplay({ replay: kept, log: read, accounts: new Map(), viewer: new Set() });
    expect(read).not.toHaveBeenCalled();
    expect(shown.people.r1).toEqual({ agent: 'reviewer1' });
  });
});

describe('a replay that keeps the groups', () => {
  test('shows its guests by the numbers kept, and nobody it does not know as a guest', () => {
    const kept: KeywordsReplay = {
      ...old,
      agents: undefined,
      groups: [
        { team: 'red', captain: 'ann', guessers: ['bob'] },
        { team: 'blue', captain: 'cat', guessers: ['r1'] },
      ],
      members: { ann: { account: true }, bob: { guest: 3 }, cat: { guest: 1 }, r1: { agent: 'reviewer1' } },
      history: [
        ...old.history,
        {
          turn: 3,
          team: 'red',
          word: 'Ink',
          count: 1,
          captain: 'ann',
          guesses: [{ card: 0, color: 'red', player: 'zed' }],
        },
      ],
    };
    const shown = shownReplay({ replay: kept, log: () => null, accounts: new Map(), viewer: new Set() });
    expect(shown.people).toEqual({
      ann: { deleted: true },
      bob: { guest: 3 },
      cat: { guest: 1 },
      r1: { agent: 'reviewer1' },
    });
  });
});
