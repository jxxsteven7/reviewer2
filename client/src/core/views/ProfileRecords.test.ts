// @vitest-environment happy-dom
import {
  ACCOUNT_API,
  type GameRecord,
  type GameRecords,
  type RecordsView,
  type WordsSetRecord,
} from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { request } from '../account';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';
import ProfileRecords from './ProfileRecords.vue';

// The account's record, a line for each of its latest games, and for each of the latest games whose
// words it set (docs/architecture.md#accounts).

vi.mock('../account', () => ({ request: vi.fn() }));
vi.mock('../toast', () => ({ toast: vi.fn(), toastError: vi.fn() }));

const game = (gameId: string, more: Partial<GameRecord> = {}): GameRecord => ({
  game: 'keywords',
  gameId,
  endedAt: '2026-10-15T13:40:00.000Z',
  side: 'red',
  role: 'guesser',
  winner: 'red',
  result: 'won',
  place: 1,
  verdict: 'oral',
  match: null,
  agents: false,
  ...more,
});

const records: RecordsView = {
  keywords: {
    ordinary: { games: 2, wins: 2 },
    inMatches: { games: 1, wins: 1 },
    roles: { captain: { games: 1, wins: 0 }, guesser: { games: 2, wins: 2 } },
    matches: { played: 0, won: 0, recent: [] },
    recent: [
      game('with-ai', { agents: true, side: 'blue', role: 'captain', verdict: 'deskReject', result: 'lost', place: 2 }),
      game('in-match', { match: { game: 2, games: 3 } }),
      game('ordinary'),
    ],
  },
};

// A game of the second game whose words the account set, the students' term first.
const wordsSet = (gameId: string, more: Partial<WordsSetRecord> = {}): WordsSetRecord => ({
  game: 'impostor',
  gameId,
  endedAt: '2026-10-22T02:40:00.000Z',
  words: ['Journal', 'Conference'],
  good: 2,
  rated: 3,
  ...more,
});

// The record of the second game, of an account that played a game of it, and set the words of
// these games, if any.
const impostor = (set: WordsSetRecord[] = []): GameRecords => ({
  ordinary: { games: 1, wins: 1 },
  inMatches: { games: 0, wins: 0 },
  roles: { student: { games: 1, wins: 1 } },
  matches: { played: 0, won: 0, recent: [] },
  recent: [game('played', { game: 'impostor', side: 'student', role: 'student', winner: 'student', verdict: 'alive' })],
  ...(set.length > 0 ? { wordsSet: { games: set.length, good: 2 }, wordsSetRecent: set } : {}),
});

const sheet = () => document.body.querySelector('[role=dialog]');

async function mountRecords(locale: 'en' | 'zh' = 'en', view: RecordsView = records) {
  vi.mocked(request).mockResolvedValue({ ok: true, records: view } as never);
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

  test('lists the games whose words the account set after its games, with how many liked them and the words', async () => {
    const set = [
      wordsSet('set-2'),
      wordsSet('set-1', { endedAt: '2026-10-21T12:12:00.000Z', words: ['Cilia', 'Flagella'], good: 0, rated: 0 }),
    ];
    const wrapper = await mountRecords('en', { ...records, impostor: impostor(set) });
    // Under the first game's tab, there is no such list.
    expect(wrapper.find('.words-set').exists()).toBe(false);
    await wrapper.find('input[value="impostor"]').setValue(true);
    expect(wrapper.findAll('h3').map((heading) => heading.text())).toEqual(['The last 20 games', 'Pairs you set']);
    const rows = wrapper.findAll('.words-set .record');
    expect(rows.map((row) => row.find('.tag').text())).toEqual(['Liked 2/3', 'No ratings']);
    // The words as the setter gave them, the students' first.
    expect(rows.map((row) => row.find('.words').text())).toEqual(['Journal / Conference', 'Cilia / Flagella']);
    // No role, decision or count of players on the line.
    expect(rows[0]?.find('.role').exists()).toBe(false);
    expect(rows[0]?.find('.verdict').exists()).toBe(false);
    // Its button asks for the game to watch it again.
    vi.mocked(request).mockResolvedValueOnce({ ok: false, error: 'no_replay' } as never);
    await rows[0]?.find('button.watch').trigger('click');
    expect(request).toHaveBeenLastCalledWith(ACCOUNT_API.replay, { gameId: 'set-2' });
  });

  test('says the same of them in Chinese', async () => {
    const set = [wordsSet('set-2', { words: ['挂科', '及格'] }), wordsSet('set-1', { good: 0, rated: 0 })];
    const wrapper = await mountRecords('zh', { impostor: impostor(set) });
    await wrapper.find('input[value="impostor"]').setValue(true);
    expect(wrapper.findAll('h3').map((heading) => heading.text())).toEqual(['最近 20 局', '出过的题']);
    const rows = wrapper.findAll('.words-set .record');
    expect(rows.map((row) => row.find('.tag').text())).toEqual(['好评 2/3', '没人评']);
    expect(rows[0]?.find('.words').text()).toBe('挂科 / 及格');
  });

  test('has no such list for an account that has set the words of no game', async () => {
    const wrapper = await mountRecords('en', { impostor: impostor() });
    await wrapper.find('input[value="impostor"]').setValue(true);
    expect(wrapper.find('.games .record').exists()).toBe(true);
    expect(wrapper.find('.words-set').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Pairs you set');
  });
});
