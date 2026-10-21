import { describe, expect, test } from 'vitest';
import { defaultMatchRules, keywordsMatchOptions, keywordsMatchRules } from './match';

describe("the first game's options of a match", () => {
  test('are taken whole, with groups that stay or change and are drawn or chosen', () => {
    for (const teams of ['fixed', 'switch'] as const) {
      for (const grouping of ['random', 'choose'] as const) {
        expect(keywordsMatchOptions({ teams, grouping })).toEqual({ teams, grouping });
      }
    }
  });

  test('are refused when one is missing or none there is, or with anything else beside them', () => {
    for (const value of [
      { teams: 'switch' },
      { grouping: 'random' },
      { teams: 'mixed', grouping: 'random' },
      { teams: 'switch', grouping: 'vote' },
      { teams: 'switch', grouping: 'random', games: 3 },
      null,
      undefined,
      'switch',
      ['switch', 'random'],
    ]) {
      expect(keywordsMatchOptions(value)).toBeNull();
    }
  });
});

describe('the rules of a match of the first game', () => {
  test('are read whole: the number of games and the options', () => {
    expect(keywordsMatchRules({ games: 5, options: { teams: 'fixed', grouping: 'choose' } })).toEqual({
      games: 5,
      options: { teams: 'fixed', grouping: 'choose' },
    });
    expect(keywordsMatchRules(defaultMatchRules())).toEqual({
      games: 3,
      options: { teams: 'switch', grouping: 'random' },
    });
  });

  test('are refused in the old shape, with a number of games there is not, or with options that will not do', () => {
    for (const value of [
      { games: 3, teams: 'switch', grouping: 'random' },
      { games: 0, options: { teams: 'switch', grouping: 'random' } },
      { games: 11, options: { teams: 'switch', grouping: 'random' } },
      { games: 2.5, options: { teams: 'switch', grouping: 'random' } },
      { games: '3', options: { teams: 'switch', grouping: 'random' } },
      { options: { teams: 'switch', grouping: 'random' } },
      { games: 3, options: { teams: 'switch', grouping: 'random', rounds: 2 } },
      { games: 3, options: null },
      { games: 3 },
      null,
      [3],
    ]) {
      expect(keywordsMatchRules(value)).toBeNull();
    }
  });
});
