import type { CardColor, KeywordsReplay, KeywordsView, Language, PlayerView } from '@reviewer2/shared';

// The replay of the game that has just ended, from the view, for the review on the results page
// (ReplayViewer): once a game is over, every view carries every color. Null while the game is on,
// when there is nothing to review yet.
export function replayOf(
  game: KeywordsView,
  language: Language,
  players: readonly PlayerView[],
): KeywordsReplay | null {
  if (!game.result || game.cards.some((card) => card.color === undefined)) return null;
  return {
    gameId: game.gameId,
    language,
    startingTeam: game.startingTeam,
    cards: game.cards.map(({ word, color }) => ({ word, color: color as CardColor })),
    history: game.history,
    events: game.events,
    result: game.result,
    players: Object.fromEntries(players.map((player) => [player.id, player.name])),
  };
}
