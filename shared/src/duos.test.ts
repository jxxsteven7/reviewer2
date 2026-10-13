import { describe, expect, test } from 'vitest';
import { DUO_MIN, DUO_TITLES, duoChanges, duoGame, duoHolders, duoViews, NO_GAMES, type DuoCounts } from './duos';

const counts = (some: Partial<DuoCounts>): DuoCounts => ({ ...NO_GAMES, ...some });

describe('friend duos', () => {
  test('give each title to the friend with the most of its count, from DUO_MIN games on', () => {
    expect(DUO_MIN).toBe(3);
    const friends = new Map([
      ['bob', counts({ wonTogether: 5, lostTogether: 1, against: 2, beat: 2 })],
      ['cat', counts({ wonTogether: 3, lostTogether: 4, against: 6, beat: 1, beaten: 5 })],
      ['dan', counts({ wonTogether: 2, against: 4, beat: 4 })],
    ]);
    expect(duoHolders(friends)).toEqual({
      coauthor: ['bob'],
      corejected: ['cat'],
      reviewer2: ['cat'],
      submitter: ['dan'],
      rival: ['cat'],
    });
  });

  test('give nobody a title below DUO_MIN games, and nothing to an account without friends', () => {
    const friends = new Map([['bob', counts({ wonTogether: 2, lostTogether: 2, against: 2, beat: 1, beaten: 1 })]]);
    expect(duoHolders(friends)).toEqual(Object.fromEntries(DUO_TITLES.map((title) => [title, []])));
    expect(duoHolders(new Map())).toEqual(Object.fromEntries(DUO_TITLES.map((title) => [title, []])));
  });

  test('share a title between friends level at the top', () => {
    const friends = new Map([
      ['bob', counts({ wonTogether: 4 })],
      ['cat', counts({ wonTogether: 4 })],
      ['dan', counts({ wonTogether: 3 })],
    ]);
    expect(duoHolders(friends).coauthor).toEqual(['bob', 'cat']);
  });

  test('give each friend their counts and every title they hold', () => {
    const friends = new Map([
      ['bob', counts({ against: 3, beaten: 3 })],
      ['cat', counts({ wonTogether: 1 })],
    ]);
    const views = duoViews(friends);
    expect(views.get('bob')).toEqual({ ...counts({ against: 3, beaten: 3 }), titles: ['reviewer2', 'rival'] });
    expect(views.get('cat')).toEqual({ ...counts({ wonTogether: 1 }), titles: [] });
  });

  test('count a game by the sides, so that a game of more than two sides counts too', () => {
    expect(duoGame({ side: 'red', won: true }, { side: 'red', won: true })).toEqual(counts({ wonTogether: 1 }));
    expect(duoGame({ side: 'red', won: false }, { side: 'red', won: false })).toEqual(counts({ lostTogether: 1 }));
    expect(duoGame({ side: 'red', won: true }, { side: 'blue', won: false })).toEqual(counts({ against: 1, beat: 1 }));
    expect(duoGame({ side: 'red', won: false }, { side: 'blue', won: true })).toEqual(
      counts({ against: 1, beaten: 1 }),
    );
    // Two of three sides lost.
    expect(duoGame({ side: 'red', won: false }, { side: 'green', won: false })).toEqual(counts({ against: 1 }));
  });

  test('tell of a title that the game brought a friend who played in it', () => {
    const won = counts({ wonTogether: 1 });
    // Bob reaches three games won together, the first to earn the title.
    expect(duoChanges(new Map([['bob', counts({ wonTogether: 3 })]]), new Map([['bob', won]]))).toEqual([
      { friend: 'bob', title: 'coauthor', count: 3 },
    ]);
    // Bob catches up with Cat, who held it alone, and now shares it; Cat, who wasn't in the game,
    // is nothing to tell.
    const level = new Map([
      ['bob', counts({ wonTogether: 4 })],
      ['cat', counts({ wonTogether: 4 })],
    ]);
    expect(duoChanges(level, new Map([['bob', won]]))).toEqual([{ friend: 'bob', title: 'coauthor', count: 4 }]);
    // Bob held it already: nothing new.
    expect(duoChanges(new Map([['bob', counts({ wonTogether: 5 })]]), new Map([['bob', won]]))).toEqual([]);
    // Still short of DUO_MIN.
    expect(duoChanges(new Map([['bob', counts({ wonTogether: 2 })]]), new Map([['bob', won]]))).toEqual([]);
  });

  test('tell of every title a game brought, to every friend in it', () => {
    // A game lost against Bob, with Cat on the same side: Bob becomes the one who beat the account
    // most and the one it played against most; Cat the one it lost with most.
    const after = new Map([
      ['bob', counts({ against: 3, beaten: 3 })],
      ['cat', counts({ lostTogether: 3 })],
      ['dan', counts({ wonTogether: 6 })],
    ]);
    const played = new Map([
      ['bob', duoGame({ side: 'red', won: false }, { side: 'blue', won: true })],
      ['cat', duoGame({ side: 'red', won: false }, { side: 'red', won: false })],
    ]);
    expect(duoChanges(after, played)).toEqual([
      { friend: 'cat', title: 'corejected', count: 3 },
      { friend: 'bob', title: 'reviewer2', count: 3 },
      { friend: 'bob', title: 'rival', count: 3 },
    ]);
  });
});
