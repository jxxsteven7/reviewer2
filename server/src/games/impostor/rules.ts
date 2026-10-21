import { cleanLine, type BoardWord } from '@reviewer2/shared';
import {
  checkDescription,
  checkReason,
  checkTalk,
  COMEBACK_SECONDS,
  guessesWord,
  REPORT_SECONDS,
  roleCounts,
  survivors,
  type ImpostorResult,
  type ImpostorRole,
  type ImpostorSettings,
  type ReportVerdict,
} from '@reviewer2/shared/impostor';
import { shuffle, type Rng } from '../../core/random';
import type { Ballot, Clock, GamePlayer, ImpostorGame, Report, WordSource } from './state';

// The rules of the hidden word game (docs/games/impostor.md), as pure functions of its state: each
// action gives the new state, or the state as it was when it changed nothing, or a refusal with
// one of the game's codes.

export type Outcome = { ok: true; game: ImpostorGame } | { ok: false; error: string };

const refuse = (error: string): Outcome => ({ ok: false, error });
const changed = (game: ImpostorGame): Outcome => ({ ok: true, game });

export const living = (game: ImpostorGame): GamePlayer[] => game.players.filter((player) => player.fate === 'alive');
export const playerOf = (game: ImpostorGame, id: string): GamePlayer | undefined =>
  game.players.find((player) => player.id === id);
export const numbered = (game: ImpostorGame, number: number): GamePlayer | undefined =>
  game.players.find((player) => player.number === number);
const isAlive = (game: ImpostorGame, id: string) => playerOf(game, id)?.fate === 'alive';

// The word a player has: the students' or the Reviewer 2s', or none for the PI.
export function wordOf(game: ImpostorGame, role: ImpostorRole): BoardWord | null {
  if (role === 'pi') return null;
  return game.words[role];
}

const clockOf = (seconds: number, now: number): Clock | null =>
  seconds > 0 ? { ends: now + seconds * 1000, length: seconds * 1000 } : null;

// A new game: everyone who plays gets a number and a role at random (roleCounts), and the students
// get one of the two words, also at random, and the Reviewer 2s the other. `source` says where the
// words came from, once it is known which went to the students.
export function newGame(
  options: {
    gameId: string;
    settings: ImpostorSettings;
    players: readonly { id: string; agent: boolean }[];
    words: readonly [BoardWord, BoardWord];
    source: (student: BoardWord, reviewer2: BoardWord) => WordSource;
  },
  rng: Rng,
  now: number,
): ImpostorGame {
  const { players, settings } = options;
  const counts = roleCounts(players.length, settings.pi);
  const dealt = shuffle(players, rng);
  const roleAt = (index: number): ImpostorRole =>
    index < counts.reviewer2 ? 'reviewer2' : index < counts.reviewer2 + counts.pi ? 'pi' : 'student';
  const numbers = shuffle(
    Array.from({ length: players.length }, (_, index) => index + 1),
    rng,
  );
  const seated: GamePlayer[] = dealt
    .map((player, index) => ({
      id: player.id,
      number: numbers[index] as number,
      role: roleAt(index),
      agent: player.agent,
      fate: 'alive' as const,
      out: null,
    }))
    .sort((a, b) => a.number - b.number);
  const [first, second] = options.words;
  const [student, reviewer2] = rng.int(2) === 0 ? [first, second] : [second, first];
  const game: ImpostorGame = {
    gameId: options.gameId,
    settings: { ...settings },
    players: seated,
    words: { student, reviewer2 },
    source: options.source(student, reviewer2),
    round: 1,
    phase: 'describe',
    speaker: null,
    lines: [],
    ballots: [],
    pending: {},
    tied: [],
    report: null,
    reports: [],
    comeback: null,
    guesses: [],
    clock: null,
    paused: null,
    result: null,
    removed: false,
    agentGuesses: {},
    talk: [],
  };
  return nextSpeaker(game, now);
}

// Who still describes in this phase, in the order of their numbers: in the describe phase,
// everyone in the game who has no line in this round; in the tie phase, the tied players who have
// added none.
function speakersLeft(game: ImpostorGame): GamePlayer[] {
  const wrote = new Set(
    game.lines
      .filter((line) => line.round === game.round && line.tie === (game.phase === 'tie'))
      .map((line) => line.by),
  );
  const writers = game.phase === 'tie' ? living(game).filter((player) => game.tied.includes(player.id)) : living(game);
  return writers.filter((player) => !wrote.has(player.id));
}

// The next player describes, or, when everyone has, the vote begins: everyone in the game votes
// after the descriptions, and those who aren't tied vote again after the tied players' lines.
function nextSpeaker(game: ImpostorGame, now: number): ImpostorGame {
  const next = speakersLeft(game)[0];
  if (next) return { ...game, speaker: next.id, clock: clockOf(game.settings.describeTime, now) };
  const voting = { ...game, speaker: null, pending: {}, clock: clockOf(game.settings.voteTime, now) };
  if (game.phase === 'tie') {
    const revote: ImpostorGame = { ...voting, phase: 'revote' };
    return votersOf(revote).length > 0 ? revote : reveal(revote, now);
  }
  return { ...voting, phase: 'vote' };
}

// Who votes in the vote being held: everyone in the game, or in a revote everyone but the tied.
export const votersOf = (game: ImpostorGame): GamePlayer[] =>
  living(game).filter((player) => game.phase !== 'revote' || !game.tied.includes(player.id));

// Whom one may vote for: anyone else in the game, or in a revote one of the tied.
export const candidatesOf = (game: ImpostorGame, voter: string | null): GamePlayer[] =>
  living(game).filter((player) => player.id !== voter && (game.phase !== 'revote' || game.tied.includes(player.id)));

// A new round, after a vote that put nobody out or after someone went out and the game goes on.
function nextRound(game: ImpostorGame, now: number): ImpostorGame {
  return nextSpeaker({ ...game, round: game.round + 1, phase: 'describe', tied: [], pending: {}, comeback: null }, now);
}

// How the game has come out, if it has, with these players in it: no Reviewer 2 left, and the PI
// wins if still in it, the students otherwise; or no more than a few left with a Reviewer 2 among
// them (survivors()), who wins.
export function winnerOf(game: ImpostorGame): ImpostorResult | null {
  const left = living(game);
  if (!left.some((player) => player.role === 'reviewer2')) {
    return left.some((player) => player.role === 'pi')
      ? { winner: 'pi', reason: 'pi_survived' }
      : { winner: 'student', reason: 'caught' };
  }
  return left.length <= survivors(game.players.length) ? { winner: 'reviewer2', reason: 'survived' } : null;
}

const over = (game: ImpostorGame, result: ImpostorResult): ImpostorGame => ({
  ...game,
  phase: 'over',
  result,
  speaker: null,
  clock: null,
  paused: null,
  report: null,
  comeback: null,
  pending: {},
  tied: [],
});

// The game ends if it has come out, and otherwise goes on with `next`.
const endOr = (game: ImpostorGame, next: (game: ImpostorGame) => ImpostorGame): ImpostorGame => {
  const result = winnerOf(game);
  return result ? over(game, result) : next(game);
};

const putOut = (game: ImpostorGame, id: string, fate: GamePlayer['fate']): ImpostorGame => ({
  ...game,
  players: game.players.map((player) =>
    player.id === id && player.fate === 'alive' ? { ...player, fate, out: game.round } : player,
  ),
});

// The vote is revealed, once everyone has voted or their time has run out: whoever has the most
// votes, alone, goes out; players tied for the most add a line each and the others vote again
// among them, once; after a revote that is tied again, or a vote for nobody, nobody goes out. A
// Reviewer 2 or a PI who goes out may then guess the students' word, if the room allows it.
function reveal(game: ImpostorGame, now: number): ImpostorGame {
  const voters = votersOf(game);
  const votes: Ballot['votes'] = {};
  for (const voter of voters)
    votes[voter.id] = Object.hasOwn(game.pending, voter.id) ? (game.pending[voter.id] ?? null) : 'timeout';
  const tally = new Map<string, number>();
  for (const target of Object.values(votes)) {
    if (target !== null && target !== 'timeout') tally.set(target, (tally.get(target) ?? 0) + 1);
  }
  const most = Math.max(0, ...tally.values());
  const leaders = game.players.filter((player) => most > 0 && tally.get(player.id) === most).map((player) => player.id);
  const ballot = game.phase === 'revote' ? 'revote' : 'vote';
  const out = leaders.length === 1 ? (leaders[0] as string) : null;
  const tied = leaders.length > 1 ? leaders : [];
  const counted: ImpostorGame = {
    ...game,
    ballots: [...game.ballots, { round: game.round, ballot, votes, out, tied }],
    pending: {},
    clock: null,
  };
  if (out !== null) {
    const after = putOut(counted, out, 'voted_out');
    const role = playerOf(after, out)?.role;
    if (after.settings.comeback && role !== 'student') {
      return {
        ...after,
        phase: 'comeback',
        comeback: out,
        speaker: null,
        tied: [],
        clock: clockOf(COMEBACK_SECONDS, now),
      };
    }
    return endOr(after, (next) => nextRound(next, now));
  }
  if (ballot === 'vote' && tied.length > 0) {
    return nextSpeaker({ ...counted, phase: 'tie', tied }, now);
  }
  return nextRound(counted, now);
}

// Every action in a round names the game and the round it was meant for.
function moment(game: ImpostorGame, gameId: string, round: number | null): string | null {
  if (gameId !== game.gameId) return 'stale';
  if (game.phase === 'over') return 'game_over';
  if (round !== null && round !== game.round) return 'stale';
  return null;
}

const PROBLEM_ERRORS: Record<string, string> = {
  line_empty: 'line_empty',
  line_too_long: 'line_too_long',
  line_has_word: 'line_has_word',
  line_repeated: 'line_repeated',
};

// A player describes their word, in their turn: a line that the checks take (checkDescription).
export function describe(
  game: ImpostorGame,
  playerId: string,
  message: { gameId: string; round: number; text: string },
  now: number,
): Outcome {
  const stale = moment(game, message.gameId, message.round);
  if (stale) return refuse(stale);
  if (game.report) return refuse('report_open');
  if (game.phase !== 'describe' && game.phase !== 'tie') return refuse('wrong_phase');
  const player = playerOf(game, playerId);
  if (!player || player.fate !== 'alive') return refuse('not_playing');
  if (game.speaker !== playerId) return refuse('not_speaker');
  const earlier = game.lines.flatMap((line) => (line.text === null ? [] : [line.text]));
  const check = checkDescription(message.text, wordOf(game, player.role), earlier, game.settings.length);
  if (check.problem) return refuse(PROBLEM_ERRORS[check.problem] ?? 'bad_request');
  const line = { round: game.round, by: playerId, text: check.text, tie: game.phase === 'tie' };
  return changed(nextSpeaker({ ...game, lines: [...game.lines, line] }, now));
}

// A player votes for a number, or abstains with null, once a vote: for anyone else in the game, or
// in a revote for one of the tied, who don't vote in it. Once everyone has voted, the votes are
// revealed.
export function vote(
  game: ImpostorGame,
  playerId: string,
  message: { gameId: string; round: number; number: number | null },
  now: number,
): Outcome {
  const stale = moment(game, message.gameId, message.round);
  if (stale) return refuse(stale);
  if (game.report) return refuse('report_open');
  if (game.phase !== 'vote' && game.phase !== 'revote') return refuse('wrong_phase');
  if (!votersOf(game).some((player) => player.id === playerId)) return refuse('not_playing');
  if (Object.hasOwn(game.pending, playerId)) return refuse('voted_already');
  let target: string | null = null;
  if (message.number !== null) {
    const chosen = numbered(game, message.number);
    if (!chosen || !candidatesOf(game, playerId).some((player) => player.id === chosen.id)) return refuse('bad_vote');
    target = chosen.id;
  }
  const pending = { ...game.pending, [playerId]: target };
  const next = { ...game, pending };
  return changed(votersOf(next).every((player) => Object.hasOwn(pending, player.id)) ? reveal(next, now) : next);
}

// A player in the game reports another for breaking the rules (docs/games/impostor.md#reports): with
// one of their lines or none, and a reason, which gives nothing of the reporter's own word away.
// One report a round each, and one at a time. The clock stands still while everyone else in the
// game judges it.
export function report(
  game: ImpostorGame,
  playerId: string,
  message: { gameId: string; round: number; number: number; line: number | null; reason: string },
  now: number,
): Outcome {
  const stale = moment(game, message.gameId, message.round);
  if (stale) return refuse(stale);
  if (game.phase === 'comeback') return refuse('wrong_phase');
  if (game.report) return refuse('report_open');
  const reporter = playerOf(game, playerId);
  if (!reporter || reporter.fate !== 'alive') return refuse('not_playing');
  if (game.reports.some((past) => past.round === game.round && past.by === playerId)) {
    return refuse('reported_already');
  }
  const target = numbered(game, message.number);
  if (!target || target.fate !== 'alive' || target.id === playerId) return refuse('bad_report');
  if (message.line !== null) {
    const line = game.lines[message.line];
    if (!line || line.by !== target.id || line.text === null) return refuse('bad_report');
  }
  const check = checkReason(message.reason, wordOf(game, reporter.role));
  if (check.problem) return refuse(PROBLEM_ERRORS[check.problem] ?? 'bad_request');
  const opened: Report = {
    round: game.round,
    by: playerId,
    target: target.id,
    line: message.line,
    reason: check.text,
    eligible: living(game)
      .filter((player) => player.id !== target.id)
      .map((player) => player.id),
    verdicts: {},
    ends: now + REPORT_SECONDS * 1000,
    passed: null,
  };
  const paused = game.clock
    ? { left: Math.max(0, game.clock.ends - now), length: game.clock.length }
    : { left: null, length: 0 };
  return changed({ ...game, report: opened, clock: null, paused });
}

// A player who may judge the report says whether they agree that the reported player broke the
// rules, once. Once everyone has, the report is settled.
export function judge(
  game: ImpostorGame,
  playerId: string,
  message: { gameId: string; verdict: ReportVerdict },
  now: number,
): Outcome {
  const stale = moment(game, message.gameId, null);
  if (stale) return refuse(stale);
  const open = game.report;
  if (!open) return refuse('wrong_phase');
  if (!open.eligible.includes(playerId) || !isAlive(game, playerId)) return refuse('cannot_judge');
  if (Object.hasOwn(open.verdicts, playerId)) return refuse('judged_already');
  const verdicts = { ...open.verdicts, [playerId]: message.verdict };
  const next = { ...game, report: { ...open, verdicts } };
  return changed(judgedBy(next).every((id) => Object.hasOwn(verdicts, id)) ? settle(next, now) : next);
}

// Who may still judge the open report: those who could when it was made and are still in the game.
const judgedBy = (game: ImpostorGame): string[] => game.report?.eligible.filter((id) => isAlive(game, id)) ?? [];

// A report is settled, once everyone has judged it or the time has run out, those who didn't
// counting as abstaining: it passes when more than half of those who could judge it agree, and the
// reported player goes out for breaking the rules. Then the round goes on: the clock again, from
// where it stood, or, when the reported player was the one describing, with the next one; and
// during a vote, a vote from the start, without the player.
function settle(game: ImpostorGame, now: number): ImpostorGame {
  const open = game.report as Report;
  const verdicts: Record<string, ReportVerdict> = {};
  for (const id of open.eligible) verdicts[id] = open.verdicts[id] ?? 'abstain';
  const agree = Object.values(verdicts).filter((verdict) => verdict === 'agree').length;
  const passed = agree > open.eligible.length / 2;
  const settled: Report = { ...open, verdicts, passed };
  const resumed = game.paused;
  let next: ImpostorGame = { ...game, report: null, reports: [...game.reports, settled], paused: null };
  if (!passed || !isAlive(next, open.target)) {
    return {
      ...next,
      clock: resumed?.left === null || !resumed ? null : { ends: now + resumed.left, length: resumed.length },
    };
  }
  next = putOut(next, open.target, 'violation');
  return endOr(next, (going) => {
    if (going.phase === 'describe') {
      if (going.speaker === open.target) return nextSpeaker({ ...going, speaker: null }, now);
      return {
        ...going,
        clock: resumed?.left === null || !resumed ? null : { ends: now + resumed.left, length: resumed.length },
      };
    }
    return nextSpeaker({ ...going, phase: 'describe', speaker: null, tied: [], pending: {} }, now);
  });
}

// A Reviewer 2 or a PI who was voted out guesses the students' word, or makes no guess with null:
// the right word wins the game for their side.
export function guess(
  game: ImpostorGame,
  playerId: string,
  message: { gameId: string; word: string | null },
  now: number,
): Outcome {
  const stale = moment(game, message.gameId, null);
  if (stale) return refuse(stale);
  if (game.phase !== 'comeback' || game.comeback !== playerId) return refuse('no_comeback');
  return changed(guessed(game, message.word === null ? null : cleanLine(message.word), now));
}

function guessed(game: ImpostorGame, word: string | null, now: number): ImpostorGame {
  const by = game.comeback as string;
  const correct = word !== null && guessesWord(word, game.words.student);
  const role = playerOf(game, by)?.role as ImpostorRole;
  const next = { ...game, guesses: [...game.guesses, { by, word, correct }], comeback: null, clock: null };
  if (correct) return over(next, { winner: role, reason: 'comeback' });
  return endOr(next, (going) => nextRound(going, now));
}

// Whoever is out, watches or set the words talks off the field while the game is on; after it,
// anyone in the room talks it over. What they write names neither word (checkTalk).
export function talk(
  game: ImpostorGame,
  playerId: string,
  message: { gameId: string; text: string },
  offField: boolean,
): Outcome {
  if (message.gameId !== game.gameId) return refuse('stale');
  const after = game.phase === 'over';
  if (!after && !offField) return refuse('cannot_talk');
  const check = checkTalk(message.text, [game.words.student, game.words.reviewer2]);
  if (check.problem) return refuse(check.problem);
  return changed({ ...game, talk: [...game.talk, { by: playerId, text: check.text, after }] });
}

// What is due by now: a report whose time is up is settled; otherwise, once the phase's clock has
// run out, the line of the player describing is missed, the vote is revealed with the missing
// votes as such, or the guess is not made.
export function expire(game: ImpostorGame, now: number): ImpostorGame {
  if (game.phase === 'over') return game;
  if (game.report) return now >= game.report.ends ? settle(game, now) : game;
  if (!game.clock || now < game.clock.ends) return game;
  switch (game.phase) {
    case 'describe':
    case 'tie': {
      if (game.speaker === null) return game;
      const line = { round: game.round, by: game.speaker, text: null, tie: game.phase === 'tie' };
      return nextSpeaker({ ...game, lines: [...game.lines, line] }, now);
    }
    case 'vote':
    case 'revote':
      return reveal(game, now);
    case 'comeback':
      return guessed(game, null, now);
  }
}

// When the game next has something to do by itself.
export const deadlineOf = (game: ImpostorGame | null): number | null =>
  !game || game.phase === 'over' ? null : (game.report?.ends ?? game.clock?.ends ?? null);

// A player leaves the room during the game, or the chair removes them. A Reviewer 2 still in the
// game takes it with them: it ends with no winner, and every role is shown. Anyone else is out of
// it, and it goes on without them: as if their line had been written, their vote cast, their
// verdict given or their guess made, and a report of them dropped.
export function leave(game: ImpostorGame, playerId: string, removed: boolean, now: number): ImpostorGame {
  const player = playerOf(game, playerId);
  if (game.phase === 'comeback' && game.comeback === playerId) return guessed(game, null, now);
  if (game.phase === 'over' || !player || player.fate !== 'alive') return game;
  let next: ImpostorGame = { ...putOut(game, playerId, 'left'), removed: game.removed || removed };
  if (player.role === 'reviewer2') return over(next, { winner: null, reason: 'reviewer2_left' });
  const pending = { ...next.pending };
  delete pending[playerId];
  next = { ...next, pending, tied: next.tied.filter((id) => id !== playerId) };
  if (next.report?.target === playerId) {
    const resumed = next.paused;
    next = {
      ...next,
      report: null,
      paused: null,
      clock: resumed?.left === null || !resumed ? null : { ends: now + resumed.left, length: resumed.length },
    };
  }
  const result = winnerOf(next);
  if (result) return over(next, result);
  if (next.report) {
    return judgedBy(next).every((id) => Object.hasOwn(next.report?.verdicts ?? {}, id)) ? settle(next, now) : next;
  }
  switch (next.phase) {
    case 'describe':
    case 'tie':
      return next.speaker === playerId ? nextSpeaker({ ...next, speaker: null }, now) : next;
    case 'vote':
    case 'revote': {
      if (next.phase === 'revote' && next.tied.length < 2) return nextRound(next, now);
      return votersOf(next).every((voter) => Object.hasOwn(next.pending, voter.id)) ? reveal(next, now) : next;
    }
    default:
      return next;
  }
}

// After an anonymous game with AI players and at least 3 people, a person who played in it
// guesses which numbers the AI players had, as many as there were at most, or skips with null. In
// a game that showed everyone's name there is nothing to guess.
export const AGENT_GUESS_PEOPLE = 3;

export function agentGuessOpen(game: ImpostorGame): boolean {
  const agents = game.players.filter((player) => player.agent).length;
  return (
    game.phase === 'over' && game.settings.anonymous && agents > 0 && game.players.length - agents >= AGENT_GUESS_PEOPLE
  );
}

export function guessAgents(
  game: ImpostorGame,
  playerId: string,
  value: unknown,
): Outcome & { guess?: number[] | null } {
  if (!agentGuessOpen(game)) return refuse('cannot_guess');
  const player = playerOf(game, playerId);
  if (!player || player.agent || Object.hasOwn(game.agentGuesses, playerId)) return refuse('cannot_guess');
  const agents = game.players.filter((other) => other.agent).length;
  let guess: number[] | null = null;
  if (value !== null) {
    if (!Array.isArray(value) || value.length < 1 || value.length > agents) return refuse('bad_request');
    const numbers = new Set<number>();
    for (const number of value) {
      if (!Number.isInteger(number) || !numbered(game, number as number) || numbers.has(number as number)) {
        return refuse('bad_request');
      }
      numbers.add(number as number);
    }
    guess = [...numbers].sort((a, b) => a - b);
  }
  return { ok: true, game: { ...game, agentGuesses: { ...game.agentGuesses, [playerId]: guess } }, guess };
}
