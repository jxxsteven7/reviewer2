// @vitest-environment happy-dom
import type { ProfileView } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import ProfileCard from './ProfileCard.vue';

// Who the browser is, and the requests the card makes.
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
const socket = vi.hoisted(() => ({
  send: vi.fn(),
  connect: vi.fn(),
  onceConnected: vi.fn(),
  whenConnected: vi.fn(async () => true),
  socket: { connected: true, on: vi.fn() },
}));
vi.mock('../socket', () => socket);
const toasts = vi.hoisted(() => ({ toast: vi.fn(), toastError: vi.fn() }));
vi.mock('../toast', () => toasts);

const global = () => ({
  plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })],
  stubs: { RouterLink: { template: '<a><slot /></a>' } },
});

const profile = (changes: Partial<ProfileView> = {}): ProfileView => ({
  id: 1,
  handle: 'a1b2c3d4e5f6',
  username: 'Ann',
  avatar: null,
  rank: 'professor',
  createdAt: '2026-10-01',
  titles: [{ title: 'best_paper', count: 2 }],
  streaks: { wins: 3, losses: 0 },
  link: 'https://ann.example/(me)',
  bio: '<script>alert(1)</script> & co',
  record: { games: 12, wins: 7, matches: 3 },
  acknowledgments: [{ kind: 'feedback', count: 1 }],
  likes: 4,
  liked: false,
  mine: false,
  duo: null,
  ...changes,
});

describe('ProfileCard', () => {
  beforeEach(() => {
    signedIn.request.mockReset();
    socket.send.mockReset();
    socket.connect.mockReset();
    toasts.toast.mockReset();
    toasts.toastError.mockReset();
    signedIn.account.loaded = true;
    signedIn.account.summary = null;
  });

  test('shows the profile as the server sent it, the bio and the link as text, with the author marked', async () => {
    signedIn.request.mockResolvedValue({ ok: true, profile: profile() });
    const wrapper = mount(ProfileCard, { props: { handle: 'a1b2c3d4e5f6' }, global: global() });
    await flushPromises();
    expect(signedIn.request).toHaveBeenCalledWith('/api/profile/a1b2c3d4e5f6');
    const text = wrapper.text();
    expect(text).toContain('Ann');
    expect(text).toContain('Professor');
    expect(text).toContain('Player No. 1');
    expect(text).toContain('Author');
    expect(text).toContain('Registered Oct 1, 2026');
    expect(text).toContain('Best Paper Award ×2');
    expect(text).toContain('Three Submissions, Three Acceptances');
    expect(text).toContain('<script>alert(1)</script> & co');
    expect(wrapper.find('script').exists()).toBe(false);
    const link = wrapper.find('a.link');
    expect(link.text()).toBe('https://ann.example/(me)');
    expect(link.attributes()).toMatchObject({
      href: 'https://ann.example/(me)',
      target: '_blank',
      rel: 'nofollow ugc noopener',
    });
    expect(text).toContain('Games: 12 · Won: 7 · Matches: 3');
    expect(text).toContain('Acknowledged: Helpful discussions');
    expect(text).toContain('♥ 4');
    // A guest can neither like nor ask, and is told why.
    expect(wrapper.findAll('.actions button')).toHaveLength(0);
    expect(text).toContain('Log in to like this page');
    expect(socket.connect).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  test('shows a friend what the two have played together, and nothing of it to anyone else', async () => {
    signedIn.account.summary = { handle: 'b1b2c3d4e5f6' };
    const duo = { wonTogether: 5, lostTogether: 2, against: 4, beat: 1, beaten: 3, titles: ['coauthor' as const] };
    signedIn.request.mockResolvedValue({ ok: true, profile: profile({ duo }) });
    const wrapper = mount(ProfileCard, {
      props: { handle: 'a1b2c3d4e5f6' },
      global: global(),
      attachTo: document.body,
    });
    await flushPromises();
    const section = wrapper.find('section.duo');
    expect(section.find('h3').text()).toBe('You and Ann');
    expect(section.text()).toContain('As teammates: won 5, lost 2 · As opponents: won 1, lost 3');
    await section.find('button.badge').trigger('click');
    const sheet = document.body.querySelector('[role=dialog]');
    expect(sheet?.querySelector('h2')?.textContent).toBe('Co-First Author');
    expect(sheet?.textContent).toContain('The friend you have won the most games with on the same side, at least 3.');
    wrapper.unmount();

    signedIn.request.mockResolvedValue({ ok: true, profile: profile() });
    const stranger = mount(ProfileCard, { props: { handle: 'a1b2c3d4e5f6' }, global: global() });
    await flushPromises();
    expect(stranger.find('section.duo').exists()).toBe(false);
    stranger.unmount();
  });

  test('is not the author for any other account, and hides what the owner does not show', async () => {
    signedIn.request.mockResolvedValue({
      ok: true,
      profile: profile({
        id: 2,
        link: null,
        bio: null,
        record: null,
        acknowledgments: null,
        titles: [],
        streaks: { wins: 2, losses: 0 },
      }),
    });
    const wrapper = mount(ProfileCard, { props: { handle: 'a1b2c3d4e5f6' }, global: global() });
    await flushPromises();
    expect(wrapper.text()).toContain('Player No. 2');
    expect(wrapper.text()).not.toContain('Author');
    expect(wrapper.find('.titles').exists()).toBe(false);
    expect(wrapper.find('a.link').exists()).toBe(false);
    expect(wrapper.find('.bio').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Games:');
    wrapper.unmount();
  });

  test('offers nothing and explains nothing until the server has said who the browser is', async () => {
    // The page is read before the account is known, with the same cookie: once the account comes,
    // the page is not read again. A logout later does read it again, since the like was the viewer's.
    signedIn.account.loaded = false;
    signedIn.request.mockResolvedValue({ ok: true, profile: profile() });
    const wrapper = mount(ProfileCard, { props: { handle: 'a1b2c3d4e5f6' }, global: global() });
    await flushPromises();
    expect(signedIn.request).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Ann');
    expect(wrapper.text()).not.toContain('Log in to like');
    expect(wrapper.findAll('.actions button')).toHaveLength(0);
    signedIn.account.summary = { handle: 'f6e5d4c3b2a1' };
    signedIn.account.loaded = true;
    await flushPromises();
    expect(signedIn.request).toHaveBeenCalledTimes(1);
    expect(wrapper.findAll('.actions button')).toHaveLength(2);
    signedIn.account.summary = null;
    await flushPromises();
    expect(signedIn.request).toHaveBeenCalledTimes(2);
    expect(wrapper.findAll('.actions button')).toHaveLength(0);
    expect(wrapper.text()).toContain('Log in to like');
    wrapper.unmount();
  });

  test('lets another account like the page and take it back, and ask the owner to be friends', async () => {
    signedIn.account.summary = { handle: 'f6e5d4c3b2a1' };
    signedIn.request.mockResolvedValueOnce({ ok: true, profile: profile() });
    const wrapper = mount(ProfileCard, { props: { handle: 'a1b2c3d4e5f6' }, global: global() });
    await flushPromises();
    expect(socket.connect).toHaveBeenCalled();
    const like = wrapper.findAll('button').find((button) => button.text() === 'Like');
    expect(like?.attributes('aria-pressed')).toBe('false');
    // The button waits until the profile has been read again, with the like counted.
    let read!: (reply: object) => void;
    signedIn.request.mockResolvedValueOnce({ ok: true });
    signedIn.request.mockReturnValueOnce(new Promise((resolve) => (read = resolve)));
    await like?.trigger('click');
    await flushPromises();
    expect(signedIn.request).toHaveBeenNthCalledWith(2, '/api/profile/like', { handle: 'a1b2c3d4e5f6' });
    expect(like?.attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('♥ 4');
    read({ ok: true, profile: profile({ likes: 5, liked: true }) });
    await flushPromises();
    expect(like?.attributes('disabled')).toBeUndefined();
    expect(wrapper.text()).toContain('♥ 5');
    const liked = wrapper.findAll('button').find((button) => button.text() === 'Liked');
    expect(liked?.attributes('aria-pressed')).toBe('true');
    signedIn.request.mockResolvedValueOnce({ ok: true });
    signedIn.request.mockResolvedValueOnce({ ok: true, profile: profile() });
    await liked?.trigger('click');
    await flushPromises();
    expect(signedIn.request).toHaveBeenNthCalledWith(4, '/api/profile/unlike', { handle: 'a1b2c3d4e5f6' });
    expect(wrapper.text()).toContain('♥ 4');

    socket.send.mockResolvedValue({ ok: true, status: 'pending' });
    const friend = wrapper.findAll('button').find((button) => button.text() === 'Add friend');
    await friend?.trigger('click');
    await flushPromises();
    expect(socket.send).toHaveBeenCalledWith('friends:request', { username: 'Ann' });
    expect(toasts.toast).toHaveBeenCalledWith('friends.requestSent');
    wrapper.unmount();
  });

  test('keeps the page up when it can not be read again after a like, and says why', async () => {
    signedIn.account.summary = { handle: 'f6e5d4c3b2a1' };
    signedIn.request.mockResolvedValueOnce({ ok: true, profile: profile() });
    const wrapper = mount(ProfileCard, { props: { handle: 'a1b2c3d4e5f6' }, global: global() });
    await flushPromises();
    signedIn.request.mockResolvedValueOnce({ ok: true });
    signedIn.request.mockResolvedValueOnce({ ok: false, error: 'offline' });
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Like')
      ?.trigger('click');
    await flushPromises();
    expect(toasts.toastError).toHaveBeenCalledWith('offline');
    expect(wrapper.text()).toContain('Ann');
    expect(wrapper.text()).toContain('♥ 4');
    expect(wrapper.findAll('.actions button')).toHaveLength(2);
    expect(wrapper.findAll('.actions button')[0]?.attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  test('opens the ladder of ranks from the rank, with the rank marked and no points', async () => {
    document.body.innerHTML = '';
    signedIn.request.mockResolvedValue({ ok: true, profile: profile() });
    const wrapper = mount(ProfileCard, {
      props: { handle: 'a1b2c3d4e5f6' },
      global: global(),
      attachTo: document.body,
    });
    await flushPromises();
    expect(document.querySelector('[role=dialog]')).toBeNull();
    await wrapper.get('.rank-button').trigger('click');
    const dialog = document.querySelector<HTMLElement>('[role=dialog]');
    expect(dialog?.textContent).toContain('The academic ladder');
    const current = dialog?.querySelector<HTMLElement>('.rung.current');
    expect(current?.textContent).toContain('Professor');
    expect(current?.textContent).toContain('Current rank');
    expect(current?.textContent).not.toContain('more to');
    expect(dialog?.textContent).not.toContain('Points:');
    wrapper.unmount();
  });

  test('offers the owner the way to edit, and says when there is no such page', async () => {
    signedIn.account.summary = { handle: 'a1b2c3d4e5f6' };
    signedIn.request.mockResolvedValueOnce({ ok: true, profile: profile({ mine: true }) });
    const mine = mount(ProfileCard, { props: { handle: 'a1b2c3d4e5f6' }, global: global() });
    await flushPromises();
    expect(mine.findAll('.actions button')).toHaveLength(0);
    expect(mine.text()).toContain('This is your page');
    mine.unmount();
    signedIn.request.mockResolvedValueOnce({ ok: false, error: 'no_such_profile' });
    const gone = mount(ProfileCard, { props: { handle: '000000000000' }, global: global() });
    await flushPromises();
    expect(gone.text()).toContain('There is no such page');
    gone.unmount();
  });
});
