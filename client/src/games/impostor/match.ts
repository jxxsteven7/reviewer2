import type { MatchView } from '@reviewer2/shared';
import type { ImpostorScoreDetail, ImpostorView } from '@reviewer2/shared/impostor';

type Translate = (key: string, named?: Record<string, unknown>, plural?: number) => string;

// What the match's table says of the second game's scoring, in the room (ImpostorGame.vue) and on
// a screen (ImpostorScreen.vue), between two games (docs/games/impostor.md#matches).

// Where a player's points in the game that has just ended came from (ImpostorScoreDetail), as one
// line under their name: their role, whether they won and lasted, how they went out, their hits
// and wrong votes, their comeback guess, and what ran out of time or was rejected.
export function describeScore(t: Translate, detail: unknown): string {
  const { role, won, fate, out, hits, wrong, comeback, missedLines, missedVotes, failedReports } =
    detail as ImpostorScoreDetail;
  const count = (key: string, value: number) =>
    value > 0 ? t(`games.impostor.match.detail.${key}`, { count: value }, value) : null;
  return [
    t(`games.impostor.roles.${role}`),
    won ? t('games.impostor.match.detail.won') : null,
    won && fate === 'alive' ? t('games.impostor.match.detail.lasted') : null,
    fate === 'voted_out' ? t('games.impostor.match.detail.outIn', { round: out ?? 0 }) : null,
    fate === 'violation' ? t('games.impostor.match.detail.violation') : null,
    fate === 'left' ? t('games.impostor.match.detail.left') : null,
    count('hits', hits),
    count('wrong', wrong),
    comeback === 'right' ? t('games.impostor.match.detail.comebackRight') : null,
    comeback === 'wrong' ? t('games.impostor.match.detail.comebackWrong') : null,
    count('missedLines', missedLines),
    count('missedVotes', missedVotes),
    count('failedReports', failedReports),
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

// Why the game that has just ended doesn't count, which the match plays again: it was withdrawn,
// a Reviewer 2 left it, or the chair removed a player. Null while the game is on, for a game that
// counted, and outside a match.
export function unscoredNote(
  t: Translate,
  match: Pick<MatchView, 'status' | 'game' | 'played'> | null,
  game: Pick<ImpostorView, 'phase' | 'result'>,
): string | null {
  if (game.phase !== 'over' || match?.status !== 'on' || match.game <= match.played) return null;
  const { result } = game;
  const why = result === null ? 'withdrawn' : result.reason === 'reviewer2_left' ? 'reviewer2_left' : 'removed';
  return t(`games.impostor.match.unscored.${why}`, { game: match.game });
}
