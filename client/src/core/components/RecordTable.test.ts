// @vitest-environment happy-dom
import type { RecordCounts } from '@reviewer2/shared';
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';
import RecordTable from './RecordTable.vue';

// The record as counts (docs/architecture.md#accounts): the games outside matches, in matches and
// all of them, with the wins and the share of wins, and the matches finished and won.

const table = (counts: RecordCounts, locale: 'en' | 'zh' = 'en') =>
  mount(RecordTable, {
    props: { counts },
    global: { plugins: [createI18n({ legacy: false, locale, messages: { en, zh } })] },
  });
const cells = (wrapper: ReturnType<typeof table>) =>
  wrapper.findAll('tr').map((row) => row.findAll('th, td').map((cell) => cell.text()));

describe('RecordTable', () => {
  test('counts the games outside matches and in them apart, with the total and the share of wins', () => {
    const wrapper = table({
      ordinary: { games: 9, wins: 3 },
      inMatches: { games: 3, wins: 2 },
      matches: { played: 2, won: 1 },
    });
    expect(cells(wrapper)).toEqual([
      ['', 'Games', 'Won', 'Win rate'],
      ['Ordinary games', '9', '3', '33%'],
      ['Games in matches', '3', '2', '67%'],
      ['Total', '12', '5', '42%'],
    ]);
    expect(wrapper.get('.matches').text()).toBe('Matches: 2 \u00b7 Finished first: 1');
  });

  test('is a table that a screen reader reads by its headers', () => {
    const wrapper = table({
      ordinary: { games: 1, wins: 1 },
      inMatches: { games: 0, wins: 0 },
      matches: { played: 0, won: 0 },
    });
    expect(wrapper.findAll('thead th').map((cell) => cell.attributes('scope'))).toEqual(['col', 'col', 'col']);
    expect(wrapper.findAll('tbody th').map((cell) => cell.attributes('scope'))).toEqual(['row', 'row', 'row']);
  });

  test('has no rate for a row without games, and says when there is no match yet, in Chinese too', () => {
    const none = { ordinary: { games: 0, wins: 0 }, inMatches: { games: 0, wins: 0 }, matches: { played: 0, won: 0 } };
    const wrapper = table(none);
    expect(
      cells(wrapper)
        .slice(1)
        .map((row) => row[3]),
    ).toEqual(['\u2014', '\u2014', '\u2014']);
    expect(wrapper.get('.matches').text()).toBe('No matches yet.');
    const chinese = table({ ...none, ordinary: { games: 4, wins: 1 }, matches: { played: 3, won: 2 } }, 'zh');
    expect(cells(chinese)[0]).toEqual(['', '\u5c40\u6570', '\u80dc', '\u80dc\u7387']);
    expect(cells(chinese)[1]).toEqual(['\u666e\u901a\u5bf9\u5c40', '4', '1', '25%']);
    expect(chinese.get('.matches').text()).toBe('\u6bd4\u8d5b 3 \u573a\uff0c\u593a\u51a0 2 \u573a');
  });
});
