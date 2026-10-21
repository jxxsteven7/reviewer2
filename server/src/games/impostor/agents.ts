import { MAX_AGENT_REQUEST, type AgentAnswer } from '@reviewer2/shared';
import type { ImpostorAgentGame, ImpostorStartProblem } from '@reviewer2/shared/impostor';
import type { AgentMove, AgentTask, GameContext, PracticeSeats } from '../../core/game';
import { playerOf, votersOf, wordOf } from './rules';
import type { ImpostorData, ImpostorGame } from './state';

// The AI players' part of the game (docs/games/impostor.md#ai-players): what an AI player is to do
// in each phase, and the message that the agent's answer makes, which the rules judge as they judge
// anyone's. The agent is told what the seat may see: its own number and word, and what everyone
// sees. An AI player describes, votes, judges reports and, when the room allows it, guesses the
// students' word after it was voted out; it never reports anyone and never talks off the field.
// Nobody else's seat is played by an AI: a person whose time runs out misses their turn.

// How long an AI waits before it describes, votes or judges, in milliseconds, so that people can
// follow it.
export const DESCRIBE_PACE_MS = 2_500;
export const VOTE_PACE_MS = 2_000;

// The players in a practice room besides its creator.
export const PRACTICE_AGENTS = 5;

// What keeps a game with AI players from starting: a time limit missing for the descriptions or
// the votes, which carry a game on when the agent is slow or gone, or no person playing.
export function agentProblems(
  data: ImpostorData,
  players: readonly string[],
  ctx: GameContext,
): ImpostorStartProblem[] {
  if (!players.some((id) => ctx.agentOf(id) !== null)) return [];
  const problems: ImpostorStartProblem[] = [];
  if (data.settings.describeTime === 0 || data.settings.voteTime === 0) problems.push({ problem: 'needs_timers' });
  if (players.every((id) => ctx.agentOf(id) !== null)) problems.push({ problem: 'needs_human' });
  return problems;
}

// A practice room (docs/architecture.md#practice-rooms): its creator plays, with five AI players, a
// game of six, which has a Reviewer 2 and a PI. The game has one role to choose, a player's.
export function practiceSeats(role: string): PracticeSeats | null {
  if (role !== 'player') return null;
  return {
    seat: { type: 'impostor:seat', payload: { play: true } },
    agents: Array.from({ length: PRACTICE_AGENTS }, () => null),
  };
}

// The agent takes a request of MAX_AGENT_REQUEST at most (agent/src/agent.ts), which the history of
// a game of many rounds would outgrow: the lines, the votes and the reports go to the agent from
// the newest round back, as many whole rounds as fit in the history's share of the request, which
// leaves the rest of it, the words and the seats, what it needs.
export const HISTORY_BYTES = MAX_AGENT_REQUEST - 8 * 1024;

function fitted(game: ImpostorAgentGame): ImpostorAgentGame {
  let kept = game;
  while (Buffer.byteLength(JSON.stringify(kept)) > HISTORY_BYTES) {
    const rounds = [...kept.lines, ...kept.ballots, ...kept.reports].map((entry) => entry.round);
    if (rounds.length === 0) break;
    const oldest = Math.min(...rounds);
    kept = {
      ...kept,
      lines: kept.lines.filter((line) => line.round > oldest),
      ballots: kept.ballots.filter((ballot) => ballot.round > oldest),
      reports: kept.reports.filter((report) => report.round > oldest),
    };
  }
  return kept;
}

// The game as the seat sees it, for the agent.
function agentGame(game: ImpostorGame, ctx: GameContext, playerId: string): ImpostorAgentGame {
  const me = playerOf(game, playerId);
  const number = new Map(game.players.map((player) => [player.id, player.number]));
  const of = (id: string) => number.get(id) ?? 0;
  const word = me ? wordOf(game, me.role) : null;
  return fitted({
    game: 'impostor',
    language: ctx.language,
    length: game.settings.length,
    number: me?.number ?? 0,
    word: word && {
      word: word.word,
      ...(word.translations?.length ? { translations: [...word.translations] } : {}),
      ...(word.forms?.length ? { forms: [...word.forms] } : {}),
      ...(word.pinyin === undefined ? {} : { pinyin: word.pinyin }),
    },
    round: game.round,
    seats: game.players.map((player) => ({
      number: player.number,
      fate: player.fate,
      role: player.fate === 'voted_out' || player.fate === 'violation' ? player.role : null,
    })),
    lines: game.lines.map((line) => ({ round: line.round, number: of(line.by), text: line.text, tie: line.tie })),
    ballots: game.ballots.map((ballot) => ({
      round: ballot.round,
      ballot: ballot.ballot,
      votes: Object.fromEntries(
        Object.entries(ballot.votes).map(([voter, target]) => [
          String(of(voter)),
          target === null ? 0 : target === 'timeout' ? -1 : of(target),
        ]),
      ),
      out: ballot.out === null ? null : of(ballot.out),
      tied: ballot.tied.map(of),
    })),
    reports: game.reports.map((report) => ({
      round: report.round,
      by: of(report.by),
      target: of(report.target),
      reason: report.reason,
      passed: report.passed,
    })),
  });
}

// What an AI player is to do now: judge the report that is open, if it may; describe its word in
// its turn; vote in a vote it has a say in; or guess the students' word after it was voted out.
// Each AI player does its own, so each moment names the seat.
export function agentTask(data: ImpostorData, ctx: GameContext, playerId: string): AgentTask | null {
  const game = data.game;
  if (!game || game.phase === 'over' || ctx.agentOf(playerId) === null) return null;
  const me = playerOf(game, playerId);
  if (!me) return null;
  const at = `${game.gameId}:${game.round}`;
  const task = (moment: string, kind: string, question: AgentTask['question'], first: number): AgentTask => ({
    moment: `${moment}:${playerId}`,
    kind,
    question,
    advice: false,
    pace: { first, step: 0 },
  });
  const base = agentGame(game, ctx, playerId);
  if (game.report) {
    const report = game.report;
    if (me.fate !== 'alive' || !report.eligible.includes(playerId) || Object.hasOwn(report.verdicts, playerId)) {
      return null;
    }
    const number = (id: string) => playerOf(game, id)?.number ?? 0;
    return task(
      `${at}:report:${game.reports.length}`,
      'judge',
      {
        kind: 'judge',
        ...base,
        report: { by: number(report.by), target: number(report.target), line: report.line, reason: report.reason },
      },
      VOTE_PACE_MS,
    );
  }
  if (game.phase === 'comeback') {
    return game.comeback === playerId
      ? task(`${at}:comeback`, 'comeback', { kind: 'comeback', ...base }, VOTE_PACE_MS)
      : null;
  }
  if (me.fate !== 'alive') return null;
  if ((game.phase === 'describe' || game.phase === 'tie') && game.speaker === playerId) {
    const tie = game.phase === 'tie';
    return task(`${at}:${game.phase}`, 'describe', { kind: 'describe', tie, ...base }, DESCRIBE_PACE_MS);
  }
  if ((game.phase === 'vote' || game.phase === 'revote') && !Object.hasOwn(game.pending, playerId)) {
    if (!votersOf(game).some((player) => player.id === playerId)) return null;
    const candidates = game.players
      .filter(
        (player) =>
          player.fate === 'alive' &&
          player.id !== playerId &&
          (game.phase !== 'revote' || game.tied.includes(player.id)),
      )
      .map((player) => player.number);
    return task(
      `${at}:${game.phase}:${game.ballots.length}`,
      'vote',
      { kind: 'vote', ...base, candidates },
      VOTE_PACE_MS,
    );
  }
  return null;
}

// The message that the agent's answer makes: one for each task.
export function agentMove(
  data: ImpostorData,
  task: AgentTask,
  answer: AgentAnswer,
  made: readonly string[],
): AgentMove | null {
  const game = data.game;
  if (!game || game.phase === 'over' || made.length > 0) return null;
  const { gameId, round } = game;
  if (answer.kind === 'describe' && task.kind === 'describe') {
    return { type: 'impostor:describe', payload: { gameId, round, text: answer.text } };
  }
  if (answer.kind === 'vote' && task.kind === 'vote') {
    return { type: 'impostor:vote', payload: { gameId, round, number: answer.number } };
  }
  if (answer.kind === 'judge' && task.kind === 'judge') {
    return { type: 'impostor:judge', payload: { gameId, verdict: answer.verdict } };
  }
  if (answer.kind === 'comeback' && task.kind === 'comeback') {
    return { type: 'impostor:comeback', payload: { gameId, word: answer.word } };
  }
  return null;
}
