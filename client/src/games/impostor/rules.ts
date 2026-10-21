import type { Language } from '@reviewer2/shared';
import { roleCounts, survivors, type ImpostorSettings } from '@reviewer2/shared/impostor';
import type { RulesSection } from '../keywords/rules';

// The sections of the hidden word game's "How to play" (ImpostorRules.vue), as a room with these
// settings plays it (docs/games/impostor.md): who gets which word and how the game is won, with the
// PI and the guess after being voted out where the room has them; describing and voting, with the
// description's length and the time limits; reports; the off-field chat and the quick reactions;
// the points; and at the end what becomes of the record of the game, which guests read here.
type Translate = (key: string, named?: Record<string, unknown>, plural?: number) => string;

export function rulesSections(t: Translate, settings: ImpostorSettings, language: Language): RulesSection[] {
  const { describeTime, voteTime, length, pi, comeback, anonymous } = settings;
  const limited = describeTime > 0 || voteTime > 0;
  return [
    {
      title: t('games.impostor.rules.winTitle'),
      text: [
        t('games.impostor.rules.roles', { two: roleCounts(9, false).reviewer2 }),
        ...(pi ? [t('games.impostor.rules.pi')] : []),
        t('games.impostor.rules.win', { small: survivors(6), large: survivors(7) }),
        ...(comeback ? [t('games.impostor.rules.comeback')] : []),
      ],
    },
    {
      title: t('games.impostor.rules.turnTitle'),
      text: [
        t(`games.impostor.rules.describe.${language}`, { count: length }, length),
        t('games.impostor.rules.giveaway'),
        t('games.impostor.rules.vote'),
        t('games.impostor.rules.tie'),
        ...(anonymous ? [t('games.impostor.rules.anonymous')] : []),
        limited ? t('games.impostor.rules.time') : t('games.impostor.rules.noTime'),
      ],
    },
    { title: t('games.impostor.rules.reportTitle'), text: [t('games.impostor.rules.report')] },
    {
      title: t('games.impostor.rules.offFieldTitle'),
      text: [t('games.impostor.rules.offField'), t('games.impostor.rules.emotes')],
    },
    {
      title: t('games.impostor.rules.pointsTitle'),
      text: [t('games.impostor.rules.points'), t('games.impostor.rules.lost')],
    },
    { title: t('privacy.recordsTitle'), text: [t('privacy.records')] },
  ];
}
