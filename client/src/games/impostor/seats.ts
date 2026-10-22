import type {
  BallotView,
  ImpostorView,
  LineView,
  ReportView,
  ReportVerdict,
  SeatView,
} from '@reviewer2/shared/impostor';

// What the hidden word game's board and record show of each seat (docs/games/impostor.md), worked
// out from the game as the server sends it.

// How a seat stands now, as its card says it: out of the game, by a vote, for breaking the rules or
// by leaving; writing their line; done with it this round; waiting for their turn; during a vote,
// done with their vote or not; or, once the game is over, still in it at the end.
export type SeatState =
  'voted_out' | 'violation' | 'left' | 'writing' | 'said' | 'waiting' | 'voted' | 'voting' | 'lasted';

const VOTING = new Set(['vote', 'revote']);
const DESCRIBING = new Set(['describe', 'tie']);

export function seatState(game: ImpostorView, seat: SeatView): SeatState {
  if (seat.fate !== 'alive') return seat.fate;
  if (game.phase === 'over') return 'lasted';
  if (VOTING.has(game.phase)) {
    if (game.phase === 'revote' && game.tied.includes(seat.number)) return 'waiting';
    return game.voted.includes(seat.number) ? 'voted' : 'voting';
  }
  if (DESCRIBING.has(game.phase)) {
    if (game.speaker === seat.number) return 'writing';
    if (game.phase === 'tie' && !game.tied.includes(seat.number)) return 'waiting';
    return lineOf(game.lines, game.round, seat.number, game.phase === 'tie') ? 'said' : 'waiting';
  }
  return 'waiting';
}

// The line that a number wrote in a round: its first line, or the line it added as one of the
// players tied for the most votes.
export const lineOf = (lines: readonly LineView[], round: number, number: number, tie = false): LineView | undefined =>
  lines.find((line) => line.round === round && line.number === number && line.tie === tie);

// The line a seat's card shows: the newest that the number wrote in the round.
export const newestLine = (lines: readonly LineView[], round: number, number: number): LineView | undefined =>
  lineOf(lines, round, number, true) ?? lineOf(lines, round, number);

// One row of a revealed vote, or of the verdicts on a report: who was voted for, or which verdict it
// was, and the numbers who voted so, in order.
export interface VoteRow {
  number: number | null;
  voters: number[];
}

const byNumber = (a: number, b: number) => a - b;

// The rows of a revealed vote, as the record shows them (docs/games/impostor.md#voting): one for each
// player voted for, the most votes first and, among as many, the lower number first; then the
// abstentions, if any, and the votes that ran out of time, if any.
export function voteRows(ballot: BallotView): { rows: VoteRow[]; abstained: number[]; timedOut: number[] } {
  const voters = new Map<number, number[]>();
  const abstained: number[] = [];
  const timedOut: number[] = [];
  for (const [from, to] of Object.entries(ballot.votes)) {
    const voter = Number(from);
    if (to === 0) abstained.push(voter);
    else if (to === -1) timedOut.push(voter);
    else voters.set(to, [...(voters.get(to) ?? []), voter]);
  }
  const rows = [...voters.entries()]
    .map(([number, from]) => ({ number, voters: from.sort(byNumber) }))
    .sort((a, b) => b.voters.length - a.voters.length || (a.number as number) - (b.number as number));
  return { rows, abstained: abstained.sort(byNumber), timedOut: timedOut.sort(byNumber) };
}

// The verdicts on a report once it is over, by verdict, the numbers who gave each in order.
export function verdictRows(report: ReportView): Record<ReportVerdict, number[]> {
  const rows: Record<ReportVerdict, number[]> = { agree: [], disagree: [], abstain: [] };
  for (const [from, verdict] of Object.entries(report.verdicts ?? {})) rows[verdict].push(Number(from));
  for (const numbers of Object.values(rows)) numbers.sort(byNumber);
  return rows;
}

// How many agreements a report needs to pass: more than half of those who may judge it.
export const needed = (eligible: number): number => Math.floor(eligible / 2) + 1;

// The rounds of the game so far, the newest last, each with its lines, its votes and its reports.
export interface RoundRecord {
  round: number;
  lines: LineView[];
  ballots: BallotView[];
  reports: ReportView[];
}

export function roundsOf(
  game: Pick<ImpostorView, 'round' | 'lines' | 'ballots' | 'reports'>,
  rounds = game.round,
): RoundRecord[] {
  return Array.from({ length: rounds }, (_, index) => {
    const round = index + 1;
    return {
      round,
      lines: game.lines.filter((line) => line.round === round),
      ballots: game.ballots.filter((ballot) => ballot.round === round),
      reports: game.reports.filter((report) => report.round === round && report.passed !== null),
    };
  });
}

// Who was voted out in a round, if anyone: the number out on its last vote.
export const outIn = (record: RoundRecord): number | null =>
  record.ballots.reduce<number | null>((out, ballot) => ballot.out ?? out, null);
