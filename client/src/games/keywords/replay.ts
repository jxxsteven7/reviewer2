import {
  TEAMS,
  type CardColor,
  type KeywordsView,
  type Language,
  type PlayerView,
  type ReplayPerson,
  type Seat,
  type ShownReplay,
} from '@reviewer2/shared';

// The replay of the game that has just ended, from the view, for the review on the results page
// (ReplayViewer), as the server shows the replays it keeps (docs/architecture.md#replays): once a
// game is over, every view carries every color. The groups are those in the seats now, in the order
// of the room, and everyone is who the room says they are, under the name the room gives them;
// someone who left during the game is no one the room knows. Null while the game is on, when there
// is nothing to review yet.
export function replayOf(
  game: KeywordsView,
  language: Language,
  players: readonly PlayerView[],
  seats: Readonly<Record<string, Seat>>,
  me: string | null,
): ShownReplay | null {
  if (!game.result || game.cards.some((card) => card.color === undefined)) return null;
  const inSeat = (team: string, role: Seat['role']) =>
    players.filter(({ id }) => seats[id]?.team === team && seats[id]?.role === role).map(({ id }) => id);
  const people: Record<string, ReplayPerson> = {};
  for (const { id, name, guest, agent, avatar, handle } of players) {
    people[id] = {
      name,
      ...(guest === undefined ? {} : { guest }),
      ...(agent === undefined ? {} : { agent }),
      ...(avatar === undefined ? {} : { avatar }),
      ...(handle === undefined ? {} : { handle }),
    };
  }
  return {
    gameId: game.gameId,
    language,
    startingTeam: game.startingTeam,
    cards: game.cards.map(({ word, color }) => ({ word, color: color as CardColor })),
    history: game.history,
    result: game.result,
    groups: TEAMS.map((team) => ({
      team,
      captain: inSeat(team, 'captain')[0] ?? null,
      guessers: inSeat(team, 'guesser'),
    })),
    people,
    me,
  };
}
