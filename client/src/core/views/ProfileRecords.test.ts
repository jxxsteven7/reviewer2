// @vitest-environment happy-dom
import type { GameRecord, RecordsView } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { request } from '../account';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';
import ProfileRecords from './ProfileRecords.vue';

// The account's record, a line for each of its latest games (docs/architecture.md#accounts).

vi.mock('../account', () => ({ request: vi.fn() }));
vi.mock('../toast', () => ({ toast: vi.fn(), toastError: vi.fn() }));

const game = (gameId: string, more: Partial<GameRecord> = {}): GameRecord => ({
  game: 'keywords',
  gameId,
  endedAt: '2026-10-15T13:40:00.000Z',
  replay: true,
  side: 'red',
  role: 'guesser',
  winner: 'red',
  won: true,
  verdict: 'oral',
  match: null,
  agents: false,
  ...more,
});

const records: RecordsView = {
  ordinary: { games: 2, wins: 2 },
  inMatches: { games: 1, wins: 1 },
  roles: { captain: { games: 1, wins: 0 }, guesser: { games: 2, wins: 2 } },
  matches: { played: 0, won: 0, recent: [] },
  recent: [
    game('with-ai', { agents: true, side: 'blue', role: 'captain', verdict: 'deskReject', won: false }),
    game('in-match', { match: { game: 2, games: 3 } }),
    game('ordinary'),
  ],
};

const sheet = () => document.body.querySelector('[role=dialog]');

async function mountRecords(locale: 'en' | 'zh' = 'en') {
  vi.mocked(request).mockResolvedValue({ ok: true, records } as never);
  const wrapper = mount(ProfileRecords, {
    global: { plugins: [createI18n({ legacy: false, locale, messages: { en, zh } })] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ProfileRecords', () => {
  test('marks a game that an AI played in with the robot and "AI" in place of its tag, which a tap explains', async () => {
    const wrapper = await mountRecords();
    const [ai, inMatch, ordinary] = wrapper.findAll('.games .record');
    expect(inMatch?.find('.tag').text()).toBe('Match 2/3');
    expect(ordinary?.find('.tag').text()).toBe('Ordinary');
    expect(ordinary?.find('.agent-icon').exists()).toBe(false);
    // The AI game: the robot's head and "AI", no "Ordinary", and in words for a screen reader.
    const tag = ai?.find('button.tag');
    expect(tag?.find('.agent-icon').exists()).toBe(true);
    expect(tag?.find('span[aria-hidden=true]').text()).toBe('AI');
    expect(tag?.find('.sr-only').text()).toBe('AI played in it: no points');
    expect(ai?.text()).not.toContain('Ordinary');
    expect(tag?.attributes('aria-haspopup')).toBe('dialog');
    await tag?.trigger('click');
    expect(sheet()?.querySelector('h2')?.textContent).toBe('A game with AI');
    expect(sheet()?.textContent).toContain('An AI played in this game, as a player or for someone who was offline.');
    expect(sheet()?.textContent).toContain(
      'A game that an AI plays in brings nobody points, a streak, a title or a friend title.',
    );
    // The rest of the line is as for any game.
    expect(ai?.find('.verdict').text()).toBe('Desk Reject');
    expect(ai?.find('button.watch').exists()).toBe(true);
  });

  test('says the same in Chinese', async () => {
    const wrapper = await mountRecords('zh');
    const tag = wrapper.find('.games .record button.tag');
    expect(tag.find('.sr-only').text()).toBe('这局有 AI，不计积分');
    await tag.trigger('click');
    expect(sheet()?.querySelector('h2')?.textContent).toBe('有 AI 的对局');
    expect(sheet()?.textContent).toContain('这局有 AI 玩家，或有 AI 替掉线的人玩过。');
    expect(sheet()?.textContent).toContain('有 AI 参与的局不加学术积分，也不算连胜、称号和好友称号。');
  });
});
