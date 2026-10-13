// @vitest-environment happy-dom
import type { PlayerView, RoomView } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';
import en from '../../locales/en.json';
import { muted, setMuted } from '../sound';
import RoomMenu from './RoomMenu.vue';

const send = vi.hoisted(() => vi.fn<(event: string, payload?: object) => Promise<{ ok: boolean }>>());
vi.mock('../socket', () => ({
  send,
  act: (event: string, payload: object = {}) => send(event, payload),
  connect: vi.fn(),
  onceConnected: (run: () => void) => {
    run();
    return () => {};
  },
  socket: { connected: true, on: vi.fn(), off: vi.fn(), once: vi.fn() },
}));
vi.mock('../room', () => ({ closeRoom: vi.fn(), leaveRoom: vi.fn() }));
// A guest.
vi.mock('../account', async () => {
  const { reactive } = await import('vue');
  return { account: reactive({ loaded: true, summary: null, mail: false }) };
});

const ann: PlayerView = { id: 'ann', name: 'Ann', online: true };
const room = {
  roomId: 'room-1',
  code: 'K7QX',
  rev: 1,
  game: 'keywords',
  language: 'en',
  fields: ['general'],
  public: false,
  customWordCount: 0,
  phase: 'lobby',
  round: 1,
  gameId: null,
  chairId: 'ann',
  players: [ann, { id: 'bob', name: 'Bob', online: true }],
  screens: 0,
  me: 'ann',
  match: null,
  streaks: [],
  data: {},
} as unknown as RoomView;

// The sheets are teleported to the body; rendering them in place keeps them inside the wrapper.
const global = () => ({
  plugins: [
    createI18n({ legacy: false, locale: 'en', messages: { en } }),
    createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:path(.*)*', component: { render: () => null } }],
    }),
  ],
  stubs: { teleport: true },
});

async function opened() {
  const wrapper = mount(RoomMenu, { props: { room, me: ann }, global: global(), attachTo: document.body });
  await wrapper.get('.room-button').trigger('click');
  await nextTick();
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ ok: true });
  setMuted(false);
});

describe('RoomMenu', () => {
  // The switch is the one the quick reactions offer: one setting, kept by the browser.
  test('has the switch for the sounds above the way to leave, and opens with the focus past it', async () => {
    const wrapper = await opened();
    const menu = wrapper.get('.room-menu');
    const items = menu.findAll(':scope > *');
    const toggle = items.findIndex((item) => item.classes().includes('sound-toggle'));
    const leave = items.findIndex((item) => item.text() === 'Leave the room');
    expect(toggle).toBeGreaterThan(-1);
    expect(leave).toBe(toggle + 1);
    expect(document.activeElement?.getAttribute('role')).toBe('dialog');

    const box = menu.get('.sound-toggle input');
    expect((box.element as HTMLInputElement).checked).toBe(false);
    await box.setValue(true);
    expect(muted.value).toBe(true);
    // Switched off elsewhere, such as in the quick reactions' sheet, it is off here too.
    setMuted(false);
    await nextTick();
    expect((box.element as HTMLInputElement).checked).toBe(false);
    wrapper.unmount();
  });
});
