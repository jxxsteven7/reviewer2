import { TEAMS, type AgentAnswer, type AgentGame, type KeywordsAgentFeats, type StartProblem } from '@reviewer2/shared';
import { KEYWORDS_MESSAGES } from '@reviewer2/shared/schemas';
import type { AgentMove, AgentTask, GameContext, PracticeSeats } from '../../core/game';
import type { KeywordsData } from './index';
import { seatOf, type Seating } from './seats';
import type { KeywordsState } from './state';
import { viewFor } from './view';

// The AI players' part of the game (docs/games/keywords.md#ai-players): where an AI player may sit,
// what its seat is to do in each phase, and the messages that the agent's answer makes, which the
// rules judge as they judge anyone's. Whatever the agent is told comes from the seat's own view
// (view.ts), so an AI student knows no more of the key than a student does.

// What an AI player did in a game that finished, for its page (GameModule.agentFeats): the clues it
// gave as its group's PI, with how many of the group's cards were found in each of their turns, the
// clue that found the most, and how often it revealed Reviewer 2 as a student. The same is worked
// out again from the record of the game when the rules change (replay.ts).
export function featsOf(game: KeywordsState | null, playerId: string): KeywordsAgentFeats {
  const feats: KeywordsAgentFeats = { clues: 0, found: 0, reviewer2: 0, best: null };
  for (const record of game?.history ?? []) {
    if (record.captain === playerId && record.word !== null) {
      const found = record.guesses.filter(({ color }) => color === record.team).length;
      feats.clues += 1;
      feats.found += found;
      if (found > 0 && (feats.best === null || found > feats.best.found)) feats.best = { word: record.word, found };
    }
    feats.reviewer2 += record.guesses.filter(
      ({ player, color }) => player === playerId && color === 'reviewer2',
    ).length;
  }
  return feats;
}

// What an AI player did in all its seats, from what featsOf() gave for each, in the order the games
// ended, for its page (GameModule.agentTotals): the counts added up, and the earliest of the clues
// that found the most.
export function totalsOf(seats: readonly unknown[]): KeywordsAgentFeats {
  const totals: KeywordsAgentFeats = { clues: 0, found: 0, reviewer2: 0, best: null };
  for (const seat of seats as readonly KeywordsAgentFeats[]) {
    totals.clues += seat.clues;
    totals.found += seat.found;
    totals.reviewer2 += seat.reviewer2;
    if (seat.best !== null && (totals.best === null || seat.best.found > totals.best.found)) totals.best = seat.best;
  }
  return totals;
}

// How long an AI waits before its moves, in milliseconds, so that people can follow it: a PI gives
// the clue no sooner than this after the turn began, and a student reveals its first card no sooner
// than this after the clue, and the next ones this far apart. An AI student that advises people
// chooses its card at once.
export const CLUE_PACE_MS = 3_000;
export const GUESS_PACE_MS = 2_000;
export const STEP_PACE_MS = 1_500;

// Each group has at most one AI PI and one AI student.
export function agentLimitReached(seating: Seating, ctx: GameContext, playerId: string, team: string, role: string) {
  return [...seating.seats].some(
    ([id, seat]) => id !== playerId && seat.team === team && seat.role === role && ctx.agentOf(id) !== null,
  );
}

// Whether a person sits in a group: an AI player can be invited once one does, so that a room is
// never the AI players' alone.
export function personSeated(seating: Seating, ctx: GameContext): boolean {
  return [...seating.seats].some(([id, seat]) => seat.team !== null && ctx.agentOf(id) === null);
}

// What keeps a game with AI players from starting: a time limit missing for the clues or the
// guesses, which carry a game on when the agent is slow or gone, or no person in a group at all.
export function agentProblems(data: KeywordsData, ctx: GameContext): StartProblem[] {
  const seated = [...data.seating.seats].filter(([, seat]) => seat.team !== null).map(([id]) => id);
  if (!seated.some((id) => ctx.agentOf(id) !== null)) return [];
  const problems: StartProblem[] = [];
  const { firstClueTime, clueTime, guessTime } = data.settings;
  if (firstClueTime === 0 || clueTime === 0 || guessTime === 0) problems.push({ problem: 'needs_timers' });
  if (seated.every((id) => ctx.agentOf(id) !== null)) problems.push({ problem: 'needs_human' });
  return problems;
}

// The seat that the chair's message names for a new AI player, as the seat message reads one: a
// PI's or a student's in a group. A spectator's is none.
export function agentSeat(seat: unknown): { team: (typeof TEAMS)[number]; role: 'captain' | 'guesser' } | null {
  const parsed = KEYWORDS_MESSAGES['keywords:seat'].safeParse(seat);
  if (!parsed.success) return null;
  const { team, role } = parsed.data;
  return team !== null && role !== 'spectator' ? { team, role } : null;
}

// The seats of a practice room (docs/games/keywords.md#practice-rooms): its creator in the red group,
// as its PI or as a student, and AI players in the three other seats, the red group's other role
// first, so that a person sits in a group before any AI player does (needs_human).
export function practiceSeats(role: string): PracticeSeats | null {
  if (role !== 'captain' && role !== 'guesser') return null;
  const other = role === 'captain' ? 'guesser' : 'captain';
  return {
    seat: { type: 'keywords:seat', payload: { team: 'red', role } },
    agents: [
      { team: 'red', role: other },
      { team: 'blue', role: 'captain' },
      { team: 'blue', role: 'guesser' },
    ],
  };
}

// What a seat is to do now: the group's PI gives the clue in its turn, and a student plays the
// turn's guesses, or, while a person of the group is there as a student too, advises them. Nothing
// while the game is paused or over, or in the other group's turn. Who is there is as the context
// says: the driver of the AI players counts a person who has been offline for a short while as
// there still (server/src/core/agents.ts).
export function agentTask(data: KeywordsData, ctx: GameContext, playerId: string): AgentTask | null {
  const game = data.game;
  if (!game || game.phase === 'over' || game.pause) return null;
  const seat = seatOf(data.seating, playerId);
  if (seat.team === null || seat.team !== game.team) return null;
  const view = viewFor(game, seat, ctx.now());
  const base: AgentGame = {
    game: 'keywords',
    language: game.language,
    settings: { ...game.settings },
    team: seat.team,
    cards: view.cards,
    clues: view.history.flatMap(({ team, word, count }) =>
      word === null || count === null ? [] : [{ team, word, count }],
    ),
  };
  if (seat.role === 'captain' && game.phase === 'clue') {
    return {
      moment: `${game.gameId}:${game.turn}:clue`,
      kind: 'clue',
      question: { kind: 'clue', ...base },
      advice: false,
      pace: { first: CLUE_PACE_MS, step: 0 },
    };
  }
  if (seat.role !== 'guesser' || game.phase !== 'guess' || !game.clue) return null;
  const advice = ctx
    .playerIds()
    .some(
      (id) =>
        id !== playerId &&
        ctx.agentOf(id) === null &&
        ctx.isOnline(id) &&
        seatOf(data.seating, id).team === seat.team &&
        seatOf(data.seating, id).role === 'guesser',
    );
  return {
    // Whether the AI advises or plays is part of the moment: when the last person of the group goes
    // offline, or one comes back, the AI asks again for what it does now. The moment names no seat:
    // every student of the group would do the same, and the driver has one of them do it.
    moment: `${game.gameId}:${game.turn}:guess:${advice ? 'advise' : 'play'}`,
    kind: advice ? 'advise' : 'guess',
    question: { kind: 'guess', ...base, clue: { ...game.clue }, guessesLeft: view.guessesLeft },
    advice,
    pace: advice ? { first: 0, step: 0 } : { first: GUESS_PACE_MS, step: STEP_PACE_MS },
  };
}

// The next message of a task's answer, with the game as it is now:
//
// - A clue goes once, with the cards it is meant for.
// - A student that plays reveals the cards of the answer that are still face down, in order, and
//   then ends the turn, if the group has revealed a card in it; a wrong card ends the turn anyway.
// - A student that advises chooses the first card of the answer that is still face down, for the
//   group to see, and says why, once; when the group reveals that card, it chooses the next.
export function agentMove(
  data: KeywordsData,
  playerId: string,
  task: AgentTask,
  answer: AgentAnswer,
  made: readonly string[],
): AgentMove | null {
  const game = data.game;
  if (!game || game.phase === 'over') return null;
  const moment = { gameId: game.gameId, turn: game.turn };
  if (answer.kind === 'clue') {
    if (made.length > 0 || game.phase !== 'clue') return null;
    return {
      type: 'keywords:clue',
      payload: { ...moment, word: answer.word, count: answer.count, targets: [...answer.targets] },
    };
  }
  if (game.phase !== 'guess') return null;
  const next = answer.picks.find((card) => game.cards[card] && !game.cards[card].revealed);
  if (task.advice) {
    if (next === undefined) return null;
    const chosen = game.selections.find(({ player }) => player === playerId)?.card;
    if (chosen !== next) return { type: 'keywords:select', payload: { ...moment, card: next } };
    if (answer.reason && !made.includes('keywords:say')) {
      return { type: 'keywords:say', payload: { gameId: game.gameId, text: answer.reason } };
    }
    return null;
  }
  if (next !== undefined) return { type: 'keywords:reveal', payload: { ...moment, card: next } };
  if (game.guessesMade > 0 && made.at(-1) !== 'keywords:pass') return { type: 'keywords:pass', payload: moment };
  return null;
}
