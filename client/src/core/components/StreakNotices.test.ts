// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RoomView, StreakNotice } from '@reviewer2/shared';
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';
import StreakNotices from './StreakNotices.vue';

const i18n = (locale: 'en' | 'zh') => createI18n({ legacy: false, locale, messages: { en, zh } });

// The lines as the file has them: vue-i18n compiles the imported messages in place.
type Lines = { streaks: { record: string; lines: Record<string, Record<string, Record<string, string>>> } };
const text = (language: string): Lines =>
  JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'locales', `${language}.json`), 'utf8')) as Lines;
const lines = (language: string, kind: string, tier: string) =>
  Object.values(text(language).streaks.lines[kind]?.[tier] ?? {});

function room(me: string | null, streaks: StreakNotice[]): RoomView {
  return {
    roomId: 'r1',
    code: 'K7QX',
    rev: 1,
    game: 'keywords',
    language: 'en',
    fields: ['general'],
    public: false,
    customWordCount: 0,
    phase: 'ended',
    round: 1,
    gameId: 'g1',
    chairId: 'ann',
    players: [
      { id: 'ann', name: 'Ann', online: true },
      { id: 'bob', name: 'Bob', online: true, avatar: '/avatars/b.webp' },
    ],
    screens: 0,
    me,
    match: null,
    streaks,
    duos: [],
    data: {},
  };
}

const mountFor = (me: string | null, streaks: StreakNotice[], locale: 'en' | 'zh' = 'en') =>
  mount(StreakNotices, { props: { room: room(me, streaks), large: me === null }, global: { plugins: [i18n(locale)] } });

describe('StreakNotices', () => {
  test("show the viewer's own streak as a card, with its line and whether it is a record", () => {
    const wrapper = mountFor('ann', [{ playerId: 'ann', kind: 'wins', length: 4, record: true }]);
    const mine = wrapper.find('.mine');
    expect(mine.classes()).toContain('wins');
    expect(mine.find('.kicker').text()).toBe('Winning streak');
    expect(mine.find('.title').text()).toBe('Four Submissions, Four Acceptances');
    expect(lines('en', 'wins', 'low')).toContain(mine.find('.line').text());
    expect(mine.find('.record').text()).toBe('A new personal record!');
    expect(wrapper.findAll('.cheer')).toHaveLength(0);
    // What a screen reader is told, from the live region that is on the page before the notices.
    expect(wrapper.find('.announcement').attributes('aria-live')).toBe('polite');
    expect(wrapper.find('.announcement').text()).toBe(
      `Winning streak: Four Submissions, Four Acceptances. ${mine.find('.line').text()} A new personal record!`,
    );

    const lost = mountFor('ann', [{ playerId: 'ann', kind: 'losses', length: 11, record: false }]);
    expect(lost.find('.mine').classes()).toContain('losses');
    expect(lost.find('.title').text()).toBe('Eleven Submissions, Eleven Rejections');
    expect(lines('en', 'losses', 'high')).toContain(lost.find('.line').text());
    expect(lost.find('.record').exists()).toBe(false);
  });

  test("cheer the others' winning streaks, by name, on a page and on a screen alike", () => {
    const streaks: StreakNotice[] = [
      { playerId: 'bob', kind: 'wins', length: 3, record: false },
      { playerId: 'zed', kind: 'wins', length: 3, record: false },
    ];
    const page = mountFor('ann', streaks);
    expect(page.find('.mine').exists()).toBe(false);
    const cheers = page.findAll('.cheer');
    expect(cheers.map((cheer) => cheer.text())).toEqual([
      'Bob is on a hot streak: Three Submissions, Three Acceptances!',
    ]);
    expect(cheers[0]?.find('.who .avatar').classes()).toContain('small');
    expect(page.find('.announcement').text()).toBe('Bob is on a hot streak: Three Submissions, Three Acceptances!');
    // The title in a cheer is a button that explains it, as the title on the player's own card is.
    expect(cheers[0]?.find('button').text()).toBe('Three Submissions, Three Acceptances');
    // The screen's cheers are bigger, with a bigger avatar, and nothing on them is a button.
    const notices = mountFor(null, streaks).find('.streak-notices');
    expect(notices.classes()).toContain('large');
    expect(notices.findAll('.cheer')).toHaveLength(1);
    expect(notices.find('.who .avatar').classes()).toContain('medium');
    expect(notices.find('button').exists()).toBe(false);
  });

  test('write the number in Chinese characters in Chinese', () => {
    const wrapper = mountFor('bob', [{ playerId: 'bob', kind: 'losses', length: 21, record: true }], 'zh');
    expect(wrapper.find('.title').text()).toBe('二十一投二十一拒');
    expect(wrapper.find('.record').text()).toBe(text('zh').streaks.record);
  });

  test('are nothing when there is nothing to tell, but the live region is there for when there is', () => {
    const wrapper = mountFor('ann', []);
    expect(wrapper.find('.streak-notices').exists()).toBe(false);
    expect(wrapper.find('.announcement').text()).toBe('');
  });
});
