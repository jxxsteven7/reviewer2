// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DuoNotice, RoomView } from '@reviewer2/shared';
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';
import DuoNotices from './DuoNotices.vue';

const i18n = (locale: 'en' | 'zh') => createI18n({ legacy: false, locale, messages: { en, zh } });

// The lines as the file has them: vue-i18n compiles the imported messages in place.
type Lines = { duos: { lines: Record<string, Record<string, string>> } };
const lines = (language: string, title: string) =>
  Object.values(
    (JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'locales', `${language}.json`), 'utf8')) as Lines)
      .duos.lines[title] ?? {},
  );

function room(duos: DuoNotice[]): RoomView {
  return {
    roomId: 'r1',
    code: 'K7QX',
    rev: 1,
    game: 'keywords',
    language: 'en',
    fields: ['general'],
    randomFields: false,
    public: false,
    customWordCount: 0,
    rating: null,
    phase: 'ended',
    round: 1,
    gameId: 'g1',
    chairId: 'ann',
    players: [
      { id: 'ann', name: 'Ann', online: true },
      { id: 'bob', name: 'Bob', online: true, avatar: '/avatars/b.webp' },
    ],
    agents: false,
    agentsOnline: false,
    screens: 0,
    me: 'ann',
    match: null,
    streaks: [],
    duos,
    agentsPlayed: false,
    points: [],
    data: {},
  };
}

const mountFor = (duos: DuoNotice[], locale: 'en' | 'zh' = 'en') =>
  mount(DuoNotices, { props: { room: room(duos) }, global: { plugins: [i18n(locale)] } });

describe('DuoNotices', () => {
  test('show each title that the game brought a friend as a card, with the friend, the count and a line', () => {
    const wrapper = mountFor([
      { playerId: 'bob', title: 'coauthor', count: 3 },
      { playerId: 'bob', title: 'rival', count: 4 },
    ]);
    const cards = wrapper.findAll('.notice');
    expect(cards).toHaveLength(2);
    const [first, second] = cards;
    expect(first?.find('.kicker').text()).toBe('Friend title');
    expect(first?.find('.title').text()).toBe('Co-First Author');
    expect(first?.find('.headline').text()).toBe('Bob is now your Co-First Author: 3 games won together.');
    expect(first?.find('.headline img').attributes('src')).toBe('/avatars/b.webp');
    expect(lines('en', 'coauthor')).toContain(first?.find('.line').text());
    expect(second?.find('.headline').text()).toBe('Bob is now your Rival Reviewer: 4 games on opposite sides.');
    // What a screen reader is told, from the live region that is on the page before the notices.
    const live = wrapper.find('[aria-live=polite]');
    expect(live.text()).toBe(
      `Bob is now your Co-First Author: 3 games won together. ${first?.find('.line').text()} ` +
        `Bob is now your Rival Reviewer: 4 games on opposite sides. ${second?.find('.line').text()}`,
    );
  });

  test('say it in Chinese too', () => {
    const wrapper = mountFor([{ playerId: 'bob', title: 'reviewer2', count: 5 }], 'zh');
    expect(wrapper.find('.title').text()).toBe('你的 Reviewer 2');
    expect(wrapper.find('.headline').text()).toBe('Bob 成了你的 Reviewer 2：已经赢了你 5 局。');
    expect(lines('zh', 'reviewer2')).toContain(wrapper.find('.line').text());
  });

  test('show nothing without notices, nor for a friend who has left the room', () => {
    for (const duos of [[], [{ playerId: 'cat', title: 'coauthor' as const, count: 3 }]]) {
      const wrapper = mountFor(duos);
      expect(wrapper.find('.duo-notices').exists()).toBe(false);
      expect(wrapper.find('[aria-live=polite]').text()).toBe('');
    }
  });
});
