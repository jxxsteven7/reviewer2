import {
  firstCardTurn,
  firstClue,
  firstTurnReject,
  heavenlyHand,
  instantReject,
  openingRecord,
  TEAMS,
  verdictFor,
  type KeywordsScoreDetail,
  type Team,
} from '@reviewer2/shared/keywords';
import type { GameTitle, PlayerResult } from '../../core/game';
import { missedDeadline, scoreGame } from './match';
import { heroesOf, wonInTurn } from './rules';
import type { Seating } from './seats';
import { remaining, type KeywordsState } from './state';

// How a game that ended by itself came out for each player, for the records of the players with
// accounts (GameModule.results): their seat, whether they won, the decision letter that their group
// got, where their points came from, and the titles that the game brought them
// (docs/games/keywords.md#titles). The same is worked out again from the record of a game when the
// rules change (replay.ts), so nothing here reads anything but the game and the seats.

// The titles that a game which ended by itself brought a player who played for `team` in it, by
// their member key, each with the turn it came in: Forgot to Submit for each turn in which their
// time for the clue ran out, Deadline Hero for each turn that made them one (heroesOf), and for
// everyone in the group, what its first clue brought it (shared/src/games/keywords/titles.ts): the
// opening record or the heavenly hand, and the instant desk reject or the fall at the first hurdle.
export function titlesOf(
  game: KeywordsState,
  team: Team,
  key: string,
  keyOf: (playerId: string) => string,
): GameTitle[] {
  const titles: GameTitle[] = game.history.flatMap((record) => [
    ...(missedDeadline(record) && keyOf(record.captain ?? '') === key
      ? [{ title: 'missed_deadline' as const, turn: record.turn }]
      : []),
    ...([...heroesOf(record, wonInTurn(game, record))].some((hero) => keyOf(hero) === key)
      ? [{ title: 'deadline_hero' as const, turn: record.turn }]
      : []),
  ]);
  const first = firstClue(game, team);
  if (!first) return titles;
  if (openingRecord(game, team)) titles.push({ title: 'opening_record', turn: first.turn });
  if (heavenlyHand(game, team)) titles.push({ title: 'heavenly_hand', turn: first.turn });
  if (instantReject(game, team))
    titles.push({ title: 'instant_reject', turn: (firstCardTurn(game, team) ?? first).turn });
  if (firstTurnReject(game, team)) titles.push({ title: 'first_turn_reject', turn: first.turn });
  return titles;
}

// Everyone in a seat when the game ended took part: the captain as the group's PI and the guessers
// as its students. The group that won is in the first place and the other in the second. The
// verdict is the decision letter that their group got, the detail where their points came from, as
// the match scores the game (KeywordsScoreDetail), and the titles are those that the game brought
// them (titlesOf). Empty for a game that didn't end by itself, which counts for no record.
export function resultsOf(game: KeywordsState, seating: Seating, keyOf: (playerId: string) => string): PlayerResult[] {
  const { result } = game;
  if (!result || result.winner === null) return [];
  const left = Object.fromEntries(TEAMS.map((team) => [team, remaining(game.cards, team)])) as Record<Team, number>;
  const { winner } = result;
  const details = new Map(
    (scoreGame(game, seating, keyOf) ?? []).map(({ key, detail }) => [key, detail as KeywordsScoreDetail]),
  );
  return [...seating.seats].flatMap(([playerId, seat]) =>
    seat.team === null
      ? []
      : [
          {
            playerId,
            side: seat.team,
            role: seat.role,
            result: seat.team === winner ? ('won' as const) : ('lost' as const),
            place: seat.team === winner ? 1 : 2,
            verdict: verdictFor(result, left, seat.team),
            detail: details.get(keyOf(playerId)),
            titles: titlesOf(game, seat.team, keyOf(playerId), keyOf),
          },
        ],
  );
}
