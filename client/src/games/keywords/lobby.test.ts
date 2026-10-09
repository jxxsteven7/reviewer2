// @vitest-environment happy-dom
import { defaultSettings, type KeywordsRoomData, type RoomView } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import KeywordsLobby from './KeywordsLobby.vue';

const send = vi.hoisted(() => vi.fn<(event: string, payload?: object) => Promise<{ ok: boolean; fields?: [] }>>());
vi.mock('../../core/socket', () => ({
  send,
  act: (event: string, payload: object = {}) => send(event, payload),
  connect: vi.fn(),
  socket: { connected: true, on: vi.fn(), once: vi.fn() },
}));

const global = () => ({ plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] });

const data: KeywordsRoomData = {
  settings: defaultSettings('en'),
  seats: {},
  keyViewers: [],
  side: null,
  startProblems: [],
  game: null,
};

const view = (me: string, screens: number, settings = data.settings): RoomView => ({
  roomId: 'room-1',
  code: 'K7QX',
  rev: 1,
  game: 'keywords',
  language: 'en',
  fields: ['general'],
  phase: 'lobby',
  round: 2,
  gameId: null,
  chairId: 'ann',
  players: [
    { id: 'ann', name: 'Ann', online: true },
    { id: 'bob', name: 'Bob', online: true },
  ],
  screens,
  me,
  data: { ...data, settings },
});

describe('KeywordsLobby', () => {
  beforeEach(() => {
    send.mockReset();
    send.mockImplementation(async (event) => (event === 'meta:fields' ? { ok: true, fields: [] } : { ok: true }));
  });

  test('tells everyone how many screens show the room, and lets the chair send them away', async () => {
    const chair = mount(KeywordsLobby, { props: { room: view('ann', 2) }, global: global() });
    expect(chair.find('.screens').text()).toContain('Big screens showing this room: 2.');
    await chair.find('.screens button').trigger('click');
    expect(send).toHaveBeenCalledWith('room:dismiss', {});

    const player = mount(KeywordsLobby, { props: { room: view('bob', 2) }, global: global() });
    expect(player.find('.screens').text()).toContain('2');
    expect(player.find('.screens button').exists()).toBe(false);

    const none = mount(KeywordsLobby, { props: { room: view('ann', 0) }, global: global() });
    expect(none.find('.screens').exists()).toBe(false);
  });

  test('shows everyone but the chair the settings, and lets the chair change them with the word lists', async () => {
    const player = mount(KeywordsLobby, { props: { room: view('bob', 0) }, global: global() });
    expect(player.find('.settings-form').exists()).toBe(false);
    expect(player.get('.settings-summary').text()).toContain('Free');

    const chair = mount(KeywordsLobby, { props: { room: view('ann', 0) }, global: global() });
    await flushPromises();
    expect(chair.find('.settings-summary').exists()).toBe(false);
    expect(chair.find('.save').exists()).toBe(false);
    await chair.find('.settings-form input[value="loose"]').setValue(true);
    // Another player's snapshot leaves the chair's unsaved choice alone.
    await chair.setProps({ room: { ...view('ann', 1) } });
    await chair.get('.save button').trigger('click');
    expect(send).toHaveBeenCalledWith('room:settings', {
      fields: ['general'],
      settings: { ...defaultSettings('en'), clueRule: 'loose' },
    });
    // Once the room has the settings, there is nothing left to save.
    await chair.setProps({ room: view('ann', 1, { ...defaultSettings('en'), clueRule: 'loose' }) });
    expect(chair.find('.save').exists()).toBe(false);
  });

  test('keeps the save and the start buttons off while a setting is wrong', async () => {
    const chair = mount(KeywordsLobby, { props: { room: view('ann', 0) }, global: global() });
    await flushPromises();
    await chair.findAll('.settings-form input[inputmode="numeric"]')[1]?.setValue('5');
    expect(chair.get('.save button').attributes('disabled')).toBeDefined();
    expect(chair.get('.desk-actions .primary').attributes('disabled')).toBeDefined();
  });

  test('starts the game with the number of games the room has started', async () => {
    const chair = mount(KeywordsLobby, { props: { room: view('ann', 0) }, global: global() });
    await flushPromises();
    await chair.find('.desk-actions .primary').trigger('click');
    expect(send).toHaveBeenCalledWith('room:start', { round: 2 });
    expect(send).not.toHaveBeenCalledWith('room:settings', expect.anything());
  });

  test('saves what the chair has changed at the desk before starting the game', async () => {
    const chair = mount(KeywordsLobby, { props: { room: view('ann', 0) }, global: global() });
    await flushPromises();
    await chair.find('.settings-form input[value="standard"]').setValue(true);
    expect(chair.get('.save .hint').text()).toBe('Starting the game saves these as well.');
    await chair.find('.desk-actions .primary').trigger('click');
    await flushPromises();
    expect(send.mock.calls.filter(([event]) => event !== 'meta:fields')).toEqual([
      ['room:settings', { fields: ['general'], settings: { ...defaultSettings('en'), guessRule: 'standard' } }],
      ['room:start', { round: 2 }],
    ]);
  });

  test("doesn't start the game when the server refuses what the chair changed", async () => {
    send.mockImplementation(async (event) => (event === 'room:settings' ? { ok: false } : { ok: true, fields: [] }));
    const chair = mount(KeywordsLobby, { props: { room: view('ann', 0) }, global: global() });
    await flushPromises();
    await chair.find('.settings-form input[value="standard"]').setValue(true);
    await chair.find('.desk-actions .primary').trigger('click');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('room:settings', expect.anything());
    expect(send).not.toHaveBeenCalledWith('room:start', expect.anything());
  });
});
