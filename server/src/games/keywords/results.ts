import { TEAMS, verdictFor, type Team } from '@reviewer2/shared';
import type { GameTitle, PlayerResult } from '../../core/game';
import { firstClue, heavenlyHand, missedDeadline, openingRecord } from './match';
import { heroesOf } from './rules';
import type { Seating } from './seats';
import { remaining, type KeywordsState } from './state';

// How a game that ended by itself came out for each player, for the records of the players with
// accounts (GameModule.results): their seat, whether they won, the decision letter that their group
// got, and the titles that the game brought them (docs/games/keywords.md#titles). The same is
// worked out again from the record of a game when the rules change (replay.ts), so nothing here
// reads anything but the game and the seats.

// The titles that a game which ended by itself brought a player who played for `team` in it, by
// their member key, each with the turn it came in: Forgot to Submit for each turn in which their
// time for the clue ran out, Deadline Hero for each turn that made them one (heroesOf), and for
// everyone in the group, the opening record and the heavenly hand of its first clue.
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
    ...([...heroesOf(record)].some((hero) => keyOf(hero) === key)
      ? [{ title: 'deadline_hero' as const, turn: record.turn }]
      : []),
  ]);
  const first = firstClue(game, team);
  if (first && openingRecord(game, team)) titles.push({ title: 'opening_record', turn: first.turn });
  if (first && heavenlyHand(game, team)) titles.push({ title: 'heavenly_hand', turn: first.turn });
  return titles;
}

// Everyone in a seat when the game ended took part: the captain as the group's PI and the guessers
// as its students. The verdict is the decision letter that their group got, and the titles are
// those that the game brought them (titlesOf). Empty for a game that didn't end by itself, which
// counts for no record.
export function resultsOf(
  game: KeywordsState,
  seating: Pick<Seating, 'seats'>,
  keyOf: (playerId: string) => string,
): PlayerResult[] {
  const { result } = game;
  if (!result || result.winner === null) return [];
  const left = Object.fromEntries(TEAMS.map((team) => [team, remaining(game.cards, team)])) as Record<Team, number>;
  const { winner } = result;
  return [...seating.seats].flatMap(([playerId, seat]) =>
    seat.team === null
      ? []
      : [
          {
            playerId,
            side: seat.team,
            role: seat.role,
            winner,
            won: seat.team === winner,
            verdict: verdictFor(result, left, seat.team),
            titles: titlesOf(game, seat.team, keyOf(playerId), keyOf),
          },
        ],
  );
}
