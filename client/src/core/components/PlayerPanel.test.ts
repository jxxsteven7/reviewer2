// @vitest-environment happy-dom
import type { PlayerView, RoomView } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';
import en from '../../locales/en.json';
import PlayerPanel from './PlayerPanel.vue';

const send = vi.hoisted(() =>
  vi.fn<(event: string, payload?: object) => Promise<{ ok: boolean; error?: string; status?: string }>>(),
);
vi.mock('../socket', () => ({
  send,
  act: (event: string, payload: object = {}) => send(event, payload),
  connect: vi.fn(),
  onceConnected: vi.fn(),
  whenConnected: vi.fn(async () => true),
  socket: { connected: true, on: vi.fn(), off: vi.fn() },
}));
// Who the browser is, and the request that the player's page in the sheet makes for the profile.
const signedIn = vi.hoisted(() => ({
  account: { loaded: true, summary: null as object | null, mail: false },
  request: vi.fn<(path: string, body?: object) => Promise<object>>(),
  loadAccount: vi.fn(),
}));
vi.mock('../account', () => signedIn);

const router = () =>
  createRouter({ history: createMemoryHistory(), routes: [{ path: '/:any(.*)*', component: { render: () => null } }] });
const global = () => ({ plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } }), router()] });
const bob: PlayerView = { id: 'bob', name: 'Bob', online: true };
const ai: PlayerView = { id: 'ai', name: 'Reviewer 1', online: true, agent: 'reviewer1' };

const view = (me: string, isPublic: boolean, player: PlayerView = bob): RoomView => ({
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
  players: [{ id: 'ann', name: 'Ann', online: true }, player, { id: 'cat', name: 'Cat', online: true }, ai],
  agents: false,
  screens: 0,
  me,
  match: null,
  streaks: [],
  duos: [],
  agentsPlayed: false,
  points: [],
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

describe('PlayerPanel', () => {
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({ ok: true });
    signedIn.account.summary = null;
    signedIn.request.mockReset();
    signedIn.request.mockResolvedValue({ ok: true, profile });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const names = () => buttons().map((element) => element.textContent?.trim());
  const panel = (playerId: string, room: RoomView) =>
    mount(PlayerPanel, { props: { playerId, room }, global: global() });
  const profile = {
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
    contributions: null,
    likes: 2,
    liked: false,
    mine: false,
  };
  const withPage: PlayerView = { ...bob, rank: 'phd', handle: 'a1b2c3d4e5f6' };

  test('removes a player only after the chair has confirmed it, saying for how long', async () => {
    // From a public room, for good.
    const listed = panel('bob', view('ann', true));
    button('Remove from the room').click();
    await flushPromises();
    expect(dialogs()[0]?.textContent).toContain("Remove Bob from the room? They won't be able to come back to it.");
    listed.unmount();

    // From a private room, for two minutes.
    const wrapper = panel('bob', view('ann', false));
    expect(dialogs()[0]?.querySelector('h2')?.textContent).toBe('Bob');
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

  test("says a guest has no page, opens an AI player's own page, and gives the chair one action on an AI", async () => {
    const guest = panel('bob', view('cat', false));
    expect(dialogs()[0]?.querySelector('.nobody')?.textContent).toContain('GuestGuests have no page.');
    expect(names()).toEqual(['\u00d7']);
    guest.unmount();
    signedIn.request.mockResolvedValue({
      ok: true,
      profile: {
        persona: 'reviewer1',
        number: 0,
        live: { players: 3, rooms: 2 },
        games: 0,
        wins: 0,
        roles: { captain: { games: 0, wins: 0 }, guesser: { games: 0, wins: 0 } },
        clues: 0,
        found: 0,
        reviewer2: 0,
        takeovers: 0,
        best: null,
        you: null,
      },
    });
    const wrapper = panel('ai', view('ann', false));
    await flushPromises();
    expect(signedIn.request).toHaveBeenCalledWith('/api/agent/reviewer1');
    expect(dialogs()[0]?.textContent).toContain('Player No. 0');
    expect(dialogs()[0]?.querySelector('.nobody')).toBeNull();
    const actions = [...(dialogs()[0]?.querySelectorAll('.actions > *') ?? [])].map((item) => item.textContent?.trim());
    expect(actions).toEqual(['Remove from the room']);
    button('Remove from the room').click();
    await flushPromises();
    expect(send).toHaveBeenCalledWith('room:remove', { playerId: 'ai' });
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  test('offers a report in a public room to a player with an account, and sends it with the note', async () => {
    signedIn.account.summary = { username: 'Cat', avatar: null };
    const wrapper = panel('bob', view('cat', true));
    // Not the chair: no chair's actions.
    expect(names()).toEqual(['\u00d7', 'Report to the operator']);
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

  // The viewer's friends list, as the server sends it, and every other message answered with `reply`.
  const friendsAre = (friends: object[], outgoing: object[] = [], reply: object = { ok: true }) =>
    send.mockImplementation(async (event) =>
      event === 'friends:list' ? { ok: true, friends, incoming: [], outgoing } : { ok: true, ...reply },
    );

  test('offers an account to ask a player with an account to be friends, first, and says how it went', async () => {
    signedIn.account.summary = { username: 'Cat', avatar: null };
    friendsAre([], [], { status: 'pending' });
    const wrapper = panel('bob', view('ann', false, { ...bob, rank: 'phd' }));
    await flushPromises();
    expect(send).toHaveBeenCalledWith('friends:list');
    expect(names()).toEqual(['\u00d7', 'Add friend', 'Move to the spectators', 'Make chair', 'Remove from the room']);
    // A sheet of its own asks for a line for them, which may be left out.
    button('Add friend').click();
    await flushPromises();
    expect(names()).toEqual(['\u00d7', 'Send a request', 'Cancel']);
    button('Send a request').click();
    await flushPromises();
    expect(send).toHaveBeenCalledWith('friends:request', { playerId: 'bob' });
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
    // Not by a guest.
    signedIn.account.summary = null;
    const asGuest = panel('bob', view('cat', false, { ...bob, rank: 'phd' }));
    expect(names()).toEqual(['\u00d7']);
    asGuest.unmount();
  });

  test("offers no request to a friend, whom it calls by the viewer's name for them, nor again to whoever was asked", async () => {
    signedIn.account.summary = { username: 'Cat', avatar: null };
    signedIn.request.mockResolvedValue({ ok: false, error: 'no_such_profile' });
    const bobs = { ...bob, rank: 'phd' as const, handle: 'b0b000000000' };
    friendsAre([{ handle: 'b0b000000000', username: 'Bob', alias: 'Bobby', avatar: null }]);
    const friendly = panel('bob', view('cat', false, bobs));
    await flushPromises();
    expect(names()).toEqual(['\u00d7', 'Open the full page']);
    expect(dialogs()[0]?.querySelector('h2')?.textContent?.trim()).toBe('Bobby Bob');
    expect(dialogs()[0]?.querySelector('h2 .subtitle')?.textContent?.trim()).toBe('Bob');
    friendly.unmount();
    friendsAre([], [{ handle: 'b0b000000000', username: 'Bob', avatar: null }]);
    const asked = panel('bob', view('cat', false, bobs));
    await flushPromises();
    expect(names()).toEqual(['\u00d7', 'Request sent', 'Open the full page']);
    expect(button('Request sent').disabled).toBe(true);
    asked.unmount();
  });

  test('shows a brief card of an account, and its whole page over the panel, with the way back to it', async () => {
    const wrapper = panel('bob', view('cat', false, withPage));
    await flushPromises();
    expect(signedIn.request).toHaveBeenCalledWith('/api/profile/a1b2c3d4e5f6');
    const brief = dialogs()[0] as HTMLElement;
    expect(brief.textContent).toContain('Player No. 7');
    // No name of the card's own: the title says it. Nor the rest of the page.
    expect(brief.querySelector('.profile-card .name')).toBeNull();
    expect(brief.textContent).not.toContain('Hi <b>there</b>');
    expect(names().at(-1)).toBe('Open the full page');

    button('Open the full page').click();
    await flushPromises();
    expect(dialogs()).toHaveLength(2);
    const page = dialogs()[1] as HTMLElement;
    expect(page.classList).toContain('tall');
    expect(page.textContent).toContain('Hi <b>there</b>');
    expect(page.querySelector('.bio b')).toBeNull();
    expect(page.querySelector<HTMLAnchorElement>('a.link')?.getAttribute('rel')).toBe('nofollow ugc noopener');
    // Back to the brief one, and then on to the page again and close both.
    page.querySelector<HTMLButtonElement>('button.back')?.click();
    await flushPromises();
    expect(dialogs()).toHaveLength(1);
    expect(wrapper.emitted('close')).toBeUndefined();
    button('Open the full page').click();
    await flushPromises();
    dialogs()[1]?.querySelector<HTMLButtonElement>('button.close')?.click();
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  test('shows the viewer their own card with the way to their account, and nothing to do to themselves', async () => {
    signedIn.account.summary = { username: 'Bob', avatar: null };
    signedIn.request.mockResolvedValue({ ok: true, profile: { ...profile, mine: true } });
    const wrapper = panel('bob', view('bob', true, withPage));
    await flushPromises();
    expect(dialogs()[0]?.textContent).toContain('Player No. 7');
    const links = [...(dialogs()[0]?.querySelectorAll<HTMLAnchorElement>('.actions a') ?? [])];
    expect(links.map((link) => [link.textContent?.trim(), link.getAttribute('href')])).toEqual([
      ['My account', '/account'],
    ]);
    const actions = [...(dialogs()[0]?.querySelectorAll('.actions > *') ?? [])].map((item) => item.textContent?.trim());
    expect(actions).toEqual(['My account', 'Open the full page']);
    wrapper.unmount();
    // The chair, too, has no chair's actions on themselves.
    const chair = panel('ann', view('ann', false));
    expect(names()).toEqual(['\u00d7']);
    chair.unmount();
  });

  test('shows what the server had against a report, and offers none to guests or in private rooms', async () => {
    signedIn.account.summary = { username: 'Ann', avatar: null };
    send.mockResolvedValue({ ok: false, error: 'report_limited' });
    const wrapper = panel('bob', view('ann', true));
    button('Report to the operator').click();
    await flushPromises();
    button('Send the report').click();
    await flushPromises();
    expect(dialogs()[0]?.querySelector('[role=alert]')?.textContent).toContain('5 reports in the last hour');
    expect(wrapper.emitted('close')).toBeUndefined();
    wrapper.unmount();

    // A guest in a public room has nothing to do with another player.
    signedIn.account.summary = null;
    const guest = panel('bob', view('cat', true));
    expect(names()).toEqual(['\u00d7']);
    guest.unmount();
  });

  test('closes when the player leaves the room', async () => {
    const wrapper = panel('bob', view('cat', false));
    const room = view('cat', false);
    await wrapper.setProps({ room: { ...room, players: room.players.filter((player) => player.id !== 'bob') } });
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
