// @vitest-environment happy-dom
import type { RecordCounts } from '@reviewer2/shared';
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';
import RecordStats from './RecordStats.vue';

// The record as counts (docs/architecture.md#accounts): the games, the share of wins, rounded down,
// the matches finished and the matches won, on four blocks.

const stats = (counts: RecordCounts, locale: 'en' | 'zh' = 'en') =>
  mount(RecordStats, {
    props: { counts },
    global: { plugins: [createI18n({ legacy: false, locale, messages: { en, zh } })] },
  });
const blocks = (wrapper: ReturnType<typeof stats>) =>
  wrapper.findAll('.block').map((block) => block.findAll('dt, dd').map((cell) => cell.text()));

describe('RecordStats', () => {
  test('shows the games of every kind, the share of wins, the matches and the matches won', () => {
    const wrapper = stats({
      ordinary: { games: 9, wins: 3 },
      inMatches: { games: 3, wins: 2 },
      matches: { played: 2, won: 1 },
    });
    expect(blocks(wrapper)).toEqual([
      ['Games', '12'],
      ['Win rate', '41%'],
      ['Matches', '2'],
      ['Won', '1'],
    ]);
  });

  test('rounds the share of wins down, so that only a record without a loss shows 100%', () => {
    const rate = (ordinary: { games: number; wins: number }) =>
      blocks(stats({ ordinary, inMatches: { games: 0, wins: 0 }, matches: { played: 0, won: 0 } }))[1]?.[1];
    expect(rate({ games: 200, wins: 199 })).toBe('99%');
    expect(rate({ games: 200, wins: 200 })).toBe('100%');
    expect(rate({ games: 300, wins: 1 })).toBe('0%');
    expect(rate({ games: 3, wins: 2 })).toBe('66%');
  });

  test('has no rate without games, in Chinese too', () => {
    const none = { ordinary: { games: 0, wins: 0 }, inMatches: { games: 0, wins: 0 }, matches: { played: 0, won: 0 } };
    expect(blocks(stats(none))).toEqual([
      ['Games', '0'],
      ['Win rate', '\u2014'],
      ['Matches', '0'],
      ['Won', '0'],
    ]);
    const chinese = stats({ ...none, ordinary: { games: 4, wins: 1 }, matches: { played: 3, won: 2 } }, 'zh');
    expect(blocks(chinese)).toEqual([
      ['\u603b\u5bf9\u5c40', '4'],
      ['\u603b\u80dc\u7387', '25%'],
      ['\u6bd4\u8d5b\u573a\u6b21', '3'],
      ['\u593a\u51a0\u6b21\u6570', '2'],
    ]);
  });
});
