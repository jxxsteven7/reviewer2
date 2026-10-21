import { describe, expect, test } from 'vitest';
import { MATCH_TITLES, TITLES, type Title } from '@reviewer2/shared';
import { GAMES } from '.';

// The games that this server plays, held against each other: the records keep a title by its ID
// alone (docs/architecture.md#titles), and a game by its own.
describe('the games', () => {
  test('have IDs of their own', () => {
    const ids = GAMES.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("bring titles that no other game brings, none of them a match's, all of them ones there are", () => {
    const declared = GAMES.flatMap(({ titles = [] }) => titles);
    expect(new Set(declared).size).toBe(declared.length);
    const match: readonly Title[] = MATCH_TITLES;
    expect(declared.filter((title) => match.includes(title))).toEqual([]);
    expect(declared.filter((title) => !TITLES.includes(title))).toEqual([]);
  });
});
