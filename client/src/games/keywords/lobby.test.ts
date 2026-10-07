// @vitest-environment happy-dom
import type { KeywordsRoomData, RoomView } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import KeywordsLobby from './KeywordsLobby.vue';

const send = vi.hoisted(() => vi.fn<(event: string, payload?: object) => Promise<{ ok: boolean; fields?: [] }>>());
vi.mock('../../core/socket', () => ({ send }));

const global = () => ({ plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] });

const data: KeywordsRoomData = { seats: {}, keyViewers: [], startProblems: [], game: null };

const view = (me: string, screens: number): RoomView => ({
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
  data,
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

  test('starts the game with the number of games the room has started', async () => {
    const chair = mount(KeywordsLobby, { props: { room: view('ann', 0) }, global: global() });
    await flushPromises();
    await chair.find('.desk-actions .primary').trigger('click');
    expect(send).toHaveBeenCalledWith('room:start', { round: 2 });
  });
});
