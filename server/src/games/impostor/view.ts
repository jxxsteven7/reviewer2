import {
  REPORT_SECONDS,
  type BallotView,
  type ImpostorView,
  type OffFieldLine,
  type ReportView,
  type SeatView,
} from '@reviewer2/shared/impostor';
import type { Viewer } from '../../core/game';
import { factsOf, pointsShown, scoresFrom } from './results';
import { agentGuessOpen, candidatesOf, judgedBy, playerOf, reportedThisRound, votersOf } from './rules';
import type { ImpostorGame, Report } from './state';

// What each viewer sees of a game (docs/games/impostor.md#who-sees-what). Only the server knows the
// roles while the game is on. A player sees their own number and word, and their role once they are
// out; everyone sees the lines, the votes once they are revealed, the reports, and the role of
// whoever is out, never their word. In an anonymous game nobody but the player knows whose number
// is whose until the game ends. The setter sees both words, without knowing who has which.
// Whoever is out, watches or set the words has the off-field chat; a Reviewer 2 or a PI who was
// voted out joins it once they have guessed the students' word, if the room lets them guess. With
// the god view, those who only watch see every role and both words. After a game with AI players
// and at least 3 people, a person who played in it sees whose number was whose, and which were AI
// players, and the talk after the game, once they have guessed which they were, or skipped.

// Who the viewer is to the game.
export interface Watcher {
  id: string | null;
  screen: boolean;
  setter: boolean;
  godView: boolean;
}

export function watcherOf(viewer: Viewer, setterId: string | null, godView: boolean, game: ImpostorGame): Watcher {
  if (!('playerId' in viewer)) return { id: null, screen: true, setter: false, godView: false };
  const id = viewer.playerId;
  const setter = id === setterId;
  const plays = playerOf(game, id) !== undefined;
  return { id, screen: false, setter, godView: godView && !plays && !setter };
}

const numberOf = (game: ImpostorGame) => {
  const numbers = new Map(game.players.map((player) => [player.id, player.number]));
  return (id: string) => numbers.get(id) ?? 0;
};

// A report as everyone sees it. While it is judged, those who may judge it are those still in the
// game of those who could when it was made, and the verdicts so far theirs; once it is settled,
// they are those who could still judge it then (settle() in rules.ts).
function reportView(game: ImpostorGame, report: Report, watcher: Watcher, open: boolean): ReportView {
  const number = numberOf(game);
  const verdicts = open
    ? null
    : Object.fromEntries(Object.entries(report.verdicts).map(([id, verdict]) => [number(id), verdict]));
  const judges = open ? judgedBy(game) : report.eligible;
  return {
    round: report.round,
    by: number(report.by),
    target: number(report.target),
    line: report.line,
    reason: report.reason,
    eligible: judges.length,
    judged: judges.filter((id) => Object.hasOwn(report.verdicts, id)).length,
    mine: watcher.id === null ? null : (report.verdicts[watcher.id] ?? null),
    mayJudge:
      open &&
      watcher.id !== null &&
      report.eligible.includes(watcher.id) &&
      playerOf(game, watcher.id)?.fate === 'alive' &&
      !Object.hasOwn(report.verdicts, watcher.id),
    verdicts,
    passed: report.passed,
  };
}

// Whether a person who played in a game with AI players still has to guess which they were, before
// they see whose number was whose.
const guessing = (game: ImpostorGame, id: string | null): boolean => {
  if (id === null || !agentGuessOpen(game)) return false;
  const player = playerOf(game, id);
  return player !== undefined && !player.agent && !Object.hasOwn(game.agentGuesses, id);
};

// Whether the viewer may take part in the off-field chat now: whoever is out, but a Reviewer 2 or a
// PI whose guess of the students' word is due, watches or set the words, while the game is on;
// after it, everyone who has seen it all.
export function offField(game: ImpostorGame, watcher: Watcher): boolean {
  if (watcher.screen) return false;
  if (game.phase === 'over') return !guessing(game, watcher.id);
  const player = watcher.id === null ? undefined : playerOf(game, watcher.id);
  if (!player) return true;
  if (player.fate === 'alive') return false;
  return game.comeback !== player.id;
}

export function viewOf(game: ImpostorGame, watcher: Watcher, at: number): ImpostorView {
  const number = numberOf(game);
  const over = game.phase === 'over';
  const me = watcher.id === null ? undefined : playerOf(game, watcher.id);
  const revealed = over && !guessing(game, watcher.id);
  const allRoles = over || watcher.godView;
  const seats: SeatView[] = game.players.map((player) => {
    const own = player.id === watcher.id;
    const named = !game.settings.anonymous || revealed || watcher.godView || own;
    return {
      number: player.number,
      fate: player.fate,
      out: player.out,
      // Everyone learns the role of whoever is voted out or goes out for breaking the rules; the
      // role of one who left the room is shown at the end.
      role:
        allRoles || player.fate === 'voted_out' || player.fate === 'violation' || (own && player.fate !== 'alive')
          ? player.role
          : null,
      playerId: named ? player.id : null,
      agent: revealed || watcher.godView ? player.agent : null,
    };
  });
  const ballots: BallotView[] = game.ballots.map((ballot) => ({
    round: ballot.round,
    ballot: ballot.ballot,
    votes: Object.fromEntries(
      Object.entries(ballot.votes).map(([voter, target]) => [
        number(voter),
        target === null ? 0 : target === 'timeout' ? -1 : number(target),
      ]),
    ),
    out: ballot.out === null ? null : number(ballot.out),
    tied: ballot.tied.map(number),
  }));
  const voting = game.phase === 'vote' || game.phase === 'revote';
  const voter = me && voting && votersOf(game).some((player) => player.id === me.id);
  const talking = offField(game, watcher);
  const offFieldLines: OffFieldLine[] | null = talking
    ? game.talk.map((line) => {
        const player = playerOf(game, line.by);
        const named = !player || !game.settings.anonymous || revealed;
        return {
          number: player ? player.number : null,
          playerId: named ? line.by : null,
          text: line.text,
          after: line.after,
        };
      })
    : null;
  const clock = game.report
    ? { left: Math.max(0, game.report.ends - at), total: REPORT_SECONDS * 1000 }
    : game.clock
      ? { left: Math.max(0, game.clock.ends - at), total: game.clock.length }
      : null;
  const agents = game.players.filter((player) => player.agent).length;
  // The points show at the end of a game that a side won, but not of one that brought nobody any.
  const facts = factsOf(game);
  const scores = over && pointsShown(facts, agents > 0) ? scoresFrom(facts, (id) => id) : null;
  return {
    gameId: game.gameId,
    round: game.round,
    phase: game.phase,
    players: game.players.length,
    you: me
      ? {
          number: me.number,
          role: over || me.fate !== 'alive' ? me.role : null,
          word: me.role === 'pi' ? null : game.words[me.role].word,
        }
      : null,
    setterWords: watcher.setter
      ? [game.words.student.word, game.words.reviewer2.word].sort((a, b) => a.localeCompare(b))
      : null,
    setter: game.source.kind === 'setter' ? game.source.setter : null,
    seats,
    speaker: game.speaker === null ? null : number(game.speaker),
    clock,
    lines: game.lines.map((line) => ({ round: line.round, number: number(line.by), text: line.text, tie: line.tie })),
    ballots,
    voted: voting ? Object.keys(game.pending).map(number) : [],
    myVote:
      me && voting && Object.hasOwn(game.pending, me.id)
        ? game.pending[me.id]
          ? number(game.pending[me.id] as string)
          : null
        : undefined,
    candidates: voting ? candidatesOf(game, voter ? (me?.id ?? null) : null).map((player) => player.number) : [],
    tied: game.tied.map(number),
    report: game.report ? reportView(game, game.report, watcher, true) : null,
    reports: game.reports.map((report) => reportView(game, report, watcher, false)),
    reported: me !== undefined && reportedThisRound(game, me.id),
    comeback: game.comeback === null ? null : number(game.comeback),
    guesses: game.guesses.map((guess) => ({ number: number(guess.by), correct: guess.correct })),
    result: game.result,
    words: allRoles ? { student: game.words.student.word, reviewer2: game.words.reviewer2.word } : null,
    revealed,
    guess:
      agentGuessOpen(game) && me && !me.agent
        ? { agents, guess: Object.hasOwn(game.agentGuesses, me.id) ? (game.agentGuesses[me.id] ?? null) : undefined }
        : null,
    points: scores ? scores.map((score) => ({ number: number(score.key), points: score.points })) : null,
    offField: offFieldLines,
    mayTalk: talking,
  };
}
