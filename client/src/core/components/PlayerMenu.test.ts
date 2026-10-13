// @vitest-environment happy-dom
import type { RoomView } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import PlayerMenu from './PlayerMenu.vue';

const send = vi.hoisted(() =>
  vi.fn<(event: string, payload?: object) => Promise<{ ok: boolean; error?: string; status?: string }>>(),
);
vi.mock('../socket', () => ({
  send,
  act: (event: string, payload: object = {}) => send(event, payload),
  connect: vi.fn(),
  onceConnected: vi.fn(),
  whenConnected: vi.fn(async () => true),
  socket: { connected: false, on: vi.fn() },
}));
// Who the browser is, and the request that the player's page in the sheet makes for the profile.
const signedIn = vi.hoisted(() => ({
  account: { loaded: true, summary: null as object | null, mail: false },
  request: vi.fn<(path: string, body?: object) => Promise<object>>(),
  loadAccount: vi.fn(),
}));
vi.mock('../account', () => signedIn);

const global = () => ({ plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] });
const bob = { id: 'bob', name: 'Bob', online: true };

const view = (me: string, isPublic: boolean): RoomView => ({
  roomId: 'room-1',
  code: 'K7QX',
  rev: 1,
  game: 'keywords',
  language: 'en',
  fields: ['general'],
  public: isPublic,
  customWordCount: 0,
  phase: 'lobby',
  round: 0,
  gameId: null,
  chairId: 'ann',
  players: [{ id: 'ann', name: 'Ann', online: true }, bob],
  screens: 0,
  me,
  match: null,
  streaks: [],
  duos: [],
  data: {},
});

// The sheets are teleported to the body.
const dialogs = () => [...document.querySelectorAll<HTMLElement>('[role=dialog]')];
const buttons = () => dialogs().flatMap((dialog) => [...dialog.querySelectorAll<HTMLButtonElement>('button')]);
const button = (text: string) => {
  const found = buttons().find((element) => element.textContent?.trim() === text);
  if (!found)
    throw new Error(
      `no button "${text}" among ${buttons()
        .map((b) => b.textContent?.trim())
        .join(', ')}`,
    );
  return found;
};

describe('PlayerMenu', () => {
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({ ok: true });
    signedIn.account.summary = null;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('removes a player only after the chair has confirmed it, saying for how long', async () => {
    // From a public room, for good.
    const listed = mount(PlayerMenu, { props: { player: bob, room: view('ann', true) }, global: global() });
    button('Remove from the room').click();
    await flushPromises();
    expect(dialogs()[0]?.textContent).toContain("Remove Bob from the room? They won't be able to come back to it.");
    listed.unmount();

    // From a private room, for two minutes.
    const wrapper = mount(PlayerMenu, { props: { player: bob, room: view('ann', false) }, global: global() });
    expect(dialogs()[0]?.textContent).toContain('Bob');
    button('Remove from the room').click();
    await flushPromises();
    expect(send).not.toHaveBeenCalled();
    expect(dialogs()[0]?.textContent).toContain('Remove Bob from the room? They can come back in two minutes.');
    button('Cancel').click();
    await flushPromises();
    expect(dialogs()[0]?.textContent).not.toContain('Remove Bob from the room?');
    button('Remove from the room').click();
    await flushPromises();
    button('Remove from the room').click();
    await flushPromises();
    expect(send).toHaveBeenCalledWith('room:remove', { playerId: 'bob' });
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  test('offers a report in a public room to a player with an account, and sends it with the note', async () => {
    signedIn.account.summary = { username: 'Ann', avatar: null };
    const wrapper = mount(PlayerMenu, { props: { player: bob, room: view('cat', true) }, global: global() });
    // Not the chair: no chair's actions.
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(['×', 'Report to the operator', 'Cancel']);
    button('Report to the operator').click();
    await flushPromises();
    expect(dialogs()[0]?.textContent).toContain('Report Bob');
    const note = dialogs()[0]?.querySelector('textarea') as HTMLTextAreaElement;
    note.value = '  Rude clues  ';
    note.dispatchEvent(new Event('input'));
    await flushPromises();
    button('Send the report').click();
    await flushPromises();
    expect(send).toHaveBeenCalledWith('room:report', { playerId: 'bob', text: 'Rude clues' });
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  test('offers an account to ask a player with an account to be friends, and says how it went', async () => {
    signedIn.account.summary = { username: 'Ann', avatar: null };
    const ranked = { ...bob, rank: 'phd' as const };
    send.mockResolvedValue({ ok: true, status: 'pending' });
    const wrapper = mount(PlayerMenu, { props: { player: ranked, room: view('cat', false) }, global: global() });
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(['×', 'Add friend', 'Cancel']);
    button('Add friend').click();
    await flushPromises();
    expect(send).toHaveBeenCalledWith('friends:request', { playerId: 'bob' });
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
    // Not to a guest, who has no rank, and not by a guest.
    const guest = mount(PlayerMenu, { props: { player: bob, room: view('cat', false) }, global: global() });
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(['×', 'Cancel']);
    guest.unmount();
    signedIn.account.summary = null;
    const asGuest = mount(PlayerMenu, { props: { player: ranked, room: view('cat', false) }, global: global() });
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(['×', 'Cancel']);
    asGuest.unmount();
  });

  test('opens the page of a player with an account in a sheet, for anyone, and stays in the room', async () => {
    const withPage = { ...bob, rank: 'phd' as const, handle: 'a1b2c3d4e5f6' };
    signedIn.request.mockResolvedValue({
      ok: true,
      profile: {
        id: 7,
        handle: 'a1b2c3d4e5f6',
        username: 'Bob',
        avatar: null,
        rank: 'phd',
        createdAt: '2026-10-01T00:00:00.000Z',
        titles: [],
        streaks: { wins: 0, losses: 0 },
        link: 'https://bob.example/',
        bio: 'Hi <b>there</b>',
        record: null,
        acknowledgments: null,
        likes: 2,
        liked: false,
        mine: false,
      },
    });
    // A guest sees the page, and nothing else to do with the player.
    const wrapper = mount(PlayerMenu, { props: { player: withPage, room: view('cat', false) }, global: global() });
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(['×', 'View their page', 'Cancel']);
    button('View their page').click();
    await flushPromises();
    expect(signedIn.request).toHaveBeenCalledWith('/api/profile/a1b2c3d4e5f6');
    const sheet = dialogs()[0] as HTMLElement;
    expect(sheet.textContent).toContain('Player No. 7');
    expect(sheet.textContent).toContain('Hi <b>there</b>');
    expect(sheet.querySelector('.bio b')).toBeNull();
    expect(sheet.querySelector<HTMLAnchorElement>('a.link')?.getAttribute('rel')).toBe('nofollow ugc noopener');
    expect(sheet.textContent).toContain('♥ 2');
    expect(sheet.querySelector('button[aria-pressed]')).toBeNull();
    expect(wrapper.emitted('close')).toBeUndefined();
    wrapper.unmount();
    // Not for a guest player, who has no page.
    const guest = mount(PlayerMenu, { props: { player: bob, room: view('cat', false) }, global: global() });
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(['×', 'Cancel']);
    guest.unmount();
  });

  test('shows what the server had against a report, and offers none to guests or in private rooms', async () => {
    signedIn.account.summary = { username: 'Ann', avatar: null };
    send.mockResolvedValue({ ok: false, error: 'report_limited' });
    const wrapper = mount(PlayerMenu, { props: { player: bob, room: view('ann', true) }, global: global() });
    button('Report to the operator').click();
    await flushPromises();
    button('Send the report').click();
    await flushPromises();
    expect(dialogs()[0]?.querySelector('[role=alert]')?.textContent).toContain('5 reports in the last hour');
    expect(wrapper.emitted('close')).toBeUndefined();
    wrapper.unmount();

    // The chair of a private room has their actions, and no report.
    const chair = mount(PlayerMenu, { props: { player: bob, room: view('ann', false) }, global: global() });
    expect(buttons().map((b) => b.textContent?.trim())).toEqual([
      '×',
      'Move to the spectators',
      'Make chair',
      'Remove from the room',
      'Cancel',
    ]);
    chair.unmount();
    // A guest in a public room has nothing to do with another player.
    signedIn.account.summary = null;
    const guest = mount(PlayerMenu, { props: { player: bob, room: view('cat', true) }, global: global() });
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(['×', 'Cancel']);
    guest.unmount();
  });
});
