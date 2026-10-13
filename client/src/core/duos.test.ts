import { NO_GAMES } from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import { DUO_LINES, duoLine, duoLineKey } from './duos';

const t = (key: string, named?: Record<string, string | number>) => `${key}${JSON.stringify(named ?? {})}`;

describe('duoLine', () => {
  test('says the games together and against each other, leaving out a kind the two never played', () => {
    // The dot stays with the first part: a no-break space before it, a plain one after.
    expect(duoLine(t, { wonTogether: 5, lostTogether: 2, against: 7, beat: 3, beaten: 4 })).toBe(
      'duos.together{"won":5,"lost":2}\u00a0\u00b7 duos.against{"won":3,"lost":4}',
    );
    expect(duoLine(t, { ...NO_GAMES, lostTogether: 1 })).toBe('duos.together{"won":0,"lost":1}');
    expect(duoLine(t, { ...NO_GAMES, against: 1 })).toBe('duos.against{"won":0,"lost":0}');
    expect(duoLine(t, NO_GAMES)).toBe('');
  });
});

describe('duoLineKey', () => {
  test('is the same for a game, a friend and a title, and draws one of the lines', () => {
    expect(duoLineKey('g1', 'bob', 'coauthor')).toBe(duoLineKey('g1', 'bob', 'coauthor'));
    const numbers = new Set<string>();
    for (let game = 0; game < 30; game += 1) {
      const key = duoLineKey(`g${game}`, 'bob', 'rival');
      expect(key).toMatch(/^duos\.lines\.rival\.\d$/);
      numbers.add(key.slice(-1));
    }
    expect([...numbers].map(Number).sort()).toEqual(Array.from({ length: DUO_LINES }, (_, i) => i + 1));
  });
});
