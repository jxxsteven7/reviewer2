import type { CardColor, ClueRecord, GameResult, Seat } from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import type { GameContext } from '../../core/game';
import { keywordsGame, type KeywordsData } from './index';
import type { KeywordsState } from './state';
import { gameState, LAYOUT, STANDARD } from './testing';

// What the game says of each player when it ends, for the records of players with accounts, with
// the titles that it brought them (docs/games/keywords.md#titles).

const seats: Record<string, Seat> = {
  ann: { team: 'red', role: 'captain' },
  bob: { team: 'red', role: 'guesser' },
  cat: { team: 'blue', role: 'captain' },
  dee: { team: 'blue', role: 'guesser' },
  eve: { team: null, role: 'spectator' },
};

// A game that has ended as `result` says, with `found` of the blue cards revealed.
function ended(result: GameResult | null, found = 0): KeywordsData {
  const game = gameState({ phase: 'over', result });
  const cards = game.cards.map((card, index) => ({ ...card, revealed: LAYOUT[index] === 'B' && index < 9 + found }));
  return {
    settings: STANDARD,
    seating: { seats: new Map(Object.entries(seats)), keyViewers: new Set(), sides: new Map() },
    game: { ...game, cards },
    vacated: { red: null, blue: null },
    match: null,
  };
}

// Ann came back to the room as `ann-2`, with the same member key.
const keyOf = (id: string) => (id === 'ann-2' ? 'key-ann' : `key-${id}`);
const results = (data: KeywordsData) => keywordsGame.results?.(data, { keyOf } as GameContext);

describe('the results of a game', () => {
  test('give everyone in a seat their group, their role, whether they won and their letter', () => {
    // Red found all its cards while blue had 3 of 8 left: a spotlight for red, a reject for blue.
    expect(results(ended({ winner: 'red', reason: 'found' }, 5))).toEqual([
      { playerId: 'ann', side: 'red', role: 'captain', winner: 'red', won: true, verdict: 'spotlight', titles: [] },
      { playerId: 'bob', side: 'red', role: 'guesser', winner: 'red', won: true, verdict: 'spotlight', titles: [] },
      { playerId: 'cat', side: 'blue', role: 'captain', winner: 'red', won: false, verdict: 'reject', titles: [] },
      { playerId: 'dee', side: 'blue', role: 'guesser', winner: 'red', won: false, verdict: 'reject', titles: [] },
    ]);
  });

  test('desk reject the group that revealed Reviewer 2', () => {
    const verdicts = results(ended({ winner: 'red', reason: 'reviewer2' }))?.map(({ verdict }) => verdict);
    expect(verdicts).toEqual(['oral', 'oral', 'deskReject', 'deskReject']);
  });

  test('are none for a game that was withdrawn, or that has not ended', () => {
    expect(results(ended({ winner: null, reason: 'withdrawn' }))).toBeNull();
    expect(results({ ...ended(null), game: gameState() })).toBeNull();
    expect(results({ ...ended(null), game: null })).toBeNull();
  });
});

describe('the titles of a game', () => {
  const guess = (card: number, color: CardColor) => ({ card, color, player: 'bob', at: 0 });
  const missed = (turn: number, team: 'red' | 'blue', captain?: string): ClueRecord => ({
    turn,
    team,
    at: 0,
    word: null,
    count: null,
    guesses: [],
    timedOut: true,
    ...(captain ? { captain } : {}),
  });
  const titles = (data: KeywordsData) =>
    Object.fromEntries((results(data) ?? []).map(({ playerId, titles }) => [playerId, titles]));
  const played = (history: ClueRecord[], result: GameResult): KeywordsData => {
    const data = ended(result);
    return { ...data, game: { ...(data.game as KeywordsState), history } };
  };

  test('give a PI Forgot to Submit for each turn their time ran out, under whichever ID they had', () => {
    const history = [
      missed(1, 'red', 'ann'),
      missed(2, 'blue', 'cat'),
      missed(3, 'red', 'ann-2'),
      // A turn whose captain's seat was empty blames nobody.
      missed(4, 'blue'),
      {
        turn: 5,
        team: 'red' as const,
        at: 0,
        word: 'Late',
        count: 1,
        guesses: [guess(24, 'reviewer2')],
        captain: 'ann',
      },
    ];
    // Red's first card, in the turn of its first clue, was Reviewer 2: an instant desk reject.
    expect(titles(played(history, { winner: 'blue', reason: 'reviewer2' }))).toEqual({
      ann: [
        { title: 'missed_deadline', turn: 1 },
        { title: 'missed_deadline', turn: 3 },
        { title: 'instant_reject', turn: 5 },
      ],
      bob: [{ title: 'instant_reject', turn: 5 }],
      cat: [{ title: 'missed_deadline', turn: 2 }],
      dee: [],
    });
  });

  test('give everyone in a group the instant desk reject for Reviewer 2 as its first card, whichever group guessed first', () => {
    const r2 = guess(24, 'reviewer2');
    // Blue found a card with its first clue; red's first card was Reviewer 2.
    const second = [
      { turn: 1, team: 'blue' as const, at: 0, word: 'One', count: 1, guesses: [guess(9, 'blue')], captain: 'cat' },
      { turn: 2, team: 'red' as const, at: 0, word: 'Two', count: 2, guesses: [r2], captain: 'ann' },
    ];
    expect(titles(played(second, { winner: 'blue', reason: 'reviewer2' }))).toEqual({
      ann: [{ title: 'instant_reject', turn: 2 }],
      bob: [{ title: 'instant_reject', turn: 2 }],
      cat: [],
      dee: [],
    });
    // Blue's first card was Reviewer 2, in the first turn of the game.
    const first = [{ turn: 1, team: 'blue' as const, at: 0, word: 'One', count: 1, guesses: [r2], captain: 'cat' }];
    expect(titles(played(first, { winner: 'red', reason: 'reviewer2' }))).toEqual({
      ann: [],
      bob: [],
      cat: [{ title: 'instant_reject', turn: 1 }],
      dee: [{ title: 'instant_reject', turn: 1 }],
    });
    // A game that the chair withdrew after it counts for no record, and so for no title.
    expect(results(played(first, { winner: null, reason: 'withdrawn' }))).toBeNull();
    // Red's students ran out of time in the turn of their first clue before they revealed a card:
    // their first card of the game came in the turn of their second clue, and was Reviewer 2, in
    // that turn, and no fall at the first hurdle beside it.
    const later = [
      {
        turn: 1,
        team: 'red' as const,
        at: 0,
        word: 'One',
        count: 1,
        guesses: [],
        timedOut: true as const,
        captain: 'ann',
      },
      { turn: 2, team: 'blue' as const, at: 0, word: 'One', count: 1, guesses: [guess(9, 'blue')], captain: 'cat' },
      { turn: 3, team: 'red' as const, at: 0, word: 'Two', count: 2, guesses: [r2], captain: 'ann' },
    ];
    expect(titles(played(later, { winner: 'blue', reason: 'reviewer2' }))).toEqual({
      ann: [{ title: 'instant_reject', turn: 3 }],
      bob: [{ title: 'instant_reject', turn: 3 }],
      cat: [],
      dee: [],
    });
  });

  test('give everyone in a group the fall at the first hurdle for Reviewer 2 later in the turn of its first clue, and never both', () => {
    const r2 = guess(24, 'reviewer2');
    // Red found a card, then revealed Reviewer 2, in the turn of its first clue: it fell at the
    // first hurdle, and had no instant desk reject.
    const first = [
      { turn: 1, team: 'red' as const, at: 0, word: 'Two', count: 2, guesses: [guess(0, 'red'), r2], captain: 'ann' },
    ];
    expect(titles(played(first, { winner: 'blue', reason: 'reviewer2' }))).toEqual({
      ann: [{ title: 'first_turn_reject', turn: 1 }],
      bob: [{ title: 'first_turn_reject', turn: 1 }],
      cat: [],
      dee: [],
    });
    // Reviewer 2 in the turn of a group's second clue brings neither title.
    const later = [
      { turn: 1, team: 'red' as const, at: 0, word: 'One', count: 1, guesses: [guess(0, 'red')], captain: 'ann' },
      { turn: 2, team: 'blue' as const, at: 0, word: 'One', count: 1, guesses: [guess(9, 'blue')], captain: 'cat' },
      { turn: 3, team: 'red' as const, at: 0, word: 'Two', count: 2, guesses: [guess(1, 'red'), r2], captain: 'ann' },
    ];
    expect(titles(played(later, { winner: 'blue', reason: 'reviewer2' }))).toEqual({
      ann: [],
      bob: [],
      cat: [],
      dee: [],
    });
  });

  test('give everyone in a group the opening record or the heavenly hand of its first clue, never both', () => {
    // Red's PI ran out of time first, so red's first clue is that of turn 3: 9 cards at once.
    const all = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((card) => guess(card, 'red'));
    const history = [
      missed(1, 'red', 'ann'),
      { turn: 2, team: 'blue' as const, at: 0, word: 'Two', count: 1, guesses: [guess(17, 'neutral')], captain: 'cat' },
      { turn: 3, team: 'red' as const, at: 0, word: 'All', count: 'unlimited' as const, guesses: all, captain: 'ann' },
    ];
    // "Unlimited" names no number: a heavenly hand without the opening record.
    expect(titles(played(history, { winner: 'red', reason: 'found' }))).toEqual({
      ann: [
        { title: 'missed_deadline', turn: 1 },
        { title: 'heavenly_hand', turn: 3 },
      ],
      bob: [{ title: 'heavenly_hand', turn: 3 }],
      cat: [],
      dee: [],
    });
    // A clue of 9 that finds all 9 would make the opening record too, but the heavenly hand outdoes
    // it.
    const numbered = history.map((record) => (record.turn === 3 ? { ...record, count: 9 } : record));
    expect(titles(played(numbered, { winner: 'red', reason: 'found' }))).toMatchObject({
      ann: [
        { title: 'missed_deadline', turn: 1 },
        { title: 'heavenly_hand', turn: 3 },
      ],
      bob: [{ title: 'heavenly_hand', turn: 3 }],
      cat: [],
      dee: [],
    });
    // A clue of 4 whose four cards come first, then a wrong one: the opening record, and the game
    // goes on.
    const opened = history.map((record) =>
      record.turn === 3 ? { ...record, count: 4, guesses: [...all.slice(0, 4), guess(17, 'neutral')] } : record,
    );
    expect(titles(played(opened, { winner: 'blue', reason: 'found' }))).toMatchObject({
      ann: [
        { title: 'missed_deadline', turn: 1 },
        { title: 'opening_record', turn: 3 },
      ],
      bob: [{ title: 'opening_record', turn: 3 }],
      cat: [],
      dee: [],
    });
    // A clue of 3 is too small for the opening record.
    const small = history.map((record) =>
      record.turn === 3 ? { ...record, count: 3, guesses: all.slice(0, 3) } : record,
    );
    expect(titles(played(small, { winner: 'blue', reason: 'found' })).bob).toEqual([]);
  });

  test('give a deadline hero Deadline Hero once for each turn that made them one, under whichever ID they had', () => {
    const late = { ...guess(0, 'red'), lastSeconds: true as const };
    const history: ClueRecord[] = [
      // Ann's last-second clue of 2 is followed to the letter, and Bob reveals both cards in the last
      // seconds.
      {
        turn: 1,
        team: 'red',
        at: 0,
        word: 'Late',
        count: 2,
        captain: 'ann',
        lastSeconds: true,
        guesses: [late, { ...late, card: 1 }],
      },
      {
        turn: 2,
        team: 'blue',
        at: 0,
        word: 'Two',
        count: 1,
        captain: 'cat',
        guesses: [{ ...guess(17, 'neutral'), player: 'dee' }],
      },
      // Ann, back as ann-2, gives another last-second clue, which finds nothing of red's; Bob
      // reveals a card of red's in time.
      {
        turn: 3,
        team: 'red',
        at: 0,
        word: 'Rush',
        count: 1,
        captain: 'ann-2',
        lastSeconds: true,
        guesses: [guess(17, 'neutral')],
      },
      { turn: 4, team: 'blue', at: 0, word: 'Calm', count: 1, captain: 'cat', guesses: [] },
      {
        turn: 5,
        team: 'red',
        at: 0,
        word: 'Fast',
        count: 1,
        captain: 'ann-2',
        lastSeconds: true,
        guesses: [guess(2, 'red')],
      },
    ];
    expect(titles(played(history, { winner: 'blue', reason: 'reviewer2' }))).toEqual({
      ann: [
        { title: 'deadline_hero', turn: 1 },
        { title: 'deadline_hero', turn: 5 },
      ],
      bob: [{ title: 'deadline_hero', turn: 1 }],
      cat: [],
      dee: [],
    });
  });

  test('are none for a game that was withdrawn', () => {
    const data = played([missed(1, 'red', 'ann')], { winner: null, reason: 'withdrawn' });
    expect(results(data)).toBeNull();
  });
});

describe('the titles in the view', () => {
  test('count what the game so far has brought each player whom its titles go to', () => {
    const history: ClueRecord[] = [
      { turn: 1, team: 'red', at: 0, word: null, count: null, guesses: [], timedOut: true, captain: 'ann' },
      { turn: 2, team: 'blue', at: 0, word: null, count: null, guesses: [], timedOut: true, captain: 'cat' },
      { turn: 3, team: 'red', at: 0, word: null, count: null, guesses: [], timedOut: true, captain: 'ann-2' },
    ];
    const data = { ...ended(null), game: { ...gameState({ turn: 4 }), history } };
    const ctx = {
      phase: 'playing',
      keyOf,
      now: () => 0,
      playerIds: () => Object.keys(seats),
      agentOf: () => null,
      // Cat plays as a guest, whom titles don't go to.
      awardsTitles: (id: string) => id !== 'cat',
    } as unknown as GameContext;
    const view = keywordsGame.views(data, ctx)({ playerId: 'eve' });
    expect(view.titles).toEqual({ ann: [{ title: 'missed_deadline', count: 2 }] });
    expect(keywordsGame.views({ ...data, game: null }, ctx)({ playerId: 'eve' }).titles).toEqual({});
    // A game that the chair withdrew awards none, so the view has none either.
    const withdrawn = {
      ...data,
      game: { ...data.game, phase: 'over' as const, result: { winner: null, reason: 'withdrawn' as const } },
    };
    expect(keywordsGame.views(withdrawn, ctx)({ playerId: 'eve' }).titles).toEqual({});
  });
});
