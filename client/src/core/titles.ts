import {
  DUO_MIN,
  STREAK_MIN,
  type DuoTitle,
  type FeedbackKind,
  type Language,
  type StreakKind,
  type Title,
} from '@reviewer2/shared';
import { streakTitle } from './streaks';

// Every title that a page shows, which a tap explains (TitleInfo.vue,
// docs/architecture.md#titles): the titles that matches award and games bring, the streaks, the
// feedback contributions, the author's badge, the decision letter that a group gets at the end of a game,
// the mark of a game on the record that an AI played in, and the titles that friends hold among an
// account's friends. The academic rank opens its ladder instead
// (RankLadder.vue). What each title is and how it is won is under titles, duos and
// game.letter.explain in the locale files. A streak is the longest of its kind on the record,
// `best`, as the pills on the account page and the public profile show it, or else the run that
// the game which has just ended brought the player to, which may fall short of their record.
export type TitleRef =
  | { kind: 'award'; title: Title }
  | { kind: 'streak'; streak: StreakKind; length: number; best: boolean }
  | { kind: 'contribution'; contribution: FeedbackKind }
  | { kind: 'author' }
  | { kind: 'verdict'; verdict: string }
  | { kind: 'agents' }
  | { kind: 'duo'; duo: DuoTitle };

// A component's translator, as far as the titles need it.
type Translate = (key: string, named?: Record<string, string | number>) => string;

// The news a title brings, which colors it where it stands in text, blue for good and red for bad
// (TitleInfo.vue, docs/design.md). A decision takes its group's color instead; the author's badge
// and the AI tag are pills, which have no news; and the titles of two friends, which stand only on
// pills and in headings, have none yet: some are good news and some, as being rejected together,
// are not.
const BAD_AWARDS: ReadonlySet<Title> = new Set([
  'black_hole',
  'missed_deadline',
  'instant_reject',
  'first_turn_reject',
]);
export function titleTone(title: TitleRef): 'good' | 'bad' | null {
  switch (title.kind) {
    case 'award':
      return BAD_AWARDS.has(title.title) ? 'bad' : 'good';
    case 'streak':
      return title.streak === 'wins' ? 'good' : 'bad';
    case 'contribution':
      return 'good';
    case 'author':
    case 'verdict':
    case 'agents':
    case 'duo':
      return null;
  }
}

// The title's name, as its pill or its line shows it.
export function titleName(t: Translate, title: TitleRef, language: Language): string {
  switch (title.kind) {
    case 'award':
      return t(`account.profile.titleNames.${title.title}`);
    case 'streak':
      return streakTitle(t, title.streak, title.length, language);
    case 'contribution':
      return t('account.profile.contributed', { kind: t(`contributions.kinds.${title.contribution}`) });
    case 'author':
      return t('playerPage.author');
    case 'verdict':
      return t(`game.letter.verdicts.${title.verdict}`);
    case 'agents':
      return t('account.profile.agentsGame');
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
    case 'contribution':
      return [t(`titles.contribution.${title.contribution}`)];
    case 'author':
      return [t('titles.author')];
    case 'verdict':
      return [t(`game.letter.explain.${title.verdict}`)];
    case 'agents':
      return [t('titles.agents'), t('lobby.agentNote')];
    case 'duo':
      return [t(`duos.explain.${title.duo}`, { min: DUO_MIN }), t('duos.private')];
  }
}
