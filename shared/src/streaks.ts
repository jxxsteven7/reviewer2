// Streaks (docs/architecture.md#streaks): how many games in a row an account has won, and lost, at
// most, over every game on its record, whichever game it was and in a match or not, in the order
// they ended. A streak of STREAK_MIN games or more earns a title, named with the number in words
// (numbers.ts): "Three Submissions, Three Acceptances" for wins and "Three Submissions, Three
// Rejections" for losses, and the same in Chinese with the number in Chinese characters. The server
// keeps the streaks (server/src/store/records.ts) and tells the room of them when a game ends.

export const STREAK_MIN = 3;

export const STREAK_KINDS = ['wins', 'losses'] as const;
export type StreakKind = (typeof STREAK_KINDS)[number];

// The longest streak of each kind on an account's record, which the account page and the public
// profile show as titles from STREAK_MIN on. Zero for an account that has never won, or never lost.
export interface BestStreaks {
  wins: number;
  losses: number;
}

// The streak that the game which has just ended brought a player to: of which kind, how long, and
// whether it is the longest of its kind on their record.
export interface Streak {
  kind: StreakKind;
  length: number;
  record: boolean;
}

// A streak as the snapshot of an ended game tells it (room.ts). Every winning streak goes to
// everyone in the room, screens included; a losing streak goes to its player alone.
export interface StreakNotice extends Streak {
  playerId: string;
}
