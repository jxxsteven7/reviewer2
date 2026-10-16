import {
  bonusPoints,
  cardPoints,
  missedPoints,
  revealPoints,
  SPECTATOR,
  type CardColor,
  type ClueRecord,
  type KeywordsScoreDetail,
  type MatchRules,
  type RoomPhase,
  type Seat,
  type Team,
} from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import type { GameContext } from '../../core/game';
import { seededRng, type Rng } from '../../core/random';
import { keywordsGame, type KeywordsData } from './index';
import { arrangeFixed, drawGroups, lineupOf, newMatchSeating, rekeyMatch, scoreGame, type MatchSeating } from './match';
import { captainOf, seatOf, shuffleGroups, type Seating } from './seats';
import type { KeywordsState } from './state';
import { gameState } from './testing';

// The game's part of a match: how each player scores, and how the groups are made from one game to
// the next (docs/games/keywords.md#matches).

const keyOf = (id: string) => `key-${id}`;
const red: Seat = { team: 'red', role: 'guesser' };
const blue: Seat = { team: 'blue', role: 'guesser' };
const redPI: Seat = { team: 'red', role: 'captain' };
const bluePI: Seat = { team: 'blue', role: 'captain' };

function context(ids: string[], options: { offline?: string[]; phase?: RoomPhase; rng?: Rng } = {}): GameContext {
  const { offline = [], phase = 'lobby', rng = seededRng(1) } = options;
  return {
    phase,
    language: 'en',
    rng,
    chairId: null,
    now: () => 0,
    keyOf,
    isOnline: (id) => !offline.includes(id),
    agentOf: () => null,
    playerIds: () => ids,
    titleCount: () => null,
    awardsTitles: () => false,
  };
}

const sides = (teams: Record<string, Team>) => new Map(Object.entries(teams).map(([id, team]) => [keyOf(id), team]));

// The groups of a game: who played for which, and who was its PI, having seen the key.
const seated = (teams: Record<string, Team>, pis: string[]) => ({
  sides: sides(teams),
  keyViewers: new Set(pis.map(keyOf)),
});

type Guess = ClueRecord['guesses'][number];
const guess = (card: number, color: CardColor, player: string): Guess => ({ card, color, player, at: 0 });

// A game in which red's students revealed two of its cards and one of blue's, blue's one of its own
// and an irrelevant paper, and then red's revealed Reviewer 2, so blue won.
function played(): KeywordsState {
  return gameState({
    phase: 'over',
    result: { winner: 'blue', reason: 'reviewer2' },
    history: [
      {
        turn: 1,
        team: 'red',
        at: 0,
        word: 'One',
        count: 3,
        guesses: [guess(0, 'red', 'ron'), guess(1, 'red', 'ron'), guess(9, 'blue', 'ron')],
        captain: 'rex',
      },
      {
        turn: 2,
        team: 'blue',
        at: 0,
        word: 'Two',
        count: 2,
        guesses: [guess(10, 'blue', 'bea'), guess(17, 'neutral', 'bea')],
        captain: 'bo',
      },
      {
        turn: 3,
        team: 'red',
        at: 0,
        word: 'Three',
        count: 1,
        guesses: [guess(24, 'reviewer2', 'rae')],
        captain: 'rex',
      },
    ],
  });
}

const PLAYERS = { rex: 'red', ron: 'red', rae: 'red', bo: 'blue', bea: 'blue' } as const;
const PIS = ['rex', 'bo'];
const SEATED = seated(PLAYERS, PIS);

const pointsOf = (scores: ReturnType<typeof scoreGame>) =>
  Object.fromEntries((scores ?? []).map(({ key, points }) => [key.replace('key-', ''), points]));
const detailsOf = (scores: ReturnType<typeof scoreGame>) =>
  Object.fromEntries((scores ?? []).map(({ key, detail }) => [key.replace('key-', ''), detail]));

// A game that red won in the turn after those `before`, with `guesses` in it, and the clue `count`
// that rex, red's PI, gave for it.
function redWins(guesses: Guess[], count: ClueRecord['count'], before: ClueRecord[] = []): KeywordsState {
  const turn = before.length + 1;
  return gameState({
    phase: 'over',
    result: { winner: 'red', reason: 'found' },
    history: [...before, { turn, team: 'red', at: 0, word: 'Win', count, guesses, captain: 'rex' }],
  });
}
const ALL_RED = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((card) => guess(card, 'red', 'ron'));

describe('the score of a game', () => {
  test('gives everyone in a group a point for each of its cards its students found, and the PI more for the win', () => {
    // Red found 2 cards, blue 1: the blue card that red revealed doesn't count for blue. Red's
    // students revealed a blue card and Reviewer 2, which costs each of them 2 and 3, whoever revealed
    // them, and the PI 3 and 5; blue's revealed an irrelevant paper, 1 for each student and 2 for the
    // PI. Blue won: 3 for a student, 4 for the PI.
    expect(pointsOf(scoreGame(played(), SEATED, keyOf))).toEqual({
      rex: 2 - 3 - 5,
      ron: 2 - 2 - 3,
      rae: 2 - 2 - 3,
      bo: 1 + 4 - 2,
      bea: 1 + 3 - 1,
    });
  });

  test('says where the points came from', () => {
    const details = detailsOf(scoreGame(played(), SEATED, keyOf));
    const none = { bigClues: 0, openingRecord: false, heavenlyHand: false, missed: 0 };
    const red = { found: 2, won: false, irrelevant: 0, wrong: 1, reviewer2: 1, ...none };
    const blue = { found: 1, won: true, irrelevant: 1, wrong: 0, reviewer2: 0, ...none };
    expect(details).toEqual({
      rex: { role: 'captain', ...red },
      ron: { role: 'guesser', ...red },
      rae: { role: 'guesser', ...red },
      bo: { role: 'captain', ...blue },
      bea: { role: 'guesser', ...blue },
    });
  });

  // The client shows each revealed card's points as it is revealed (revealPoints()), and what the end
  // of the game adds (bonusPoints()), which must come to what the server scores.
  test('adds up to what each card and the end bring, as the client shows them', () => {
    const games = [
      played(),
      redWins(ALL_RED, 9),
      redWins([guess(0, 'red', 'ron'), guess(17, 'neutral', 'ron')], 2, [
        { turn: 1, team: 'red', at: 0, word: 'Big', count: 4, guesses: ALL_RED.slice(1, 5), captain: 'rex' },
        {
          turn: 2,
          team: 'blue',
          at: 0,
          word: 'Miss',
          count: 1,
          guesses: [guess(9, 'blue', 'bea'), guess(5, 'red', 'bea')],
        },
      ]),
      redWins(ALL_RED.slice(1), 'unlimited', [
        { turn: 1, team: 'red', at: 0, word: null, count: null, guesses: [], timedOut: true, captain: 'rex' },
        { turn: 2, team: 'blue', at: 0, word: null, count: null, guesses: [], timedOut: true, captain: 'bo' },
        { turn: 3, team: 'red', at: 0, word: 'One', count: 1, guesses: [guess(0, 'red', 'ron')], captain: 'rex' },
        { turn: 4, team: 'blue', at: 0, word: null, count: null, guesses: [], timedOut: true, captain: 'bo' },
      ]),
    ];
    for (const game of games) {
      for (const { key, points, detail } of scoreGame(game, SEATED, keyOf) ?? []) {
        const id = key.replace('key-', '') as keyof typeof PLAYERS;
        const role = PIS.includes(id) ? 'captain' : 'guesser';
        const cards = game.history.reduce(
          (sum, record) =>
            sum +
            record.guesses.reduce((add, { color }) => add + revealPoints(color, record.team, PLAYERS[id], role), 0),
          0,
        );
        const scored = detail as KeywordsScoreDetail;
        expect(cards, id).toBe(cardPoints(scored));
        expect(cards + bonusPoints(scored) + missedPoints(scored), id).toBe(points);
      }
    }
  });

  test('costs every student of a larger group the same', () => {
    const many = seated({ ...PLAYERS, rio: 'red', ria: 'red' }, PIS);
    const points = pointsOf(scoreGame(played(), many, keyOf));
    expect([points.ron, points.rae, points.rio, points.ria]).toEqual([-3, -3, -3, -3]);
    expect(points.rex).toBe(-6);
  });

  test('gives the PI who gave a big clue a point for each card it found from the fourth on', () => {
    const own = (cards: number[]) => cards.map((card) => guess(card, 'red', 'ron'));
    const clue = (turn: number, cards: number[], captain = 'rex'): ClueRecord => ({
      turn,
      team: 'red',
      at: 0,
      word: `Clue${turn}`,
      count: 1,
      guesses: [...own(cards), guess(17 + turn, 'neutral', 'ron')],
      captain,
    });
    const blue = (turn: number): ClueRecord => ({ turn, team: 'blue', at: 0, word: 'Blue', count: 1, guesses: [] });
    // Three cards, then four, then five; the last clue came from another PI who took the seat over.
    const game = gameState({
      history: [clue(1, [0, 1, 2]), blue(2), clue(3, [3, 4, 5, 6]), blue(4), clue(5, [7, 8], 'roy')],
    });
    const scores = scoreGame(game, seated({ ...PLAYERS, roy: 'red' }, [...PIS, 'roy']), keyOf);
    expect(detailsOf(scores)).toMatchObject({ rex: { bigClues: 1 }, roy: { bigClues: 0 }, ron: { bigClues: 0 } });
    const five = gameState({ history: [{ ...clue(1, [0, 1, 2, 3, 4]) }] });
    expect(detailsOf(scoreGame(five, SEATED, keyOf))).toMatchObject({ rex: { bigClues: 2 } });
    // Only the cards found count, not the cards marked.
    const marked = gameState({ history: [{ ...clue(1, [0, 1, 2]), targets: [0, 1, 2, 3, 4] }] });
    expect(detailsOf(scoreGame(marked, SEATED, keyOf))).toMatchObject({ rex: { bigClues: 0 } });
    // The PI's points: the group's 9 cards, 3 irrelevant papers at 2, the big clue.
    expect(pointsOf(scores).rex).toBe(9 - 3 * 2 + 1);
  });

  test('gives the students a point for the opening record, the PI nothing, and nobody anything for a near miss', () => {
    const opening = (count: ClueRecord['count'], guesses: Guess[], before: ClueRecord[] = []) =>
      detailsOf(
        scoreGame(
          gameState({
            history: [
              ...before,
              { turn: before.length + 1, team: 'red', at: 0, word: 'Go', count, guesses, captain: 'rex' },
            ],
          }),
          SEATED,
          keyOf,
        ),
      );
    const four = [guess(0, 'red', 'ron'), guess(1, 'red', 'rae'), guess(2, 'red', 'ron'), guess(3, 'red', 'rae')];
    // 4 named, 4 found first, and a wrong card after them changes nothing.
    expect(opening(4, [...four, guess(17, 'neutral', 'ron')])).toMatchObject({
      rex: { openingRecord: true },
      ron: { openingRecord: true },
      rae: { openingRecord: true },
      bo: { openingRecord: false },
    });
    // A wrong card among the first four, a clue of 3, of 0 or unlimited, too few found: none.
    const broken = [guess(0, 'red', 'ron'), guess(17, 'neutral', 'ron')];
    expect(opening(4, broken).rex).toMatchObject({ openingRecord: false });
    expect(opening(3, four.slice(0, 3)).rex).toMatchObject({ openingRecord: false });
    expect(opening(0, four).rex).toMatchObject({ openingRecord: false });
    expect(opening('unlimited', four).rex).toMatchObject({ openingRecord: false });
    expect(opening(5, four).rex).toMatchObject({ openingRecord: false });
    // A turn whose time ran out before the clue isn't the first clue: the next one is.
    const lost: ClueRecord = { turn: 1, team: 'red', at: 0, word: null, count: null, guesses: [], timedOut: true };
    const blue: ClueRecord = { turn: 2, team: 'blue', at: 0, word: 'Blue', count: 1, guesses: [] };
    expect(opening(4, four, [lost, blue]).ron).toMatchObject({ openingRecord: true });
    // A second clue that would have made it is too late.
    const first: ClueRecord = { turn: 1, team: 'red', at: 0, word: 'One', count: 1, guesses: [guess(4, 'red', 'ron')] };
    expect(opening(4, four, [first, blue]).ron).toMatchObject({ openingRecord: false });
    // The students get a point each; the PI has the big clue for the fourth card instead.
    const scores = scoreGame(
      gameState({ history: [{ ...lost, word: 'Go', count: 4, guesses: four, captain: 'rex' }] }),
      SEATED,
      keyOf,
    );
    expect(pointsOf(scores)).toMatchObject({ rex: 4 + 1, ron: 4 + 1, rae: 4 + 1 });
  });

  test('gives a group that wins with its first clue the heavenly hand, which adds up with the rest and outdoes the opening record', () => {
    const game = redWins(ALL_RED, 9);
    expect(detailsOf(scoreGame(game, SEATED, keyOf))).toMatchObject({
      rex: { role: 'captain', found: 9, won: true, bigClues: 6, openingRecord: false, heavenlyHand: true },
      ron: { role: 'guesser', found: 9, won: true, bigClues: 0, openingRecord: false, heavenlyHand: true },
      bo: { heavenlyHand: false, openingRecord: false },
    });
    // The PI: 9 cards, the win, 6 cards from the fourth on and 3; a student: 9, the win and 1. The
    // opening record, which the clue of 9 made on the way, is outdone, and brings nothing besides.
    expect(pointsOf(scoreGame(game, SEATED, keyOf))).toMatchObject({
      rex: 9 + 4 + 6 + 3,
      ron: 9 + 3 + 1,
      rae: 9 + 3 + 1,
    });
    // After blue's first turn, red's first clue still counts.
    const blue: ClueRecord = {
      turn: 1,
      team: 'blue',
      at: 0,
      word: 'Blue',
      count: 1,
      guesses: [guess(17, 'neutral', 'bea')],
    };
    expect(detailsOf(scoreGame(redWins(ALL_RED, 'unlimited', [blue]), SEATED, keyOf)).ron).toMatchObject({
      heavenlyHand: true,
      openingRecord: false,
    });
  });

  test('gives no heavenly hand to a group that wins with a later clue, or by the other group', () => {
    const first: ClueRecord = { turn: 1, team: 'red', at: 0, word: 'One', count: 1, guesses: [guess(0, 'red', 'ron')] };
    const blue: ClueRecord = { turn: 2, team: 'blue', at: 0, word: 'Blue', count: 1, guesses: [] };
    const later = redWins(ALL_RED.slice(1), 'unlimited', [first, blue]);
    expect(detailsOf(scoreGame(later, SEATED, keyOf)).ron).toMatchObject({ heavenlyHand: false });
    // Blue revealed red's last card, and red won in blue's turn.
    const gift = gameState({
      phase: 'over',
      result: { winner: 'red', reason: 'found' },
      history: [
        { turn: 1, team: 'red', at: 0, word: 'One', count: 'unlimited', guesses: ALL_RED.slice(1), captain: 'rex' },
        { turn: 2, team: 'blue', at: 0, word: 'Blue', count: 1, guesses: [guess(0, 'red', 'bea')], captain: 'bo' },
      ],
    });
    expect(detailsOf(scoreGame(gift, SEATED, keyOf)).ron).toMatchObject({ heavenlyHand: false, won: true });
  });

  test('costs the PI who was in the seat 5 for each missed deadline, and the students nothing', () => {
    const lost = (turn: number, team: Team, captain?: string): ClueRecord => ({
      turn,
      team,
      at: 0,
      word: null,
      count: null,
      guesses: [],
      timedOut: true,
      ...(captain ? { captain } : {}),
    });
    // Rex misses twice, and roy, who took the seat over, once; blue's turn 4 had nobody in its seat,
    // and red's students running out of time in turn 7 cost nothing.
    const game = gameState({
      history: [
        lost(1, 'red', 'rex'),
        { turn: 2, team: 'blue', at: 0, word: 'Two', count: 1, guesses: [guess(10, 'blue', 'bea')], captain: 'bo' },
        lost(3, 'red', 'rex'),
        lost(4, 'blue'),
        lost(5, 'red', 'roy'),
        { turn: 6, team: 'blue', at: 0, word: 'Six', count: 1, guesses: [], captain: 'bo' },
        { turn: 7, team: 'red', at: 0, word: 'Seven', count: 2, guesses: [], timedOut: true, captain: 'roy' },
      ],
    });
    const scores = scoreGame(game, seated({ ...PLAYERS, roy: 'red' }, [...PIS, 'roy']), keyOf);
    expect(detailsOf(scores)).toMatchObject({
      rex: { role: 'captain', missed: 2 },
      roy: { role: 'captain', missed: 1 },
      ron: { role: 'guesser', missed: 0 },
      bo: { role: 'captain', missed: 0 },
      bea: { role: 'guesser', missed: 0 },
    });
    expect(pointsOf(scores)).toMatchObject({ rex: -10, roy: -5, ron: 0, rae: 0, bo: 1, bea: 1 });
    // Under the key the PI had, also after they left the room.
    const gone = (id: string) => (id === 'rex' ? 'key-rex' : keyOf(id));
    expect(detailsOf(scoreGame(game, SEATED, gone)).rex).toMatchObject({ missed: 2 });
  });

  test('of a game in progress has no winner yet', () => {
    const game = { ...played(), phase: 'guess' as const, result: null };
    expect(pointsOf(scoreGame(game, SEATED, keyOf))).toMatchObject({ bo: 1 - 2, bea: 1 - 1, rae: 2 - 2 - 3 });
  });

  test('of a game that the chair withdrew is none', () => {
    const game = { ...played(), result: { winner: null, reason: 'withdrawn' as const } };
    expect(scoreGame(game, SEATED, keyOf)).toBeNull();
  });

  test('gives a big clue to its PI under the key they had, also after they left', () => {
    // rex has left the room; the room still knows his key.
    const gone = (id: string) => (id === 'rex' ? 'key-rex' : keyOf(id));
    const four = [0, 1, 2, 3].map((card) => guess(card, 'red', 'ron'));
    const game = gameState({
      history: [{ turn: 1, team: 'red', at: 0, word: 'Four', count: 1, guesses: four, captain: 'rex' }],
    });
    expect(detailsOf(scoreGame(game, SEATED, gone)).rex).toMatchObject({ bigClues: 1 });
  });
});

describe('the lineup of the waiting room', () => {
  const rules = (teams: MatchRules['teams'], grouping: MatchRules['grouping']): MatchSeating =>
    newMatchSeating({ games: 3, teams, grouping });

  test('is free outside a match, and when the players choose', () => {
    expect(lineupOf(null)).toBe('free');
    expect(lineupOf(rules('fixed', 'choose'))).toBe('free');
    expect(lineupOf(rules('switch', 'choose'))).toBe('free');
  });

  test('is drawn for every game when groups change at random, and for the first when they are fixed', () => {
    expect(lineupOf(rules('switch', 'random'))).toBe('draw');
    expect(lineupOf(rules('fixed', 'random'))).toBe('draw');
    const locked = { ...rules('fixed', 'random'), locked: new Map([['key-ann', 'red' as Team]]) };
    expect(lineupOf(locked)).toBe('fixed');
    expect(lineupOf({ ...rules('fixed', 'choose'), locked: locked.locked })).toBe('fixed');
    expect(lineupOf({ ...rules('switch', 'random'), locked: locked.locked })).toBe('draw');
  });
});

describe('the PI of a fixed group', () => {
  const seating = (seats: Record<string, Seat>): Seating => ({
    seats: new Map(Object.entries(seats)),
    keyViewers: new Set(),
    sides: new Map(),
  });
  const members = (ids: string[]) => ids.map((id) => ({ id, key: keyOf(id) }));
  const match = (captained: Record<string, number>, locked: Record<string, Team>): MatchSeating => ({
    ...newMatchSeating({ games: 3, teams: 'fixed', grouping: 'choose' }),
    captained: new Map(Object.entries(captained).map(([id, times]) => [keyOf(id), times])),
    locked: sides(locked),
  });

  test('is whoever has been one the fewest times, online first', () => {
    const before = seating({ ann: redPI, bob: red, cat: red, dee: bluePI, eve: blue });
    const after = arrangeFixed(
      before,
      members(['ann', 'bob', 'cat', 'dee', 'eve']),
      match({ ann: 1, dee: 1 }, { ann: 'red', bob: 'red', cat: 'red', dee: 'blue', eve: 'blue' }),
      new Set(['ann', 'bob', 'dee', 'eve']),
      seededRng(4),
    );
    // cat hasn't been a PI either, but is offline.
    expect(captainOf(after, 'red')).toBe('bob');
    expect(captainOf(after, 'blue')).toBe('eve');
    expect(seatOf(after, 'ann')).toEqual(red);
    expect(seatOf(after, 'cat')).toEqual(red);
  });

  test('goes to one of those who have been one as often, at random', () => {
    const chosen = new Set<string | null>();
    for (let seed = 0; seed < 20; seed += 1) {
      const after = arrangeFixed(
        seating({ ann: redPI, bob: red, cat: red, dee: bluePI, eve: blue }),
        members(['ann', 'bob', 'cat', 'dee', 'eve']),
        match({ ann: 1 }, { ann: 'red', bob: 'red', cat: 'red', dee: 'blue', eve: 'blue' }),
        new Set(['ann', 'bob', 'cat', 'dee', 'eve']),
        seededRng(seed),
      );
      chosen.add(captainOf(after, 'red'));
    }
    expect(chosen).toEqual(new Set(['bob', 'cat']));
  });

  test('puts everyone in their own group, newcomers in the smaller one, and leaves spectators be', () => {
    const before = seating({ ann: blue, bob: red, cat: red, dee: red, new: red, eve: SPECTATOR });
    const after = arrangeFixed(
      before,
      members(['ann', 'bob', 'cat', 'dee', 'new', 'eve']),
      match({}, { ann: 'red', bob: 'red', cat: 'blue', dee: 'blue', eve: 'red' }),
      new Set(['ann', 'bob', 'cat', 'dee', 'new', 'eve']),
      seededRng(1),
    );
    expect(seatOf(after, 'ann').team).toBe('red');
    expect(seatOf(after, 'cat').team).toBe('blue');
    // Two in each group, and the newcomer anywhere.
    expect(['red', 'blue']).toContain(seatOf(after, 'new').team);
    expect(seatOf(after, 'eve')).toEqual(SPECTATOR);
  });
});

describe('groups drawn at random', () => {
  const four = ['ann', 'bob', 'cat', 'dee'];
  const members = (ids: string[]) => ids.map((id) => ({ id, key: keyOf(id) }));
  const waiting: Seating = {
    seats: new Map(four.map((id) => [id, red])),
    keyViewers: new Set(),
    sides: new Map(),
  };
  const match = (groups: Record<string, Team>[], captained: Record<string, number> = {}): MatchSeating => ({
    ...newMatchSeating({ games: 5, teams: 'switch', grouping: 'random' }),
    groups: groups.map(sides),
    captained: new Map(Object.entries(captained).map(([id, times]) => [keyOf(id), times])),
  });
  // Who sat with whom, whatever the colors: "ann+bob" for ann and bob together.
  const pairing = (seating: Seating) => {
    const partner = four.find((id) => id !== 'ann' && seatOf(seating, id).team === seatOf(seating, 'ann').team);
    return `ann+${partner}`;
  };
  const draws = (history: MatchSeating, online = new Set(four)) =>
    Array.from({ length: 30 }, (_, seed) => drawGroups(waiting, members(four), history, online, seededRng(seed)));

  test('keep apart those who played together in the game before', () => {
    const seen = new Set(draws(match([{ ann: 'red', bob: 'red', cat: 'blue', dee: 'blue' }])).map(pairing));
    expect(seen).toEqual(new Set(['ann+cat', 'ann+dee']));
  });

  test('count the later games more', () => {
    const ab = { ann: 'red', bob: 'red', cat: 'blue', dee: 'blue' } as const;
    const ac = { ann: 'red', cat: 'red', bob: 'blue', dee: 'blue' } as const;
    const ad = { ann: 'blue', dee: 'blue', bob: 'red', cat: 'red' } as const;
    // Ann and cat are the PIs, having been one the fewest times, so bob and dee join one each: which,
    // the games before decide.
    const pis = { bob: 1, dee: 1 };
    expect(new Set(draws(match([ab, ac], pis)).map(pairing))).toEqual(new Set(['ann+dee']));
    // Every pairing has come once: the one of the first game is the one longest ago.
    expect(new Set(draws(match([ab, ac, ad], pis)).map(pairing))).toEqual(new Set(['ann+bob']));
    expect(new Set(draws(match([ad, ac, ab], pis)).map(pairing))).toEqual(new Set(['ann+dee']));
  });

  test('know nothing of the players who are new, and draw anything in the first game', () => {
    expect(new Set(draws(match([])).map(pairing))).toEqual(new Set(['ann+bob', 'ann+cat', 'ann+dee']));
    // Eve played in the game before; the others didn't.
    expect(new Set(draws(match([{ eve: 'red', zoe: 'blue' }])).map(pairing)).size).toBe(3);
  });

  test('make the two who have been PIs the fewest times the PIs, one of each group, online first', () => {
    // Dee has been none but is offline, so bob and cat, who have been one the fewest times of those
    // online, are the PIs, whatever the groups: they are never dealt into one.
    const drawn = draws(match([], { ann: 2, bob: 1, cat: 1 }), new Set(['ann', 'bob', 'cat']));
    for (const seating of drawn) {
      expect(new Set([captainOf(seating, 'red'), captainOf(seating, 'blue')])).toEqual(new Set(['bob', 'cat']));
      // A PI and a student in each group.
      expect([...seating.seats.values()].filter((seat) => seat.role === 'guesser')).toHaveLength(2);
    }
    // Which group each is the PI of is drawn too.
    expect(new Set(drawn.map((seating) => captainOf(seating, 'red')))).toEqual(new Set(['bob', 'cat']));
  });
});

// The module itself, as the room drives it.
describe('a match of the game', () => {
  const WORDS = Array.from({ length: 25 }, (_, i) => ({ word: `Word${i}` }));
  const ids = ['ann', 'bob', 'cat', 'dee', 'eve'];

  function withMatch(rules: Omit<MatchRules, 'games'>, seats: Record<string, Seat> = {}): KeywordsData {
    const data = keywordsGame.match?.setup(keywordsGame.create('en'), context(ids), { games: 3, ...rules });
    if (!data) throw new Error('no match');
    return { ...data, seating: { ...data.seating, seats: new Map(Object.entries(seats)) } };
  }

  const start = (data: KeywordsData, ctx = context(ids)) => keywordsGame.start(data, ctx, WORDS, 'game-1');
  const end = (data: KeywordsData, winner: Team | null): KeywordsData => ({
    ...data,
    game: data.game && {
      ...data.game,
      phase: 'over',
      result: winner ? { winner, reason: 'found' } : { winner: null, reason: 'withdrawn' },
    },
  });
  const seat = (data: KeywordsData, id: string, wanted: Seat, phase: RoomPhase = 'lobby') =>
    keywordsGame.handle(data, context(ids, { phase }), id, 'keywords:seat', wanted);
  const teams = (data: KeywordsData) =>
    Object.fromEntries(ids.map((id) => [id, seatOf(data.seating, id).team]).filter(([, team]) => team !== null));

  const chosen = { ann: redPI, bob: red, cat: bluePI, dee: blue };

  test('with fixed groups keeps them from the first scored game on, and passes the PI on', () => {
    const first = start(withMatch({ teams: 'fixed', grouping: 'choose' }, chosen));
    const next = keywordsGame.again(end(first, 'red'), context(ids));
    expect(teams(next)).toEqual({ ann: 'red', bob: 'red', cat: 'blue', dee: 'blue' });
    expect(captainOf(next.seating, 'red')).toBe('bob');
    expect(captainOf(next.seating, 'blue')).toBe('dee');
    const view = keywordsGame.views(next, context(ids))({ playerId: 'ann' });
    expect(view).toMatchObject({ lineup: 'fixed', side: 'red' });
    // Nobody can move to the other group, nor shuffle them.
    expect(seat(next, 'ann', blue)).toEqual({ ok: false, error: 'other_team' });
    expect(seat(next, 'ann', SPECTATOR).ok).toBe(true);
    expect(keywordsGame.shuffle(next, context(ids))).toBe(next);
  });

  test('with fixed groups lets the players choose again after a first game that was withdrawn', () => {
    const first = start(withMatch({ teams: 'fixed', grouping: 'choose' }, chosen));
    const next = keywordsGame.again(end(first, null), context(ids));
    expect(next.seating.seats).toEqual(first.seating.seats);
    expect(keywordsGame.views(next, context(ids))({ playerId: 'ann' })).toMatchObject({ lineup: 'free', side: null });
    expect(seat(next, 'ann', bluePI)).toEqual({ ok: false, error: 'seat_taken' });
    expect(seat(next, 'ann', blue).ok).toBe(true);
  });

  test('with groups drawn at random needs four players online, and draws them when it starts', () => {
    let data = withMatch({ teams: 'switch', grouping: 'random' }, { ann: red, bob: red, cat: red, dee: red });
    expect(keywordsGame.canStart(data, context(ids, { offline: ['dee'] }))).toBe(false);
    expect(keywordsGame.views(data, context(ids, { offline: ['dee'] }))({ playerId: 'ann' }).startProblems).toEqual([
      { problem: 'needs_players', missing: 1 },
    ]);
    expect(keywordsGame.canStart(data, context(ids))).toBe(true);
    expect(keywordsGame.shuffle(data, context(ids))).toBe(data);
    data = start(data);
    const seats = [...data.seating.seats.values()];
    expect(seats.filter(({ role }) => role === 'captain').map(({ team }) => team)).toEqual(
      expect.arrayContaining(['red', 'blue']),
    );
    expect(seats.filter(({ team }) => team === 'red')).toHaveLength(2);
  });

  // A match of `games` games whose groups are drawn at random, each won by red: who was in which seat
  // in each game.
  function drawnMatch(players: string[], games: number, seed: number): Seating[] {
    const rng = seededRng(seed);
    const ctx = context(players, { rng });
    let data = keywordsGame.match?.setup(keywordsGame.create('en'), ctx, {
      games,
      teams: 'switch',
      grouping: 'random',
    }) as KeywordsData;
    data = { ...data, seating: { ...data.seating, seats: new Map(players.map((id) => [id, red])) } };
    const seatings: Seating[] = [];
    for (let game = 0; game < games; game += 1) {
      data = keywordsGame.start(data, ctx, WORDS, `game-${game}`);
      seatings.push(data.seating);
      data = keywordsGame.again(end(data, 'red'), ctx);
    }
    return seatings;
  }

  // How evenly the players of a match have been in a group with each other: the spread (the
  // standard deviation) of how many games each pair of them has played in the same group.
  function spread(players: string[], seatings: readonly Seating[]): number {
    const counts = players.flatMap((one, at) =>
      players
        .slice(at + 1)
        .map((other) => seatings.filter((seating) => seatOf(seating, one).team === seatOf(seating, other).team).length),
    );
    const mean = counts.reduce((sum, count) => sum + count, 0) / counts.length;
    return Math.sqrt(counts.reduce((sum, count) => sum + (count - mean) ** 2, 0) / counts.length);
  }

  test('with groups drawn at random makes everyone a PI in turn: five players, five games', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const seatings = drawnMatch(ids, 5, seed);
      const pis = new Set(seatings.flatMap((seating) => [captainOf(seating, 'red'), captainOf(seating, 'blue')]));
      expect(pis, `seed ${seed}`).toEqual(new Set(ids));
    }
  });

  test('with groups drawn at random makes everyone a PI once before anyone is one twice', () => {
    // How many games each player was a PI in.
    const times = (players: string[], games: number, seed: number) => {
      const counts = new Map(players.map((id) => [id, 0]));
      for (const seating of drawnMatch(players, games, seed)) {
        for (const pi of [captainOf(seating, 'red'), captainOf(seating, 'blue')]) {
          counts.set(pi as string, (counts.get(pi as string) ?? 0) + 1);
        }
      }
      return [...counts.values()].sort();
    };
    const six = [...ids, 'fay'];
    const eight = [...six, 'gus', 'hal'];
    for (let seed = 0; seed < 50; seed += 1) {
      expect(times(six, 3, seed), `six players, seed ${seed}`).toEqual([1, 1, 1, 1, 1, 1]);
      expect(times(eight, 4, seed), `eight players, seed ${seed}`).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
      expect(times(ids.slice(0, 4), 3, seed), `four players, seed ${seed}`).toEqual([1, 1, 2, 2]);
    }
  });

  test('with groups drawn at random keeps them more apart than drawing again once when they repeat', () => {
    let drawn = 0;
    let before = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      drawn += spread(ids, drawnMatch(ids, 5, seed));
      // As the groups used to be drawn: the chair's shuffle, against the game before.
      const rng = seededRng(seed);
      let seating: Seating = { seats: new Map(ids.map((id) => [id, red])), keyViewers: new Set(), sides: new Map() };
      const seatings: Seating[] = [];
      for (let game = 0; game < 5; game += 1) {
        seating = shuffleGroups(seating, rng, new Set(ids));
        seatings.push(seating);
      }
      before += spread(ids, seatings);
    }
    // About 0.7 against 1.
    expect(drawn / 200).toBeLessThan(0.8);
    expect(before / 200).toBeGreaterThan(0.9);
  });

  test('costs the PI in the seat 5 when their time for the clue runs out', () => {
    const data = start(withMatch({ teams: 'fixed', grouping: 'choose' }, chosen));
    const game = data.game as KeywordsState;
    const late = { ...context(ids, { phase: 'playing' }), now: () => (game.clock?.ends ?? 0) + 1 };
    const expired = keywordsGame.tick(data, late);
    const pi = captainOf(data.seating, game.team) as string;
    expect(expired.game?.history[0]).toMatchObject({ word: null, timedOut: true, captain: pi });
    const scores = keywordsGame.match?.score(expired, late) ?? [];
    const of = (id: string) => scores.find(({ key }) => key === keyOf(id));
    expect(of(pi)).toMatchObject({ points: -5, detail: { role: 'captain', missed: 1 } });
    for (const id of ['ann', 'bob', 'cat', 'dee'].filter((other) => other !== pi)) {
      expect(of(id)?.points, id).toBe(0);
    }
  });

  test('costs the PI who left the seat before the time ran out, as it would in the seat', () => {
    const data = start(withMatch({ teams: 'fixed', grouping: 'choose' }, chosen));
    const game = data.game as KeywordsState;
    const pi = captainOf(data.seating, game.team) as string;
    const late = { ...context(ids, { phase: 'playing' }), now: () => (game.clock?.ends ?? 0) + 1 };
    const missedBy = (expired: KeywordsData) => {
      expect(expired.game?.events.at(-1)).toMatchObject({ kind: 'missed', team: game.team });
      return keywordsGame.match?.score(expired, late)?.find(({ key }) => key === keyOf(pi));
    };
    // The PI steps down to watch, the seat stands empty when the time runs out, and the PI takes it
    // back afterwards: the turn costs them as it would have in the seat.
    const stepped = seat(data, pi, SPECTATOR, 'playing');
    if (!stepped.ok) throw new Error(stepped.error);
    expect(captainOf(stepped.data.seating, game.team)).toBeNull();
    const expired = keywordsGame.tick(stepped.data, late);
    expect(expired.game?.history[0]).toMatchObject({ word: null, timedOut: true, captain: pi });
    const back = seat(expired, pi, { team: game.team, role: 'captain' }, 'playing');
    if (!back.ok) throw new Error(back.error);
    expect(missedBy(back.data)).toMatchObject({ points: -5, detail: { role: 'captain', missed: 1 } });
    // So does leaving the room.
    const gone = keywordsGame.tick(keywordsGame.leave(data, pi), late);
    expect(gone.game?.history[0]).toMatchObject({ captain: pi });
    expect(missedBy(gone)).toMatchObject({ points: -5 });
    // Someone who takes the empty seat over pays instead.
    const student = game.team === 'red' ? 'bob' : 'dee';
    const taken = seat(stepped.data, student, { team: game.team, role: 'captain' }, 'playing');
    if (!taken.ok) throw new Error(taken.error);
    const theirs = keywordsGame.tick(taken.data, late);
    expect(theirs.game?.history[0]).toMatchObject({ captain: student });
    expect(missedBy(theirs)?.points).toBe(0);
    // A PI whom the chair benches didn't choose to leave: the empty seat costs nobody, and the PI
    // nothing once back in it.
    const chair = { ...context(ids, { phase: 'playing' }), chairId: student };
    const benched = keywordsGame.bench(data, chair, pi);
    expect(captainOf(benched.seating, game.team)).toBeNull();
    const spared = keywordsGame.tick(benched, late);
    expect(spared.game?.history[0]).toMatchObject({ word: null, timedOut: true });
    expect(spared.game?.history[0]).not.toHaveProperty('captain');
    expect(spared.game?.events).toHaveLength(0);
    const returned = seat(spared, pi, { team: game.team, role: 'captain' }, 'playing');
    if (!returned.ok) throw new Error(returned.error);
    expect(keywordsGame.match?.score(returned.data, late)?.find(({ key }) => key === keyOf(pi))?.points).toBe(0);
    // The chair benching themselves is stepping down.
    const self = keywordsGame.bench(data, { ...chair, chairId: pi }, pi);
    expect(missedBy(keywordsGame.tick(self, late))).toMatchObject({ points: -5 });
  });

  test('lets a newcomer watch the game that is on, and seats them for the next one', () => {
    let data = start(withMatch({ teams: 'fixed', grouping: 'choose' }, chosen));
    const ctx = context(ids, { phase: 'playing' });
    data = keywordsGame.join(data, ctx, 'eve', true);
    expect(seatOf(data.seating, 'eve')).toEqual(SPECTATOR);
    expect(keywordsGame.views(data, ctx)({ playerId: 'eve' })).toMatchObject({ joinsNext: true });
    expect(seat(data, 'eve', red, 'playing')).toEqual({ ok: false, error: 'between_games' });
    data = keywordsGame.again(end(data, 'blue'), context(ids));
    expect(seatOf(data.seating, 'eve').team).not.toBeNull();
    expect(keywordsGame.views(data, context(ids))({ playerId: 'eve' })).toMatchObject({ joinsNext: false });
  });

  test('lets a newcomer who changes their mind watch the next game too', () => {
    let data = start(withMatch({ teams: 'switch', grouping: 'choose' }, chosen));
    data = keywordsGame.join(data, context(ids, { phase: 'playing' }), 'eve', true);
    const watching = seat(data, 'eve', SPECTATOR, 'playing');
    if (!watching.ok) throw new Error(watching.error);
    data = keywordsGame.again(end(watching.data, 'blue'), context(ids));
    expect(seatOf(data.seating, 'eve')).toEqual(SPECTATOR);
  });

  test('lets whoever played for a group in the game come back to it while it is on', () => {
    let data = start(withMatch({ teams: 'switch', grouping: 'choose' }, chosen));
    const out = seat(data, 'bob', SPECTATOR, 'playing');
    if (!out.ok) throw new Error(out.error);
    data = out.data;
    expect(seat(data, 'bob', red, 'playing').ok).toBe(true);
  });

  test('with groups that may change keeps nobody in a group after a game', () => {
    const first = start(withMatch({ teams: 'switch', grouping: 'choose' }, chosen));
    const next = keywordsGame.again(end(first, 'red'), context(ids));
    expect(next.seating.seats).toEqual(first.seating.seats);
    expect(seat(next, 'ann', blue).ok).toBe(true);
  });

  test("remembers a guest's group and PI turns under their account", () => {
    const first = start(withMatch({ teams: 'fixed', grouping: 'choose' }, chosen));
    const next = keywordsGame.again(end(first, 'red'), context(ids));
    const moved = keywordsGame.rekey?.(next, 'bob', 'key-bob', 'key-account');
    expect(moved?.match?.locked.get('key-account')).toBe('red');
    expect(moved?.match?.locked.has('key-bob')).toBe(false);
  });

  test('ends with the room going back to an ordinary one', () => {
    const data = withMatch({ teams: 'fixed', grouping: 'random' });
    const ordinary = keywordsGame.match?.setup(data, context(ids), null);
    expect(ordinary?.match).toBeNull();
    expect(keywordsGame.match?.lineup(start({ ...data, seating: { ...data.seating, seats: new Map() } }))).toEqual([]);
  });
});

describe('fixed groups', () => {
  const ids = ['ann', 'bob', 'cat', 'dee'];
  const WORDS = Array.from({ length: 25 }, (_, i) => ({ word: `Word${i}` }));

  function afterFirstGame(): KeywordsData {
    const setup = keywordsGame.match?.setup(keywordsGame.create('en'), context(ids), {
      games: 3,
      teams: 'fixed',
      grouping: 'choose',
    }) as KeywordsData;
    const seats = new Map(Object.entries({ ann: redPI, bob: red, cat: bluePI, dee: blue }));
    const started = keywordsGame.start({ ...setup, seating: { ...setup.seating, seats } }, context(ids), WORDS, 'g1');
    const over = {
      ...started,
      game: started.game && {
        ...started.game,
        phase: 'over' as const,
        result: { winner: 'red' as const, reason: 'found' as const },
      },
    };
    return keywordsGame.again(over, context(ids));
  }

  test("tell the view a player's group in the waiting room, but not during a game they don't play in", () => {
    let data = afterFirstGame();
    expect(keywordsGame.views(data, context(ids))({ playerId: 'ann' }).side).toBe('red');
    const out = keywordsGame.handle(data, context(ids), 'ann', 'keywords:seat', SPECTATOR);
    if (!out.ok) throw new Error(out.error);
    data = keywordsGame.start(out.data, context(ids, { phase: 'playing' }), WORDS, 'g2');
    expect(keywordsGame.views(data, context(ids, { phase: 'playing' }))({ playerId: 'ann' }).side).toBeNull();
  });

  test('keep a player in their group, also when the other has too few players left to play', () => {
    let data = afterFirstGame();
    const seat = (id: string, wanted: Seat) => keywordsGame.handle(data, context(ids), id, 'keywords:seat', wanted);
    expect(seat('bob', blue)).toEqual({ ok: false, error: 'other_team' });
    // Both of blue's players leave: the groups stay as they are, and the chair ends the match early
    // or waits for newcomers.
    data = keywordsGame.leave(keywordsGame.leave(data, 'cat'), 'dee');
    expect(seat('bob', bluePI)).toEqual({ ok: false, error: 'other_team' });
    expect(data.match?.locked.get(keyOf('bob'))).toBe('red');
    expect(keywordsGame.views(data, context(ids))({ playerId: 'bob' }).side).toBe('red');
  });

  test('send a newcomer to the group with fewer players, and keep them out of the bigger one', () => {
    const all = [...ids, 'eve'];
    const seat = (data: KeywordsData, wanted: Seat) =>
      keywordsGame.handle(data, context(all), 'eve', 'keywords:seat', wanted);
    // Two against one, once Dee has left: Eve goes to blue, and red is closed to her.
    let data = keywordsGame.join(keywordsGame.leave(afterFirstGame(), 'dee'), context(all), 'eve', true);
    expect(seatOf(data.seating, 'eve')).toEqual(blue);
    expect(seat(data, red)).toEqual({ ok: false, error: 'bigger_group' });
    expect(seat(data, bluePI).ok).toBe(true);
    // Two against two: she may sit in either group, and move to the other, which has as many
    // without her.
    data = keywordsGame.join(afterFirstGame(), context(all), 'eve', true);
    const team = seatOf(data.seating, 'eve').team as Team;
    const other = team === 'red' ? blue : red;
    const moved = seat(data, other);
    if (!moved.ok) throw new Error(moved.error);
    expect(seatOf(moved.data.seating, 'eve')).toEqual(other);
    expect(seat(moved.data, { team, role: 'guesser' }).ok).toBe(true);
  });

  test("fix a guest's account to the group of the seat the guest took, when it played for the other", () => {
    // Bob's account played the first game for red and left, and so did both of blue. Bob comes back
    // as a guest, is seated in blue, which is the smaller group now, and logs in: the seat stands.
    let data = afterFirstGame();
    for (const id of ['bob', 'cat', 'dee']) data = keywordsGame.leave(data, id);
    const back = context(['ann', 'eve']);
    data = keywordsGame.join(data, back, 'eve', true);
    expect(seatOf(data.seating, 'eve')).toEqual(blue);
    data = keywordsGame.rekey?.(data, 'eve', 'key-eve', 'key-bob') as KeywordsData;
    expect(data.match?.locked.get('key-bob')).toBe('blue');
    expect(data.match?.locked.has('key-eve')).toBe(false);
    const adopted = { ...back, keyOf: (id: string) => (id === 'eve' ? 'key-bob' : keyOf(id)) };
    expect(keywordsGame.views(data, adopted)({ playerId: 'eve' }).side).toBe('blue');
    expect(keywordsGame.handle(data, adopted, 'eve', 'keywords:seat', red)).toEqual({
      ok: false,
      error: 'other_team',
    });
    expect(keywordsGame.handle(data, adopted, 'eve', 'keywords:seat', bluePI).ok).toBe(true);
  });
});

describe('rekeying a match', () => {
  const rules: MatchRules = { games: 3, teams: 'fixed', grouping: 'choose' };
  const remembered = (
    locked: Record<string, Team>,
    captained: Record<string, number> = {},
    waiting: string[] = [],
  ): MatchSeating => ({
    ...newMatchSeating(rules),
    locked: new Map(Object.entries(locked)),
    captained: new Map(Object.entries(captained)),
    waiting: new Set(waiting),
  });

  test("adds what the match knew of the guest to the account's own, under the account's key alone", () => {
    const moved = rekeyMatch(
      remembered({ guest: 'blue', account: 'red' }, { guest: 1, account: 2 }, ['guest']),
      'guest',
      'account',
      'blue',
    );
    expect(moved.locked).toEqual(new Map([['account', 'blue']]));
    expect(moved.captained).toEqual(new Map([['account', 3]]));
    expect(moved.waiting).toEqual(new Set(['account']));
  });

  test('moves the groups that the guest played in to the account', () => {
    const groups: MatchSeating['groups'] = [
      new Map([
        ['guest', 'red'],
        ['other', 'red'],
      ]),
      new Map([
        ['account', 'blue'],
        ['other', 'red'],
      ]),
    ];
    const moved = rekeyMatch({ ...remembered({}), groups }, 'guest', 'account', undefined);
    expect(moved.groups).toEqual([
      new Map([
        ['other', 'red'],
        ['account', 'red'],
      ]),
      groups[1],
    ]);
  });

  test("fixes the account to the seat's group, else to the guest's, else to its own, and only once fixed", () => {
    const locked = (match: MatchSeating, team: Team | undefined) => rekeyMatch(match, 'guest', 'account', team).locked;
    expect(locked(remembered({ account: 'red' }), 'blue')).toEqual(new Map([['account', 'blue']]));
    expect(locked(remembered({ guest: 'blue', account: 'red' }), undefined)).toEqual(new Map([['account', 'blue']]));
    expect(locked(remembered({ account: 'red' }), undefined)).toEqual(new Map([['account', 'red']]));
    expect(locked(remembered({}), 'blue').size).toBe(0);
  });
});
