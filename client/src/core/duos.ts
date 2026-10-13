import type { DuoCounts, DuoTitle } from '@reviewer2/shared';
import { fnv1a } from './hash';

// Friend duos as the pages show them (docs/architecture.md#friend-duos): what the account has
// played with a friend, on the friends list and on the friend's public profile (DuoSummary.vue),
// and the titles that a game which has just ended brought friends who played in it, with a line
// for the occasion under duos.lines in the locale files (DuoNotices.vue).

// A component's translator, as far as the line needs it.
type Translate = (key: string, named?: Record<string, string | number>) => string;

// The games played together and against each other, as one line: "As teammates: won 5, lost 2 ·
// As opponents: you won 3, they won 4". A kind of game that the two never played is left out.
export function duoLine(t: Translate, duo: DuoCounts): string {
  const parts: string[] = [];
  if (duo.wonTogether + duo.lostTogether > 0) {
    parts.push(t('duos.together', { won: duo.wonTogether, lost: duo.lostTogether }));
  }
  if (duo.against > 0) parts.push(t('duos.against', { won: duo.beat, lost: duo.beaten }));
  return parts.join(' · ');
}

// How many lines each title has, under duos.lines.<title> in the locale files, numbered from 1.
export const DUO_LINES = 3;

// The key of the line that a title brought in a game gets: it comes from the game, the friend and
// the title, so that the player reads the same line on every page and after every refresh, and
// the next game draws again, as the streaks do.
export const duoLineKey = (gameId: string, playerId: string, title: DuoTitle): string =>
  `duos.lines.${title}.${(fnv1a(`${gameId}:${playerId}:${title}`) % DUO_LINES) + 1}`;
