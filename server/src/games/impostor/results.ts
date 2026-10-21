import {
  FATES,
  IMPOSTOR_ROLES,
  pointsOf,
  REASONS,
  type Fate,
  type ImpostorDetail,
  type ImpostorReason,
  type ImpostorResult,
  type ImpostorRole,
  type ImpostorSettings,
  type ReportVerdict,
} from '@reviewer2/shared/impostor';
import type { GameOutcome, MatchScore, PlayerResult } from '../../core/game';
import type { GameLogEntry } from '../../core/gameLog';
import type { ImpostorGame, WordSource } from './state';

// How a game of the hidden word game came out for each player (docs/games/impostor.md#points): their
// record and their points, counted from what happened in it, the same way for a game as it ends and
// for a kept game counted again from its log (recountOf in replay.ts), so that the two can't drift
// apart.

// How a game began, as its record keeps it (GameModule.setup): the settings; who played, by player
// ID, with their number and role; the two words, as the students and the Reviewer 2s had them;
// and where they came from. The AI players are in the log (GameLogData.agents).
export interface ImpostorSetup {
  settings: ImpostorSettings;
  players: { id: string; number: number; role: ImpostorRole }[];
  words: { student: string; reviewer2: string };
  source: WordSource;
}

// What happened in a game that the records count, as the game had it at its end or as its log
// tells it: every vote revealed, every description whose time ran out, how each player who went out
// did, every report settled, every guess of the students' word, whether the chair removed a player
// of the game, which brings nobody points (docs/games/impostor.md#leaving), and how it came out,
// in which round. The players are as the setup has them.
export interface Facts {
  players: ImpostorSetup['players'];
  ballots: { votes: Record<string, string | null | 'timeout'>; out: string | null }[];
  missed: string[];
  outs: Record<string, { fate: Fate; round: number }>;
  reports: { by: string; target: string; passed: boolean }[];
  guesses: { by: string; word: string | null; correct: boolean }[];
  removed: boolean;
  result: ImpostorResult | null;
  round: number;
}

export const setupOf = (game: ImpostorGame): ImpostorSetup => ({
  settings: { ...game.settings },
  players: game.players.map(({ id, number, role }) => ({ id, number, role })),
  words: { student: game.words.student.word, reviewer2: game.words.reviewer2.word },
  source: { ...game.source },
});

export function factsOf(game: ImpostorGame): Facts {
  const outs: Facts['outs'] = {};
  for (const player of game.players) {
    if (player.fate !== 'alive' && player.out !== null) outs[player.id] = { fate: player.fate, round: player.out };
  }
  return {
    players: setupOf(game).players,
    ballots: game.ballots.map(({ votes, out }) => ({ votes: { ...votes }, out })),
    missed: game.lines.filter((line) => line.text === null).map((line) => line.by),
    outs,
    reports: game.reports.map(({ by, target, passed }) => ({ by, target, passed: passed === true })),
    guesses: game.guesses.map((guess) => ({ ...guess })),
    removed: game.removed.length > 0,
    result: game.result,
    round: game.round,
  };
}

// How a game that ended by itself came out, for its record (GameModule.outcome): the side that won
// and how, or no side, with the reason, for a game that a Reviewer 2 left. Null for a game that has
// no result, as one that the chair withdrew.
export const outcomeOf = (result: ImpostorResult | null): GameOutcome | null =>
  result && { winner: result.winner, reason: result.reason };

// The entries that the game adds to its log of what happened (GameModule.logChanges), from which a
// kept game is counted again and watched again: a vote revealed, a description whose time ran out,
// a player who went out, a player of the game whom the chair removed, a report settled, a guess of
// the students' word, and the end.
export const LOGGED = {
  votes: 'impostor:votes',
  missed: 'impostor:missed',
  out: 'impostor:out',
  removed: 'impostor:removed',
  judged: 'impostor:judged',
  guessed: 'impostor:guessed',
  over: 'impostor:over',
} as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// What happened in a kept game, from its setup and its log, up to its end, or null when the log
// doesn't tell, as for a game that didn't finish or one of another shape.
export function factsFrom(setup: ImpostorSetup, entries: readonly GameLogEntry[]): Facts | null {
  const facts: Facts = {
    players: setup.players,
    ballots: [],
    missed: [],
    outs: {},
    reports: [],
    guesses: [],
    removed: false,
    result: null,
    round: 1,
  };
  for (const { type, data } of entries) {
    if (type === 'end') break;
    if (!isObject(data)) continue;
    if (type === LOGGED.votes && isObject(data.votes)) {
      facts.ballots.push({
        votes: data.votes as Facts['ballots'][number]['votes'],
        out: typeof data.out === 'string' ? data.out : null,
      });
    } else if (type === LOGGED.missed && typeof data.player === 'string') {
      facts.missed.push(data.player);
    } else if (type === LOGGED.out && typeof data.player === 'string' && FATES.includes(data.fate as Fate)) {
      facts.outs[data.player] = { fate: data.fate as Fate, round: Number(data.round) };
    } else if (type === LOGGED.removed && typeof data.player === 'string') {
      facts.removed = true;
    } else if (type === LOGGED.judged && typeof data.by === 'string' && typeof data.target === 'string') {
      facts.reports.push({ by: data.by, target: data.target, passed: data.passed === true });
    } else if (type === LOGGED.guessed && typeof data.player === 'string') {
      facts.guesses.push({
        by: data.player,
        word: typeof data.word === 'string' ? data.word : null,
        correct: data.correct === true,
      });
    } else if (type === LOGGED.over && REASONS.includes(data.reason as ImpostorReason)) {
      const winner = IMPOSTOR_ROLES.includes(data.winner as ImpostorRole) ? (data.winner as ImpostorRole) : null;
      facts.result = { winner, reason: data.reason as ImpostorReason };
      facts.round = Number(data.round);
    }
  }
  return facts.result === null ? null : facts;
}

// One player's part in the game, counted from what happened.
export function detailOf(facts: Facts, id: string): ImpostorDetail {
  const roles = new Map(facts.players.map((player) => [player.id, player.role]));
  const detail: ImpostorDetail = {
    out: facts.outs[id]?.round ?? null,
    rounds: facts.outs[id]?.round ?? facts.round,
    votes: 0,
    hits: 0,
    wrong: 0,
    abstained: 0,
    missedVotes: 0,
    missedLines: facts.missed.filter((by) => by === id).length,
    reported: facts.reports.filter((report) => report.target === id).length,
    reports: facts.reports.filter((report) => report.by === id).length,
    failedReports: facts.reports.filter((report) => report.by === id && !report.passed).length,
    comeback: null,
  };
  for (const { votes, out } of facts.ballots) {
    if (!Object.hasOwn(votes, id)) continue;
    const target = votes[id];
    if (target === null) detail.abstained += 1;
    else if (target === 'timeout') detail.missedVotes += 1;
    else if (target !== undefined) {
      detail.votes += 1;
      if (roles.get(target) !== 'student') detail.hits += 1;
      else if (target === out) detail.wrong += 1;
    }
  }
  const guess = facts.guesses.find((made) => made.by === id && made.word !== null);
  if (guess) detail.comeback = guess.correct ? 'right' : 'wrong';
  return detail;
}

const fateOf = (facts: Facts, id: string): Fate => facts.outs[id]?.fate ?? 'alive';

// The part of everyone still in a game that a side won at its end: the side is the role, and the
// players of the winning side win together, also those who went out; the winners have place 1
// and the others 2. Those who left have no record of it, as in every game. A game that a Reviewer
// 2 left, which nobody won, counts for no record.
export function resultsFrom(facts: Facts): PlayerResult[] | null {
  const winner = facts.result?.winner ?? null;
  if (winner === null) return null;
  return facts.players
    .filter(({ id }) => fateOf(facts, id) !== 'left')
    .map(({ id, role }) => {
      const won = role === winner;
      return {
        playerId: id,
        side: role,
        role,
        result: won ? ('won' as const) : ('lost' as const),
        place: won ? 1 : 2,
        verdict: fateOf(facts, id),
        detail: detailOf(facts, id),
      };
    });
}

// Everyone's points, by member key, with where they came from: as they stand while the game is on,
// with nobody winning yet, and at its end. A game that nobody won counts for none.
export function scoresFrom(facts: Facts, keyOf: (playerId: string) => string): MatchScore[] | null {
  if (facts.result !== null && facts.result.winner === null) return null;
  const winner = facts.result?.winner ?? null;
  return facts.players.map(({ id, role }) => {
    const fate = fateOf(facts, id);
    const detail = detailOf(facts, id);
    return { key: keyOf(id), points: pointsOf(role, role === winner && fate !== 'left', fate, detail), detail };
  });
}

// Whether the end of a game shows everyone's points, and its replay: for a game that a side won,
// but not for one that brings nobody points (GameModule.scoresNothing), as one in which the chair
// removed a player of the game, or one with AI players (`agents`), which the room decides by
// whether every answer came from a certified version of the AI, and none is yet
// (CERTIFIED_AGENTS in core/agentLog.ts), so that the page shows no points that nobody got.
export const pointsShown = (facts: Facts, agents: boolean): boolean =>
  facts.result !== null && facts.result.winner !== null && !facts.removed && !agents;

// The record of a game asks what the game says of a guess and a verdict, which the rules keep as
// they are; these are for the check of the data.
export const isVerdict = (value: unknown): value is ReportVerdict =>
  value === 'agree' || value === 'disagree' || value === 'abstain';
