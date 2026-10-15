// @vitest-environment happy-dom
import type { MatchView, RoomView, StandingView } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';
import MatchResults from './MatchResults.vue';
import MatchTable from './MatchTable.vue';

const act = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('../socket', () => ({ act }));

const global = (locale: 'en' | 'zh' = 'en') => ({
  plugins: [createI18n({ legacy: false, locale, messages: { en, zh } })],
  stubs: { teleport: true },
});

const line = (name: string, overrides: Partial<StandingView> = {}): StandingView => ({
  playerId: name.toLowerCase(),
  name,
  total: 0,
  delta: null,
  games: 1,
  rank: 1,
  left: false,
  ...overrides,
});

function room(match: Partial<MatchView>, overrides: Partial<RoomView> = {}): RoomView {
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
    phase: 'ended',
    round: 1,
    gameId: 'g1',
    chairId: 'ann',
    players: [],
    agents: false,
    screens: 0,
    me: 'ann',
    match: {
      id: 'm1',
      rules: { games: 3, teams: 'fixed', grouping: 'random' },
      played: 1,
      status: 'on',
      game: 1,
      standings: [],
      ...match,
    },
    streaks: [],
    duos: [],
    agentsPlayed: false,
    points: [],
    data: {},
    ...overrides,
  };
}

beforeEach(() => act.mockClear());

describe('the table of a match', () => {
  const standings = [
    line('Ann', { total: 7, delta: 4, rank: 1, detail: { found: 1, won: true } }),
    line('Bob', { total: -2, delta: -3, rank: 2 }),
    line('Cat', { total: 0, delta: null, rank: null, left: true, playerId: null }),
  ];

  test('shows the game, and each player with their place, total and points, with no heading over the first two', () => {
    const wrapper = mount(MatchTable, { props: { room: room({ standings, game: 2 }) }, global: global() });
    expect(wrapper.text()).toContain('Game 2 of 3');
    const rows = wrapper.findAll('tbody tr').map((row) => row.findAll('td').map((cell) => cell.text()));
    expect(rows).toEqual([
      ['1', 'Annyou', '7', '+4'],
      ['2', 'Bob', '\u22122', '\u22123'],
      ['\u2013', 'Catleft', '0', '\u2013'],
    ]);
    // The viewer's line is yellow, and says "you" to a screen reader alone.
    expect(wrapper.find('tbody tr').classes()).toContain('me');
    expect(wrapper.find('tbody tr .sr-only').text()).toBe('you');
    // The place and the player have headings for a screen reader alone, and this game's points a
    // short one, which a screen reader hears whole.
    const heads = wrapper.findAll('thead th');
    expect(heads.slice(0, 2).map((head) => head.find('.sr-only').text())).toEqual(['Place', 'Player']);
    expect(heads.at(3)?.text()).toBe('This');
    expect(heads.at(3)?.attributes('aria-label')).toBe('This game');
  });

  test('calls the points those of the last game in the waiting room', () => {
    const wrapper = mount(MatchTable, { props: { room: room({ standings }, { phase: 'lobby' }) }, global: global() });
    expect(wrapper.findAll('thead th').at(3)?.text()).toBe('Last');
    expect(wrapper.findAll('thead th').at(3)?.attributes('aria-label')).toBe('Last game');
  });

  test('says where the points came from when the game describes them', () => {
    const describe = (detail: unknown) => JSON.stringify(detail);
    const wrapper = mount(MatchTable, { props: { room: room({ standings }), describe }, global: global() });
    // Once on the name's line, for a wide table, and once under it, for a narrow one.
    expect(wrapper.findAll('.detail.below').map((detail) => detail.text())).toEqual(['{"found":1,"won":true}']);
    expect(wrapper.findAll('.detail.inline').map((detail) => detail.text())).toEqual(['{"found":1,"won":true}']);
  });

  test('puts the titles that the game brought each player on their line', () => {
    const titlesOf = (id: string) =>
      id === 'ann'
        ? [
            { title: 'deadline_hero' as const, count: 2 },
            { title: 'opening_record' as const, count: 1 },
          ]
        : [];
    const wrapper = mount(MatchTable, { props: { room: room({ standings }), titlesOf }, global: global() });
    const pills = () =>
      wrapper.findAll('tbody tr').map((row) => row.findAll('.title-line > .pill').map((pill) => pill.text()));
    // A browser that lays nothing out shows them all.
    expect(pills()).toEqual([['Deadline Hero \u00d72', 'Opened the Scoring'], [], []]);
    expect(wrapper.find('.title-line > button.more').exists()).toBe(false);
  });

  test('says who will be listed while nobody is', () => {
    const wrapper = mount(MatchTable, { props: { room: room({}) }, global: global('zh') });
    expect(wrapper.text()).toContain('\u7b2c 1 / 3 \u5c40');
    expect(wrapper.find('table').exists()).toBe(false);
  });

  test('gives every name its whole as a title, for where a narrow column cuts it short', () => {
    const wrapper = mount(MatchTable, {
      props: { room: room({ standings: [line('Bartholomew Longname')] }) },
      global: global(),
    });
    const name = wrapper.get('tbody .name');
    expect(name.text()).toBe('Bartholomew Longname');
    expect(name.attributes('title')).toBe('Bartholomew Longname');
  });

  test("lets the chair alone end the match, once they've confirmed", async () => {
    const player = mount(MatchTable, { props: { room: room({ standings }, { me: 'bob' }) }, global: global() });
    expect(player.text()).not.toContain('End the match');
    const chair = mount(MatchTable, { props: { room: room({ standings }) }, global: global() });
    await chair.get('.end button').trigger('click');
    const confirm = chair.findAll('button').find((button) => button.classes().includes('danger'));
    await confirm?.trigger('click');
    await flushPromises();
    expect(act).toHaveBeenCalledWith('room:matchEnd', { matchId: 'm1' });
    const over = mount(MatchTable, { props: { room: room({ standings, status: 'over' }) }, global: global() });
    expect(over.text()).not.toContain('End the match');
    // Where the game puts the button elsewhere, the table has none.
    const elsewhere = mount(MatchTable, { props: { room: room({ standings }), endable: false }, global: global() });
    expect(elsewhere.text()).not.toContain('End the match');
  });
});

describe('the ranking of a match', () => {
  const standings = [
    line('Ann', { total: 9, rank: 1, title: 'best_paper' }),
    line('Bob', { total: 9, rank: 1, title: 'best_paper' }),
    line('Cat', { total: 2, rank: 3 }),
    line('Dan', { total: -4, rank: 4, title: 'black_hole' }),
    line('Eve', { total: 6, rank: null, left: true, playerId: null }),
  ];

  test('shows the titles, with the line for Academic Trash', () => {
    const wrapper = mount(MatchResults, {
      props: { room: room({ standings, status: 'over', played: 3, game: 3 }) },
      global: global(),
    });
    expect(wrapper.get('h2').text()).toBe('Final ranking');
    expect(wrapper.text()).toContain('Games played: 3 of 3');
    const items = wrapper.findAll('li');
    expect(items.map((item) => item.get('.rank').text())).toEqual(['1', '1', '3', '4', '\u2013']);
    expect(items.at(0)?.text()).toContain('Best Paper Award');
    expect(items.at(3)?.text()).toContain('Academic Trash');
    expect(items.at(3)?.text()).toContain('Playing like that, your paper is probably getting rejected!');
    expect(items.at(4)?.text()).toContain('left');
    expect(items.at(3)?.get('.total').text()).toBe('\u22124');
    // Every line's avatar is as large, with a title or without.
    expect(items.map((item) => item.get('.avatar').classes('medium'))).toEqual([true, true, true, true, true]);
  });

  test('says in Chinese what Academic Trash will hear', () => {
    const wrapper = mount(MatchResults, {
      props: { room: room({ standings, status: 'over', played: 3, game: 3 }) },
      global: global('zh'),
    });
    expect(wrapper.text()).toContain('\u5b66\u672f\u5783\u573e');
    expect(wrapper.text()).toContain('\u4f60\u8fd9\u4e48\u83dc\uff0c\u591a\u534a\u4f1a\u88ab\u62d2\u7a3f\u5427\uff01');
  });

  test('says that a match that was ended early awarded nothing', () => {
    const plain = standings.map((standing) => ({ ...standing, title: undefined }));
    const wrapper = mount(MatchResults, {
      props: { room: room({ standings: plain, status: 'stopped' }) },
      global: global(),
    });
    expect(wrapper.get('h2').text()).toBe('The match was ended early');
    expect(wrapper.text()).toContain('Games played: 1 of 3');
    expect(wrapper.text()).toContain('no titles were awarded');
    expect(wrapper.find('.title').exists()).toBe(false);
    // Also before any game was scored.
    const early = mount(MatchResults, {
      props: { room: room({ standings: [], status: 'stopped', played: 0 }) },
      global: global(),
    });
    expect(early.text()).toContain('Games played: 0 of 3');
  });

  test('lets the chair start another match with rules they may change, or go back to an ordinary room', async () => {
    const over = room({ standings, status: 'over' });
    const player = mount(MatchResults, { props: { room: { ...over, me: 'bob' } }, global: global() });
    expect(player.text()).toContain('Waiting for the chair');
    expect(player.find('.actions').exists()).toBe(false);

    const chair = mount(MatchResults, { props: { room: over }, global: global() });
    const [again, ordinary] = chair.findAll('.actions button');
    await ordinary?.trigger('click');
    await flushPromises();
    expect(act).toHaveBeenLastCalledWith('room:matchNext', { matchId: 'm1', match: null });

    await again?.trigger('click');
    const form = chair.get('form.again');
    expect(form.get<HTMLInputElement>('input[inputmode="numeric"]').element.value).toBe('3');
    await form.get('input[inputmode="numeric"]').setValue('2');
    await form.trigger('submit');
    await flushPromises();
    expect(act).toHaveBeenLastCalledWith('room:matchNext', {
      matchId: 'm1',
      match: { games: 2, teams: 'fixed', grouping: 'random' },
    });
  });
});
