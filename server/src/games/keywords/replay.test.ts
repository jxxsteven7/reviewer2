import type { KeywordsReplay } from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
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
  players: { bob: 'Bob', r1: 'reviewer1' },
  agents: { r1: 'reviewer1' },
} as KeywordsReplay;

describe('a replay from before the groups were kept', () => {
  test('without a record of the game, has the PIs who gave the clues and the students who revealed the cards', () => {
    const shown = shownReplay({
      replay: old,
      log: null,
      accounts: new Map([['ann', { username: 'Ann', avatar: '/avatars/a.webp', handle: 'h1' }]]),
      viewer: new Set(['ann']),
    });
    expect(shown.groups).toEqual([
      { team: 'red', captain: 'ann', guessers: ['bob'] },
      { team: 'blue', captain: 'cat', guessers: ['r1'] },
    ]);
    // The name it kept goes nowhere: Bob, with no account there, is a guest, as Cat is.
    expect(shown.people).toEqual({
      ann: { name: 'Ann', avatar: '/avatars/a.webp', handle: 'h1' },
      bob: { guest: 1 },
      cat: { guest: 2 },
      r1: { agent: 'reviewer1' },
    });
    expect(shown.me).toBe('ann');
    expect(JSON.stringify(shown)).not.toContain('Bob');
  });

  test('with a record, has the groups as the game began, and whoever came during it and revealed a card', () => {
    const shown = shownReplay({
      replay: old,
      log: {
        v: 2,
        game: 'keywords',
        gameId: 'g1',
        start: {
          ann: { team: 'red', role: 'captain' },
          eve: { team: null, role: 'spectator' },
          bob: { team: 'red', role: 'guesser' },
          cat: { team: 'blue', role: 'captain' },
          dan: { team: 'blue', role: 'guesser' },
        },
        entries: [
          { t: 5, by: 'gus', type: 'join', data: { play: true, seat: { team: 'red', role: 'guesser' } } },
          { t: 6, by: 'r1', type: 'join', data: { play: true, seat: { team: 'blue', role: 'guesser' } } },
        ],
      },
      accounts: new Map(),
      viewer: new Set(),
    });
    // Gus came and revealed nothing; Reviewer 1 came and revealed a card.
    expect(shown.groups).toEqual([
      { team: 'red', captain: 'ann', guessers: ['bob'] },
      { team: 'blue', captain: 'cat', guessers: ['dan', 'r1'] },
    ]);
    expect(Object.keys(shown.people)).toEqual(['ann', 'bob', 'cat', 'dan', 'r1']);
    expect(shown.people.dan).toEqual({ guest: 4 });
    expect(shown.me).toBeNull();
  });
});

describe('a replay that keeps the groups', () => {
  test('shows its guests by the numbers kept, and nobody it does not know as a guest', () => {
    const kept: KeywordsReplay = {
      ...old,
      players: undefined,
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
    const shown = shownReplay({ replay: kept, log: null, accounts: new Map(), viewer: new Set() });
    expect(shown.people).toEqual({
      ann: { deleted: true },
      bob: { guest: 3 },
      cat: { guest: 1 },
      r1: { agent: 'reviewer1' },
    });
  });
});
