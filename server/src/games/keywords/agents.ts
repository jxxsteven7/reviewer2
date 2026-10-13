import { TEAMS, type AgentAnswer, type AgentGame, type StartProblem } from '@reviewer2/shared';
import { KEYWORDS_MESSAGES } from '@reviewer2/shared/schemas';
import type { AgentMove, AgentTask, GameContext } from '../../core/game';
import type { KeywordsData } from './index';
import { seatOf, type Seating } from './seats';
import { viewFor } from './view';

// The AI players' part of the game (docs/games/keywords.md#ai-players): where an AI player may sit,
// what its seat is to do in each phase, and the messages that the agent's answer makes, which the
// rules judge as they judge anyone's. Whatever the agent is told comes from the seat's own view
// (view.ts), so an AI student knows no more of the key than a student does.

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

// What a seat is to do now: the group's PI gives the clue in its turn, and a student plays the
// turn's guesses, or, while a person of the group is there as a student too, advises them. Nothing
// while the game is paused or over, or in the other group's turn.
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
    // offline, or one comes back, the AI asks again for what it does now.
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
