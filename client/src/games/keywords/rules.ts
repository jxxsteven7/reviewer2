import type { Language } from '@reviewer2/shared';
import type { KeywordsSettings } from '@reviewer2/shared/keywords';

// The sections of "How to play" (RulesSheet.vue) as a room with these settings plays the game: its
// guess rule, its clue rule, its time limits and its extensions, and at the end what becomes of the
// record of the game (docs/architecture.md#game-records), which guests read here. The letters of a
// clue count wherever a Latin word on the board has them in a Chinese room, and at its start in an
// English one. A Chinese room also asks for no clue that sounds like a word on the board, which no
// program checks. The tutorial shows them one at a time (guide/RulesScene.vue).
type Translate = (key: string, named?: Record<string, unknown>, plural?: number) => string;

export interface RulesSection {
  title: string;
  text: string[];
}

export function rulesSections(t: Translate, settings: KeywordsSettings, language: Language): RulesSection[] {
  // What time does in this room: a line for the clues and one for the guesses, for the phases that
  // have a limit, or one line when none has.
  const { firstClueTime, clueTime, guessTime, extensions } = settings;
  const limited = firstClueTime > 0 || clueTime > 0 || guessTime > 0;
  const lines = [
    ...(firstClueTime > 0 || clueTime > 0 ? [t('rules.timeClue')] : []),
    ...(guessTime > 0 ? [t('rules.timeGuess')] : []),
    ...(limited && extensions ? [t('rules.extension')] : []),
  ];
  const time = [...(lines.length > 0 ? [t('rules.time'), ...lines] : [t('rules.noTime')]), t('rules.pause')];
  return [
    { title: t('rules.goalTitle'), text: [t('rules.goal')] },
    { title: t('rules.rolesTitle'), text: [t('rules.roles'), t('rules.avatars')] },
    { title: t('rules.turnTitle'), text: [t(`rules.turn.${settings.guessRule}`)] },
    { title: t('rules.revealTitle'), text: [t('rules.reveal'), t('rules.marks')] },
    {
      title: t('rules.clueTitle'),
      text: [
        t(`rules.clue.${language}`, { count: settings.clueLength }, settings.clueLength),
        t('rules.clueCommon'),
        t('rules.clueCharacter'),
        t(`rules.clueLetters.${language}`),
        ...(language === 'zh' ? [t('rules.clueSound')] : []),
        t('rules.clueQuiet'),
        t('rules.clueTargets'),
        t(`rules.clueRule.${settings.clueRule}`),
      ],
    },
    { title: t('rules.timeTitle'), text: time },
    { title: t('rules.endTitle'), text: [t('rules.end')] },
    { title: t('privacy.recordsTitle'), text: [t('privacy.records')] },
  ];
}
