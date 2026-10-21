import type { BallotView, ReportView } from '@reviewer2/shared/impostor';
import type { Row } from './VoteRows.vue';
import { needed, verdictRows, voteRows } from './seats';

type Translate = (key: string, named?: Record<string, unknown>, plural?: number) => string;

// The rows of a revealed vote (VoteRows.vue): the players voted for, the most votes first, the one
// voted out marked, then the abstentions, a row of its own whether or not anyone abstained, and, if
// any, the votes that ran out of time, which cost a point (docs/games/impostor.md#points).
export function ballotRows(t: Translate, ballot: BallotView): Row[] {
  const { rows, abstained, timedOut } = voteRows(ballot);
  return [
    ...rows.map(({ number, voters }) => ({
      key: `n${number}`,
      number,
      label: t('games.impostor.record.votes', { count: voters.length }, voters.length),
      voters,
      mark: number === ballot.out ? t('games.impostor.record.out') : null,
    })),
    { key: 'abstain', label: t('games.impostor.record.abstained'), voters: abstained },
    ...(timedOut.length > 0 ? [{ key: 'timeout', label: t('games.impostor.record.timedOut'), voters: timedOut }] : []),
  ];
}

// The rows of the verdicts on a report that is over: agreed, disagreed, each with its count, and
// abstained, if anyone did, the row of the verdict that decided marked.
export function reportRows(t: Translate, report: ReportView): Row[] {
  const rows = verdictRows(report);
  return [
    {
      key: 'agree',
      label: t('games.impostor.report.agreeCount', { count: rows.agree.length }, rows.agree.length),
      voters: rows.agree,
      mark: report.passed ? t('games.impostor.report.passedMark') : null,
    },
    {
      key: 'disagree',
      label: t('games.impostor.report.disagreeCount', { count: rows.disagree.length }, rows.disagree.length),
      voters: rows.disagree,
    },
    ...(rows.abstain.length > 0
      ? [{ key: 'abstain', label: t('games.impostor.report.abstain'), voters: rows.abstain }]
      : []),
  ];
}

// The line under a report's result: who reported whom, how many could judge it and how many
// agreements it needed.
export const reportLine = (t: Translate, report: ReportView): string =>
  t('games.impostor.report.summary', {
    by: report.by,
    target: report.target,
    eligible: report.eligible,
    needed: needed(report.eligible),
  });
