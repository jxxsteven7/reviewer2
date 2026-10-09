import { defaultSettings, type Language } from '@reviewer2/shared';
import type { Component } from 'vue';
import KeywordsGame from './keywords/KeywordsGame.vue';
import KeywordsLobby from './keywords/KeywordsLobby.vue';
import KeywordsScreen from './keywords/KeywordsScreen.vue';
import SettingsForm from './keywords/SettingsForm.vue';

// Each game's screens: the waiting room, the game itself (with its result), and the view for a
// big screen. The room page picks them by the room's game. The room setup asks the game for the
// form of its own settings, which it binds with v-model to the settings and with v-model:valid to
// whether they will do, and for the settings that the form starts with in a room's language.
export interface GameScreens {
  Lobby: Component;
  Game: Component;
  Screen: Component;
  Settings: Component;
  defaultSettings(language: Language): object;
}

export const games: Record<string, GameScreens> = {
  keywords: {
    Lobby: KeywordsLobby,
    Game: KeywordsGame,
    Screen: KeywordsScreen,
    Settings: SettingsForm,
    defaultSettings,
  },
};
