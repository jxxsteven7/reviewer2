import type { Language } from '@reviewer2/shared';
import type { GuideChapter } from '../../../core/guide/chapters';
import type { ShownRoom } from '../../../core/room';
import { demoRoom, ME, type Translate } from './demo';
import ExtrasScene from './ExtrasScene.vue';
import LobbyScene from './LobbyScene.vue';
import PlayScene from './PlayScene.vue';
import RulesScene from './RulesScene.vue';
import SettingsScene from './SettingsScene.vue';

// The scene of the site's chapter on the waiting room, which shows this game's, and the invented
// room that the site's chapter on rooms shares, with Mira in it.
export const Lobby = LobbyScene;
export const room = (t: Translate, language: Language): ShownRoom =>
  demoRoom(t, language, { seats: { [ME]: { team: 'red', role: 'captain' } } });

// The first game's chapters of the tutorial (docs/architecture.md#the-tutorial): the rules in
// brief, the game played through as a student and as the PI, what else a game has, and the
// settings of a room. The two chapters that play the game end in a real game with Reviewer 1, in
// the role that they taught; the others lead on to the next chapter.
export const chapters: Omit<GuideChapter, 'game'>[] = [
  { id: 'rules', steps: 7, scene: RulesScene, end: { next: true } },
  { id: 'student', steps: 12, scene: PlayScene, end: { play: 'guesser' } },
  { id: 'pi', steps: 8, scene: PlayScene, end: { play: 'captain' } },
  { id: 'extras', steps: 6, scene: ExtrasScene, end: { next: true } },
  { id: 'settings', steps: 5, scene: SettingsScene, end: { next: true } },
];
