import type { Component } from 'vue';
import KeywordsGame from './keywords/KeywordsGame.vue';
import KeywordsLobby from './keywords/KeywordsLobby.vue';
import KeywordsScreen from './keywords/KeywordsScreen.vue';

// Each game's screens: the waiting room, the game itself (with its result), and the view for a
// big screen. The room page picks them by the room's game.
export interface GameScreens {
  Lobby: Component;
  Game: Component;
  Screen: Component;
}

export const games: Record<string, GameScreens> = {
  keywords: { Lobby: KeywordsLobby, Game: KeywordsGame, Screen: KeywordsScreen },
};
