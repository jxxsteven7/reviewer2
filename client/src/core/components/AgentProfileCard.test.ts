// @vitest-environment happy-dom
import type { AgentProfileView } from '@reviewer2/shared';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';
import AgentProfileCard from './AgentProfileCard.vue';

// Who the browser is, and the request the card makes.
const signedIn = vi.hoisted(() => ({
  account: { loaded: true, summary: null as { handle: string } | null, mail: false },
  request: vi.fn<(path: string, body?: object) => Promise<object>>(),
  loadAccount: vi.fn(),
}));
vi.mock('../account', async () => {
  const { reactive: wrap } = await import('vue');
  signedIn.account = wrap(signedIn.account);
  return signedIn;
});

const global = (locale: 'en' | 'zh' = 'en') => ({
  plugins: [createI18n({ legacy: false, locale, messages: { en, zh } })],
});

const page = (changes: Partial<AgentProfileView> = {}): AgentProfileView => ({
  persona: 'reviewer1',
  number: 0,
  live: { players: 4, rooms: 3 },
  games: 12,
  seats: 14,
  wins: 8,
  roles: { captain: { seats: 8, wins: 5 }, guesser: { seats: 6, wins: 3 } },
  clues: 30,
  found: 37,
  reviewer2: 2,
  takeovers: 5,
  best: { word: 'Zebra', found: 4 },
  you: null,
  ...changes,
});

// A card left mounted would read the page again when the next test signs the browser out.
enableAutoUnmount(afterEach);

describe('AgentProfileCard', () => {
  beforeEach(() => {
    signedIn.request.mockReset();
    signedIn.account.summary = null;
  });

  test('shows player number 0, its clones in the rooms and what it has done, to anyone', async () => {
    signedIn.request.mockResolvedValue({ ok: true, profile: page() });
    const wrapper = mount(AgentProfileCard, { props: { persona: 'reviewer1' }, global: global() });
    await flushPromises();
    expect(signedIn.request).toHaveBeenCalledWith('/api/agent/reviewer1');
    const text = wrapper.text();
    expect(text).toContain('Reviewer 1');
    expect(text).toContain('Player No. 0');
    expect(text).toContain('Clones in the rooms right now: 4 · Rooms: 3');
    // The games, and the share of its seats won, in all and in each role, over how many seats.
    expect(wrapper.findAll('.block').map((block) => block.findAll('dt, dd').map((cell) => cell.text()))).toEqual([
      ['Games', '12'],
      ['Win rate', '57%', '14 seats'],
      ['PI', '62%', '8 seats'],
      ['Student', '50%', '6 seats'],
    ]);
    expect(wrapper.find('.stat-blocks').classes()).not.toContain('roles');
    expect(text).toContain('Cards found per clue: 1.2');
    expect(text).toContain('Best clue: “Zebra”, 4 cards found');
    expect(text).toContain('Times it revealed Reviewer 2: 2');
    expect(text).toContain('Games in which it played for someone offline: 5');
    // A guest has nothing of their own with it.
    expect(wrapper.find('.you').exists()).toBe(false);
  });

  test('says how many cards its best clue found, one or more', async () => {
    signedIn.request.mockResolvedValue({ ok: true, profile: page({ best: { word: 'Quokka', found: 1 } }) });
    const wrapper = mount(AgentProfileCard, { props: { persona: 'reviewer1' }, global: global() });
    await flushPromises();
    expect(wrapper.text()).toContain('Best clue: “Quokka”, 1 card found');
  });

  test('says when it is in no room and has played no game yet', async () => {
    const empty = page({
      live: { players: 0, rooms: 0 },
      games: 0,
      seats: 0,
      wins: 0,
      roles: { captain: { seats: 0, wins: 0 }, guesser: { seats: 0, wins: 0 } },
      clues: 0,
      found: 0,
      reviewer2: 0,
      takeovers: 0,
      best: null,
    });
    signedIn.request.mockResolvedValue({ ok: true, profile: empty });
    const wrapper = mount(AgentProfileCard, { props: { persona: 'reviewer1' }, global: global() });
    await flushPromises();
    expect(wrapper.text()).toContain('No clones in the rooms right now');
    expect(wrapper.text()).toContain('No game with it has finished yet.');
    expect(wrapper.find('.stats').exists()).toBe(false);
    expect(wrapper.find('.block').exists()).toBe(false);
  });

  test('shows an account what it has played with it, apart, in Chinese too', async () => {
    signedIn.account.summary = { handle: 'a1b2c3d4e5f6' };
    const you = { wonTogether: 2, lostTogether: 1, beat: 0, beaten: 3, takenOver: 1 };
    signedIn.request.mockResolvedValue({ ok: true, profile: page({ you }) });
    const wrapper = mount(AgentProfileCard, { props: { persona: 'reviewer1' }, global: global('zh') });
    await flushPromises();
    const mine = wrapper.find('.you');
    expect(mine.text()).toContain('你和 一号审稿人');
    expect(mine.text()).toContain('同组：赢 2 局，输 1 局');
    expect(mine.text()).toContain('对阵：你赢 0 局，输 3 局');
    expect(mine.text()).toContain('替你托管：1 局');
    expect(wrapper.text()).toContain('最得意的线索：「Zebra」，翻对 4 张');
    expect(wrapper.findAll('.block')[1]?.text()).toBe('总胜率57%14 次');
  });

  test('shows why it could not be read', async () => {
    signedIn.request.mockResolvedValue({ ok: false, error: 'no_such_profile' });
    const wrapper = mount(AgentProfileCard, { props: { persona: 'reviewer1' }, global: global() });
    await flushPromises();
    expect(wrapper.find('.hint').text()).not.toBe('');
    expect(wrapper.find('.head').exists()).toBe(false);
  });
});
