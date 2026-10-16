// @vitest-environment happy-dom
import type { RecordCounts } from '@reviewer2/shared';
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';
import RecordStats from './RecordStats.vue';

// The record as counts (docs/architecture.md#accounts): the games, the share of wins, rounded down,
// the share of wins as a PI and as a student, each over its games, the matches finished and the
// matches won, on six blocks.

const NONE = { games: 0, wins: 0 };
const counts = (changes: Partial<RecordCounts> = {}): RecordCounts => ({
  ordinary: NONE,
  inMatches: NONE,
  roles: { captain: NONE, guesser: NONE },
  matches: { played: 0, won: 0 },
  ...changes,
});
const stats = (record: RecordCounts, locale: 'en' | 'zh' = 'en') =>
  mount(RecordStats, {
    props: { counts: record },
    global: { plugins: [createI18n({ legacy: false, locale, messages: { en, zh } })] },
  });
const blocks = (wrapper: ReturnType<typeof stats>) =>
  wrapper.findAll('.block').map((block) => block.findAll('dt, dd').map((cell) => cell.text()));

describe('RecordStats', () => {
  test('shows the games of every kind, the share of wins, in all and in each role, the matches and the matches won', () => {
    const wrapper = stats(
      counts({
        ordinary: { games: 9, wins: 3 },
        inMatches: { games: 3, wins: 2 },
        roles: { captain: { games: 7, wins: 4 }, guesser: { games: 5, wins: 1 } },
        matches: { played: 2, won: 1 },
      }),
    );
    expect(blocks(wrapper)).toEqual([
      ['Games', '12'],
      ['Win rate', '41%'],
      ['PI', '57%', '7 games'],
      ['Student', '20%', '5 games'],
      ['Matches', '2'],
      ['Won', '1'],
    ]);
    // The blocks of the record, which go in a line of six where it fits, and else four and two.
    expect(wrapper.find('.stat-blocks').classes()).toContain('roles');
  });

  test('rounds the share of wins down, so that only a record without a loss shows 100%', () => {
    const rate = (ordinary: { games: number; wins: number }) => blocks(stats(counts({ ordinary })))[1]?.[1];
    expect(rate({ games: 200, wins: 199 })).toBe('99%');
    expect(rate({ games: 200, wins: 200 })).toBe('100%');
    expect(rate({ games: 300, wins: 1 })).toBe('0%');
    expect(rate({ games: 3, wins: 2 })).toBe('66%');
    const asPi = (captain: { games: number; wins: number }) =>
      blocks(stats(counts({ roles: { captain, guesser: NONE } })))[2];
    expect(asPi({ games: 3, wins: 2 })).toEqual(['PI', '66%', '3 games']);
    expect(asPi({ games: 1, wins: 1 })).toEqual(['PI', '100%', '1 game']);
  });

  test('has no rate without games, in Chinese too', () => {
    expect(blocks(stats(counts()))).toEqual([
      ['Games', '0'],
      ['Win rate', '—'],
      ['PI', '—', '0 games'],
      ['Student', '—', '0 games'],
      ['Matches', '0'],
      ['Won', '0'],
    ]);
    const chinese = stats(
      counts({
        ordinary: { games: 4, wins: 1 },
        roles: { captain: NONE, guesser: { games: 4, wins: 1 } },
        matches: { played: 3, won: 2 },
      }),
      'zh',
    );
    expect(blocks(chinese)).toEqual([
      ['总对局', '4'],
      ['总胜率', '25%'],
      ['导师胜率', '—', '0 局'],
      ['学生胜率', '25%', '4 局'],
      ['比赛场次', '3'],
      ['夺冠次数', '2'],
    ]);
  });
});
