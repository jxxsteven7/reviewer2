import { defaultSettings, type AgentAnswer, type Seat } from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import type { AgentTask, GameContext } from '../../core/game';
import { seededRng } from '../../core/random';
import { agentMove, agentProblems, agentTask } from './agents';
import type { KeywordsData } from './index';
import { emptySeating, shuffleGroups } from './seats';
import type { KeywordsState } from './state';
import { gameState } from './testing';

// What the game makes of AI players (docs/games/keywords.md#ai-players): what keeps a game with them
// from starting, what each seat is asked and what it is told, the messages an answer makes, and the
// chair's shuffle around them.

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
    now: () => 0,
    keyOf: (id) => id,
    whoIs: () => ({ account: true }),
    isOnline: (id) => online.has(id),
    agentOf: (id) => (id.startsWith('ai-') ? 'reviewer1' : null),
    titleCount: () => null,
    awardsTitles: () => false,
    playerIds: () => SEATS.map(([id]) => id),
  };
}

function data(game: KeywordsState | null = gameState(), seats = SEATS): KeywordsData {
  return {
    settings: defaultSettings('en'),
    seating: { ...emptySeating(), seats: new Map(seats) },
    game,
    vacated: { red: null, blue: null },
    match: null,
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
    expect(task?.question.cards.every((card) => card.color !== undefined)).toBe(true);
    expect(agentTask(data(gameState({ team: 'blue' })), ctx, 'ai-pi')).toBeNull();
    expect(agentTask(data(gameState({ pause: { left: 1_000 } })), ctx, 'ai-pi')).toBeNull();
    expect(agentTask(data(gameState({ phase: 'over' })), ctx, 'ai-pi')).toBeNull();
  });

  test('is advice for a student while a person of its group is there, and the guesses when none is', () => {
    const game = gameState({ phase: 'guess', clue: { word: 'zebra', count: 2 } });
    const advice = agentTask(data(game), context(), 'ai-student');
    expect(advice).toMatchObject({ moment: 'game-1:1:guess:advise', kind: 'advise', advice: true });
    // A student is told no color of a card that is face down.
    expect(advice?.question.cards.some((card) => card.color !== undefined)).toBe(false);
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
