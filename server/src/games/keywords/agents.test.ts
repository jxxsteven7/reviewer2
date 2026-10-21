import { type AgentAnswer } from '@reviewer2/shared';
import { defaultSettings, type CardColor, type ClueRecord, type Seat } from '@reviewer2/shared/keywords';
import { describe, expect, test } from 'vitest';
import type { AgentTask, GameContext } from '../../core/game';
import { seededRng } from '../../core/random';
import { agentMove, agentProblems, agentTask, featsOf, totalsOf } from './agents';
import type { KeywordsData } from './index';
import { emptySeating, shuffleGroups } from './seats';
import type { KeywordsState } from './state';
import { gameState } from './testing';

// What the game makes of AI players (docs/games/keywords.md#ai-players): what keeps a game with them
// from starting, what each seat is asked and what it is told, the messages an answer makes, and the
// chair's shuffle around them, and what its page counts of the games they played.

const NOTE = { model: 'm', prompt: 'p', ms: 1 };

// Red: an AI PI and an AI student, and Rob, a person, as a student too; blue: Bea and Ben.
const SEATS: [string, Seat][] = [
  ['ai-pi', { team: 'red', role: 'captain' }],
  ['ai-student', { team: 'red', role: 'guesser' }],
  ['rob', { team: 'red', role: 'guesser' }],
  ['bea', { team: 'blue', role: 'captain' }],
  ['ben', { team: 'blue', role: 'guesser' }],
];

function context(online = new Set(SEATS.map(([id]) => id))): GameContext {
  return {
    phase: 'playing',
    language: 'en',
    rng: seededRng(1),
    chairId: 'bea',
    public: false,
    now: () => 0,
    keyOf: (id) => id,
    isOnline: (id) => online.has(id),
    agentOf: (id) => (id.startsWith('ai-') ? 'reviewer1' : null),
    titleCount: () => null,
    awardsTitles: () => false,
    playerIds: () => SEATS.map(([id]) => id),
    hasAccount: () => false,
    hasField: () => true,
    customAuthor: () => null,
  };
}

function data(game: KeywordsState | null = gameState(), seats = SEATS): KeywordsData {
  return {
    settings: defaultSettings('en'),
    seating: { ...emptySeating(), seats: new Map(seats) },
    game,
    vacated: { red: null, blue: null },
    match: null,
    customAuthor: null,
  };
}

describe('a game with AI players', () => {
  test('needs every time limit and a person in a group to start', () => {
    const ctx = context();
    expect(agentProblems(data(null), ctx)).toEqual([]);
    const untimed = { ...data(null), settings: { ...defaultSettings('en'), guessTime: 0 } };
    expect(agentProblems(untimed, ctx)).toEqual([{ problem: 'needs_timers' }]);
    const onlyAi = data(
      null,
      SEATS.filter(([id]) => id.startsWith('ai-')),
    );
    expect(agentProblems(onlyAi, ctx)).toEqual([{ problem: 'needs_human' }]);
    // A room without AI players is none of this's business.
    expect(agentProblems({ ...untimed, seating: { ...emptySeating(), seats: new Map(SEATS.slice(2)) } }, ctx)).toEqual(
      [],
    );
  });
});

describe('the task of an AI seat', () => {
  test('is the clue for the PI in its turn, with every color, and nothing in the other turn', () => {
    const ctx = context();
    const task = agentTask(data(), ctx, 'ai-pi');
    expect(task).toMatchObject({ moment: 'game-1:1:clue', kind: 'clue', advice: false, pace: { first: 3_000 } });
    expect(task?.question.game === 'keywords' && task.question.cards.every((card) => card.color !== undefined)).toBe(
      true,
    );
    expect(agentTask(data(gameState({ team: 'blue' })), ctx, 'ai-pi')).toBeNull();
    expect(agentTask(data(gameState({ pause: { left: 1_000 } })), ctx, 'ai-pi')).toBeNull();
    expect(agentTask(data(gameState({ phase: 'over' })), ctx, 'ai-pi')).toBeNull();
  });

  test('is advice for a student while a person of its group is there, and the guesses when none is', () => {
    const game = gameState({ phase: 'guess', clue: { word: 'zebra', count: 2 } });
    const advice = agentTask(data(game), context(), 'ai-student');
    expect(advice).toMatchObject({ moment: 'game-1:1:guess:advise', kind: 'advise', advice: true });
    // A student is told no color of a card that is face down.
    expect(advice?.question.game === 'keywords' && advice.question.cards.some((card) => card.color !== undefined)).toBe(
      false,
    );
    expect(advice?.question).toMatchObject({ kind: 'guess', clue: { word: 'zebra', count: 2 }, guessesLeft: 3 });
    const alone = agentTask(data(game), context(new Set(['ai-pi', 'ai-student', 'bea'])), 'ai-student');
    expect(alone).toMatchObject({ moment: 'game-1:1:guess:play', kind: 'guess', advice: false });
    // A person of the other group changes nothing.
    expect(agentTask(data(game), context(new Set(['ai-student', 'ben'])), 'ai-student')?.advice).toBe(false);
  });
});

describe('the moves of an answer', () => {
  const clue: AgentAnswer = { ok: true, kind: 'clue', word: 'zebra', count: 2, targets: [0, 1], note: NOTE };
  const guess: AgentAnswer = { ok: true, kind: 'guess', picks: [3, 4], reason: 'Stripes.', note: NOTE };
  const task = (advice: boolean) => ({ advice }) as AgentTask;

  test('give the clue once, with its cards', () => {
    expect(agentMove(data(), 'ai-pi', task(false), clue, [])).toEqual({
      type: 'keywords:clue',
      payload: { gameId: 'game-1', turn: 1, word: 'zebra', count: 2, targets: [0, 1] },
    });
    expect(agentMove(data(), 'ai-pi', task(false), clue, ['keywords:clue'])).toBeNull();
  });

  test('reveal the cards in order, and then end the turn', () => {
    const playing = gameState({ phase: 'guess', clue: { word: 'zebra', count: 2 } });
    expect(agentMove(data(playing), 'ai-student', task(false), guess, [])).toMatchObject({
      type: 'keywords:reveal',
      payload: { card: 3 },
    });
    const cards = playing.cards.map((card, i) => (i === 3 ? { ...card, revealed: true } : card));
    const one = { ...playing, cards, guessesMade: 1 };
    expect(agentMove(data(one), 'ai-student', task(false), guess, ['keywords:reveal'])).toMatchObject({
      payload: { card: 4 },
    });
    const both = {
      ...one,
      cards: cards.map((card, i) => (i === 4 ? { ...card, revealed: true } : card)),
      guessesMade: 2,
    };
    expect(agentMove(data(both), 'ai-student', task(false), guess, ['keywords:reveal', 'keywords:reveal'])).toEqual({
      type: 'keywords:pass',
      payload: { gameId: 'game-1', turn: 1 },
    });
    expect(agentMove(data(both), 'ai-student', task(false), guess, ['keywords:pass'])).toBeNull();
  });

  test('advise by choosing a card and saying why once, and choose the next once it is revealed', () => {
    const playing = gameState({ phase: 'guess', clue: { word: 'zebra', count: 2 } });
    expect(agentMove(data(playing), 'ai-student', task(true), guess, [])).toMatchObject({
      type: 'keywords:select',
      payload: { card: 3 },
    });
    const chosen = { ...playing, selections: [{ player: 'ai-student', card: 3 }] };
    expect(agentMove(data(chosen), 'ai-student', task(true), guess, ['keywords:select'])).toEqual({
      type: 'keywords:say',
      payload: { gameId: 'game-1', text: 'Stripes.' },
    });
    expect(agentMove(data(chosen), 'ai-student', task(true), guess, ['keywords:select', 'keywords:say'])).toBeNull();
    const revealed = {
      ...playing,
      cards: playing.cards.map((card, i) => (i === 3 ? { ...card, revealed: true } : card)),
    };
    expect(
      agentMove(data(revealed), 'ai-student', task(true), guess, ['keywords:select', 'keywords:say']),
    ).toMatchObject({
      type: 'keywords:select',
      payload: { card: 4 },
    });
  });
});

describe('the shuffle with AI players', () => {
  test('leaves them in their seats and deals the people around them, an AI PI keeping its group', () => {
    const people = ['p1', 'p2', 'p3', 'p4'];
    const seats = new Map<string, Seat>([
      ['ai-pi', { team: 'red', role: 'captain' }],
      ['ai-student', { team: 'red', role: 'guesser' }],
      ...people.map((id): [string, Seat] => [id, { team: 'blue', role: 'guesser' }]),
    ]);
    for (let seed = 1; seed <= 20; seed += 1) {
      const shuffled = shuffleGroups(
        { ...emptySeating(), seats },
        seededRng(seed),
        new Set([...seats.keys()]),
        new Set(['ai-pi', 'ai-student']),
      );
      expect(shuffled.seats.get('ai-pi')).toEqual({ team: 'red', role: 'captain' });
      expect(shuffled.seats.get('ai-student')).toEqual({ team: 'red', role: 'guesser' });
      const red = people.filter((id) => shuffled.seats.get(id)?.team === 'red');
      const blue = people.filter((id) => shuffled.seats.get(id)?.team === 'blue');
      // Three a group: the red group has its two AI players and one person.
      expect([red.length, blue.length]).toEqual([1, 3]);
      expect(red.every((id) => shuffled.seats.get(id)?.role === 'guesser')).toBe(true);
      expect(blue.filter((id) => shuffled.seats.get(id)?.role === 'captain')).toHaveLength(1);
    }
  });
});

describe('what the page of an AI counts', () => {
  const guess = (card: number, color: CardColor, player: string) => ({ card, color, player, at: 0 });
  const clue = (turn: number, word: string, captain: string, guesses: ClueRecord['guesses']): ClueRecord => ({
    turn,
    team: 'red',
    at: 0,
    word,
    count: 2,
    guesses,
    captain,
  });

  test("counts the clues of a seat, the group's cards they found, its best clue and the Reviewer 2 it revealed", () => {
    const history: ClueRecord[] = [
      clue(1, 'Pair', 'ai-pi', [guess(0, 'red', 'rob'), guess(1, 'red', 'ai-student')]),
      // A clue that found nothing is no best one, and the next clue that finds as many is not.
      clue(3, 'Dud', 'ai-pi', [guess(10, 'blue', 'rob')]),
      clue(5, 'Same', 'ai-pi', [guess(2, 'red', 'rob'), guess(3, 'red', 'rob'), guess(4, 'reviewer2', 'ai-student')]),
      // The turn in which the time ran out has no clue.
      { turn: 7, team: 'red', at: 0, word: null, count: null, guesses: [], timedOut: true, captain: 'ai-pi' },
    ];
    const game = { ...gameState(), history };
    expect(featsOf(game, 'ai-pi')).toEqual({ clues: 3, found: 4, reviewer2: 0, best: { word: 'Pair', found: 2 } });
    expect(featsOf(game, 'ai-student')).toEqual({ clues: 0, found: 0, reviewer2: 1, best: null });
    expect(featsOf(null, 'ai-pi')).toEqual({ clues: 0, found: 0, reviewer2: 0, best: null });
  });

  test('adds up its seats, the earliest of the clues that found the most being the best', () => {
    expect(totalsOf([])).toEqual({ clues: 0, found: 0, reviewer2: 0, best: null });
    expect(
      totalsOf([
        { clues: 2, found: 3, reviewer2: 0, best: { word: 'One', found: 2 } },
        { clues: 0, found: 0, reviewer2: 1, best: null },
        { clues: 1, found: 2, reviewer2: 0, best: { word: 'Two', found: 2 } },
        { clues: 4, found: 5, reviewer2: 2, best: { word: 'Three', found: 3 } },
        { clues: 1, found: 3, reviewer2: 0, best: { word: 'Four', found: 3 } },
      ]),
    ).toEqual({ clues: 8, found: 13, reviewer2: 3, best: { word: 'Three', found: 3 } });
  });
});
