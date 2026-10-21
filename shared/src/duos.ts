import type { RecordResult } from './accounts';

// Friend duos (docs/architecture.md#friend-duos): what two friends have played together in one game,
// counted from its games on both their records, and the titles that the friend who stands out in
// each count holds among an account's friends in that game. Teammates are two accounts on the same
// side of a game, opponents two on different sides, and one beat the other by finishing in a better
// place. Every game of the game counts, in a match or not, from before the two were friends too; the
// counts of two games are never added up. The server counts and awards; each account sees only its
// own friends, and nobody else learns of them.

// The five titles, each held among an account's friends by the friend with the most of one count:
// the most games won together, the most lost together, the most won against the account, the most
// lost to it, and the most played against it.
export const DUO_TITLES = ['coauthor', 'corejected', 'reviewer2', 'submitter', 'rival'] as const;
export type DuoTitle = (typeof DUO_TITLES)[number];

// How many games of a count a friend needs for a title, as a streak needs three games.
export const DUO_MIN = 3;

// What an account has played with one friend, from the account's side: games on the same side,
// won and lost, and games on different sides, all of them, those the account finished in a better
// place than the friend and those the friend did. A game drawn together is neither won nor lost
// together, and opponents level in their place beat neither.
export interface DuoCounts {
  wonTogether: number;
  lostTogether: number;
  against: number;
  beat: number;
  beaten: number;
}

// A friend's counts with the titles they hold among the account's friends.
export interface DuoView extends DuoCounts {
  titles: DuoTitle[];
}

// A title that the game which has just ended brought a friend who played in it, as the snapshot that
// ends the game tells the account alone: the friend by their player ID in the room, the title and
// the count that won it.
export interface DuoNotice {
  playerId: string;
  title: DuoTitle;
  count: number;
}

export const NO_GAMES: Readonly<DuoCounts> = Object.freeze({
  wonTogether: 0,
  lostTogether: 0,
  against: 0,
  beat: 0,
  beaten: 0,
});

// The count that each title goes by.
export const DUO_COUNT: Readonly<Record<DuoTitle, (counts: DuoCounts) => number>> = Object.freeze({
  coauthor: (counts) => counts.wonTogether,
  corejected: (counts) => counts.lostTogether,
  reviewer2: (counts) => counts.beaten,
  submitter: (counts) => counts.beat,
  rival: (counts) => counts.against,
});

// Who holds each title among the friends, by whatever the friends are known by: those with the
// most of its count, at least DUO_MIN. Friends level at the top hold it together, as co-first
// authors do, so that nothing but the games decides. A title that nobody has earned has nobody.
export function duoHolders<Friend>(counts: ReadonlyMap<Friend, DuoCounts>): Record<DuoTitle, Friend[]> {
  const holders = {} as Record<DuoTitle, Friend[]>;
  for (const title of DUO_TITLES) {
    const count = DUO_COUNT[title];
    let best = DUO_MIN;
    let held: Friend[] = [];
    for (const [friend, theirs] of counts) {
      const value = count(theirs);
      if (value > best) [best, held] = [value, [friend]];
      else if (value === best) held.push(friend);
    }
    holders[title] = held;
  }
  return holders;
}

// Each friend's counts with the titles they hold.
export function duoViews<Friend>(counts: ReadonlyMap<Friend, DuoCounts>): Map<Friend, DuoView> {
  const holders = duoHolders(counts);
  const views = new Map<Friend, DuoView>();
  for (const [friend, theirs] of counts) {
    views.set(friend, { ...theirs, titles: DUO_TITLES.filter((title) => holders[title].includes(friend)) });
  }
  return views;
}

// One player's part in a game, as far as duos need it.
export interface DuoPart {
  side: string;
  result: RecordResult;
  place: number;
}

// What one game adds to an account's counts with a friend who played in it.
export function duoGame(mine: DuoPart, theirs: DuoPart): DuoCounts {
  if (mine.side === theirs.side) {
    return { ...NO_GAMES, wonTogether: mine.result === 'won' ? 1 : 0, lostTogether: mine.result === 'lost' ? 1 : 0 };
  }
  return {
    ...NO_GAMES,
    against: 1,
    beat: mine.place < theirs.place ? 1 : 0,
    beaten: theirs.place < mine.place ? 1 : 0,
  };
}

// The counts without one game: what they were before it.
export const withoutGame = (counts: DuoCounts, game: DuoCounts): DuoCounts => ({
  wonTogether: counts.wonTogether - game.wonTogether,
  lostTogether: counts.lostTogether - game.lostTogether,
  against: counts.against - game.against,
  beat: counts.beat - game.beat,
  beaten: counts.beaten - game.beaten,
});

// The titles that one game brought friends who played in it: `after` is every friend's counts with
// the game in them, and `played` what the game added for each friend who played in it. A friend
// is brought a title they didn't hold before the game and hold after it, whether they took it
// from someone, now share it, or are the first to earn it. A title that a friend kept, or that
// went to someone who wasn't in the game, is nothing to tell.
export function duoChanges<Friend>(
  after: ReadonlyMap<Friend, DuoCounts>,
  played: ReadonlyMap<Friend, DuoCounts>,
): { friend: Friend; title: DuoTitle; count: number }[] {
  const before = new Map(after);
  for (const [friend, game] of played) {
    const theirs = after.get(friend);
    if (theirs) before.set(friend, withoutGame(theirs, game));
  }
  const was = duoHolders(before);
  const now = duoHolders(after);
  return DUO_TITLES.flatMap((title) =>
    now[title]
      .filter((friend) => played.has(friend) && !was[title].includes(friend))
      .map((friend) => ({ friend, title, count: DUO_COUNT[title](after.get(friend) ?? NO_GAMES) })),
  );
}
