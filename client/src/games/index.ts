import { defaultSettings, restoreSettings, type Language } from '@reviewer2/shared';
import type { Component } from 'vue';
import KeywordsGame from './keywords/KeywordsGame.vue';
import KeywordsLobby from './keywords/KeywordsLobby.vue';
import KeywordsScreen from './keywords/KeywordsScreen.vue';
import ReplayViewer from './keywords/ReplayViewer.vue';
import RulesSheet from './keywords/RulesSheet.vue';
import SettingsForm from './keywords/SettingsForm.vue';

// Each game's screens: the waiting room, the game itself (with its result), the view for a big
// screen, and the replay of a finished game, which takes the replay the server kept. The room page
// picks them by the room's game. The room setup asks the game for the form of its own settings,
// which it binds with v-model to the settings and with v-model:valid to whether they will do, and
// for the settings that the form starts with in a room's language: the defaults, or those of the
// creator's last room, which was in the language `from`, if known, as far as they still will do.
// The home page shows the rules beside the game's name, as a `link` with the `defaults`, for the
// settings and the language given.
export interface GameScreens {
  Lobby: Component;
  Game: Component;
  Screen: Component;
  Replay: Component;
  Settings: Component;
  Rules: Component;
  defaultSettings(language: Language): object;
  restoreSettings(saved: unknown, language: Language, from?: Language | null): object;
}

export const games: Record<string, GameScreens> = {
  keywords: {
    Lobby: KeywordsLobby,
    Game: KeywordsGame,
    Screen: KeywordsScreen,
    Replay: ReplayViewer,
    Settings: SettingsForm,
    Rules: RulesSheet,
    defaultSettings,
    restoreSettings,
  },
};
