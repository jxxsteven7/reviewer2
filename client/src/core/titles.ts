import {
  DUO_MIN,
  STREAK_MIN,
  type AcknowledgmentKind,
  type DuoTitle,
  type Language,
  type StreakKind,
  type Title,
} from '@reviewer2/shared';
import { streakTitle } from './streaks';

// Every title that a page shows, which a tap explains (TitleInfo.vue,
// docs/architecture.md#titles): the titles that matches award and games bring, the streaks, the
// acknowledgments, the author's badge, the decision letter that a group gets at the end of a game,
// and the titles that friends hold among an account's friends. The academic rank opens its ladder instead
// (RankLadder.vue). What each title is and how it is won is under titles, duos and
// game.letter.explain in the locale files. A streak is the longest of its kind on the record,
// `best`, as the pills on the account page and the public profile show it, or else the run that
// the game which has just ended brought the player to, which may fall short of their record.
export type TitleRef =
  | { kind: 'award'; title: Title }
  | { kind: 'streak'; streak: StreakKind; length: number; best: boolean }
  | { kind: 'thanks'; thanks: AcknowledgmentKind }
  | { kind: 'author' }
  | { kind: 'verdict'; verdict: string }
  | { kind: 'duo'; duo: DuoTitle };

// A component's translator, as far as the titles need it.
type Translate = (key: string, named?: Record<string, string | number>) => string;

// The title's name, as its pill or its line shows it.
export function titleName(t: Translate, title: TitleRef, language: Language): string {
  switch (title.kind) {
    case 'award':
      return t(`account.profile.titleNames.${title.title}`);
    case 'streak':
      return streakTitle(t, title.streak, title.length, language);
    case 'thanks':
      return t('account.profile.acknowledged', { kind: t(`acknowledgments.kinds.${title.thanks}`) });
    case 'author':
      return t('playerPage.author');
    case 'verdict':
      return t(`game.letter.verdicts.${title.verdict}`);
    case 'duo':
      return t(`duos.names.${title.duo}`);
  }
}

// What the title is and how it is won, a paragraph to a line.
export function titleExplanation(t: Translate, title: TitleRef): string[] {
  switch (title.kind) {
    case 'award':
      return [t(`titles.award.${title.title}`)];
    case 'streak':
      return [
        t(`titles.${title.best ? 'streak' : 'streakNow'}.${title.streak}`, { n: title.length }),
        t('titles.streakCounts', { min: STREAK_MIN }),
      ];
    case 'thanks':
      return [t(`titles.thanks.${title.thanks}`)];
    case 'author':
      return [t('titles.author')];
    case 'verdict':
      return [t(`game.letter.explain.${title.verdict}`)];
    case 'duo':
      return [t(`duos.explain.${title.duo}`, { min: DUO_MIN }), t('duos.private')];
  }
}
