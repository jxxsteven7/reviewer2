import { type Language, type MatchRules } from '@reviewer2/shared';
import {
  defaultSettings as impostorDefaults,
  IMPOSTOR_MATCH_GAMES,
  restoreSettings as restoreImpostorSettings,
} from '@reviewer2/shared/impostor';
import { defaultMatchRules, defaultSettings, keywordsMatchRules, restoreSettings } from '@reviewer2/shared/keywords';
import type { Component } from 'vue';
import type { GuideChapter } from '../core/guide/chapters';
import type { ShownRoom } from '../core/room';
import ImpostorGame from './impostor/ImpostorGame.vue';
import ImpostorLobby from './impostor/ImpostorLobby.vue';
import ImpostorRules from './impostor/ImpostorRules.vue';
import ImpostorScreen from './impostor/ImpostorScreen.vue';
import ImpostorReplay from './impostor/ReplayViewer.vue';
import ImpostorSettings from './impostor/SettingsForm.vue';
import ImpostorMatchNote from './impostor/MatchNote.vue';
import SourceChoice from './impostor/SourceChoice.vue';
import * as keywordsGuide from './keywords/guide';
import KeywordsGame from './keywords/KeywordsGame.vue';
import KeywordsLobby from './keywords/KeywordsLobby.vue';
import KeywordsScreen from './keywords/KeywordsScreen.vue';
import MatchOptions from './keywords/MatchOptions.vue';
import ReplayViewer from './keywords/ReplayViewer.vue';
import KeywordsRules from './keywords/KeywordsRules.vue';
import SettingsForm from './keywords/SettingsForm.vue';

// Each game's screens: the waiting room, the game itself (with its result), the view for a big
// screen, and the replay of a finished game, which takes the replay the server kept. The room page
// picks them by the room's game. The room setup asks the game for the form of its own settings,
// which it binds with v-model to the settings and with v-model:valid to whether they will do, and
// for the settings that the form starts with in a room's language: the defaults, or those of the
// creator's last room, which was in the language `from`, if known, as far as they still will do.
// The home page shows the rules beside the game's name, as a `link` with the `defaults`, for the
// settings and the language given. A game whose words may come from elsewhere than the word lists,
// as from a setter, has its `Source`, the choice of where they come from, which the room setup
// shows before the lists and binds with v-model to the settings. A game with a tutorial has its
// chapters, which come before the site's (core/guide/chapters.ts), whose chapter on the waiting
// room shows the first game's, as the game's `Lobby` scene draws it, and whose chapter on rooms
// shares the game's invented `room`. A game with matches has its `match`: the form of its own
// options, which binds with v-model to them, the rules a new match starts from, and the rules of an
// earlier match, as far as they still will do, or null; and the numbers of games that a match may
// have, for a game that takes only some (MatchHooks.games on the server).
export interface GameScreens {
  Lobby: Component;
  Game: Component;
  Screen: Component;
  Replay: Component;
  Settings: Component;
  Rules: Component;
  Source?: Component;
  defaultSettings(language: Language): object;
  restoreSettings(saved: unknown, language: Language, from?: Language | null): object;
  match?: {
    Options: Component;
    defaults(): MatchRules;
    restore(saved: unknown): MatchRules | null;
    choices?: readonly number[];
  };
  guide?: {
    chapters: Omit<GuideChapter, 'game'>[];
    Lobby: Component;
    room(t: (key: string) => string, language: Language): ShownRoom;
  };
}

export const games: Record<string, GameScreens> = {
  keywords: {
    Lobby: KeywordsLobby,
    Game: KeywordsGame,
    Screen: KeywordsScreen,
    Replay: ReplayViewer,
    Settings: SettingsForm,
    Rules: KeywordsRules,
    defaultSettings,
    restoreSettings,
    match: { Options: MatchOptions, defaults: defaultMatchRules, restore: keywordsMatchRules },
    guide: keywordsGuide,
  },
  impostor: {
    Lobby: ImpostorLobby,
    Game: ImpostorGame,
    Screen: ImpostorScreen,
    Replay: ImpostorReplay,
    Settings: ImpostorSettings,
    Rules: ImpostorRules,
    Source: SourceChoice,
    defaultSettings: impostorDefaults,
    restoreSettings: restoreImpostorSettings,
    // A match of 3, 5 or 7 games, with no options of its own, only a line on what it keeps the same
    // and what it deals anew.
    match: {
      Options: ImpostorMatchNote,
      defaults: () => ({ games: IMPOSTOR_MATCH_GAMES[0] }),
      restore: (saved) => {
        const games = (saved as { games?: unknown } | null)?.games;
        return IMPOSTOR_MATCH_GAMES.some((choice) => choice === games) ? { games: games as number } : null;
      },
      choices: IMPOSTOR_MATCH_GAMES,
    },
  },
};
