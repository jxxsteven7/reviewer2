// @vitest-environment happy-dom
import type { AccountSummary } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import { friendsVersion } from '../friends';
import ProfilePublic from './ProfilePublic.vue';

// The requests the section makes, and the connection, which the friends module listens on.
const signedIn = vi.hoisted(() => ({
  account: { loaded: true, summary: null as object | null, mail: false },
  request: vi.fn<(path: string, body?: object) => Promise<object>>(),
  loadAccount: vi.fn(async () => true),
}));
vi.mock('../account', () => signedIn);
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
  stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
});

const summary = (
  changes: Partial<AccountSummary> = {},
  profile: Partial<AccountSummary['profile']> = {},
): AccountSummary => ({
  id: 1,
  handle: 'a1b2c3d4e5f6',
  username: 'Ann',
  avatar: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  email: 'none',
  points: 0,
  titles: [],
  streaks: { wins: 0, losses: 0 },
  contributions: [],
  profile: { link: null, bio: 'Hi', showRecord: false, showThanks: false, banned: false, ...profile },
  likes: 1,
  requests: 0,
  ...changes,
});
const liker = (friend: boolean) => ({ handle: 'f6e5d4c3b2a1', username: 'Bob', avatar: null, friend });

describe('ProfilePublic', () => {
  beforeEach(() => {
    signedIn.request.mockReset();
    signedIn.request.mockResolvedValue({ ok: true, likers: [liker(false)] });
    signedIn.loadAccount.mockClear();
    socket.send.mockReset();
    toasts.toast.mockReset();
    toasts.toastError.mockReset();
  });

  test('leads to the page, and says that others find the account by its whole username or by the link', async () => {
    const wrapper = mount(ProfilePublic, { props: { summary: summary() }, global: global() });
    await flushPromises();
    expect(wrapper.get('.view').text()).toBe('Open my page');
    expect(wrapper.get('.view + .found').text()).toBe(
      'Others can find you in the friend search on their account page, by your full username or by pasting the link to your page.',
    );
    wrapper.unmount();
  });

  test('keeps what the owner has typed when the summary is asked for again, and shows what was saved', async () => {
    const wrapper = mount(ProfilePublic, { props: { summary: summary() }, global: global() });
    await flushPromises();
    const bio = wrapper.get('input[enterkeyhint="done"]');
    expect((bio.element as HTMLInputElement).value).toBe('Hi');
    await bio.setValue('Typed, not saved');
    // A friend request comes in: the summary is a new object with the same profile.
    await wrapper.setProps({ summary: summary({ requests: 1 }) });
    expect((bio.element as HTMLInputElement).value).toBe('Typed, not saved');
    // The profile as the server keeps it changed, as after a save: the form follows.
    await wrapper.setProps({ summary: summary({}, { bio: 'Saved', showRecord: true }) });
    expect((bio.element as HTMLInputElement).value).toBe('Saved');
    expect((wrapper.findAll('input[type=checkbox]')[0]?.element as HTMLInputElement).checked).toBe(true);
    wrapper.unmount();
  });

  test('sends the link, the line and the choices, and asks for the summary again', async () => {
    const wrapper = mount(ProfilePublic, { props: { summary: summary() }, global: global() });
    await flushPromises();
    await wrapper.get('input[inputmode="url"]').setValue('https://ann.example/');
    await wrapper.findAll('input[type=checkbox]')[1]?.setValue(true);
    signedIn.request.mockResolvedValueOnce({ ok: true });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(signedIn.request).toHaveBeenCalledWith('/api/account/profile', {
      link: 'https://ann.example/',
      bio: 'Hi',
      showRecord: false,
      showThanks: true,
    });
    expect(signedIn.loadAccount).toHaveBeenCalled();
    expect(toasts.toast).toHaveBeenCalledWith('account.profile.public.saved');
    wrapper.unmount();
  });

  test('follows what was kept after a save, so that a line kept as cleaned is not left to save', async () => {
    const wrapper = mount(ProfilePublic, { props: { summary: summary() }, global: global() });
    await flushPromises();
    const bio = wrapper.get('input[enterkeyhint="done"]');
    const save = wrapper.get('button[type=submit]');
    expect(save.attributes('disabled')).toBeDefined();
    await bio.setValue('Hi ');
    expect(save.attributes('disabled')).toBeUndefined();
    // The server keeps 'Hi' as before, so the summary read again says the same.
    signedIn.request.mockResolvedValueOnce({ ok: true });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(signedIn.request).toHaveBeenCalledWith('/api/account/profile', expect.objectContaining({ bio: 'Hi ' }));
    expect((bio.element as HTMLInputElement).value).toBe('Hi');
    expect(save.attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  test('asks for the summary again when the operator barred the account meanwhile, and closes the fields', async () => {
    const wrapper = mount(ProfilePublic, { props: { summary: summary() }, global: global() });
    await flushPromises();
    const link = wrapper.get('input[inputmode="url"]');
    const bio = wrapper.get('input[enterkeyhint="done"]');
    const record = wrapper.get('input[type=checkbox]');
    await record.setValue(true);
    // The operator cleared the line and barred the account meanwhile: the server refuses the line
    // the form still holds, and the summary, read again, says what happened. The choice stays.
    signedIn.request.mockResolvedValueOnce({ ok: false, error: 'profile_banned' });
    signedIn.loadAccount.mockImplementationOnce(async () => {
      await wrapper.setProps({ summary: summary({}, { banned: true, bio: null }) });
      return true;
    });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(signedIn.request).toHaveBeenLastCalledWith('/api/account/profile', expect.objectContaining({ bio: 'Hi' }));
    expect(signedIn.loadAccount).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[role=alert]').text()).toContain("This account can't write a link or a line");
    expect(link.attributes('disabled')).toBeDefined();
    expect(bio.attributes('disabled')).toBeDefined();
    expect((bio.element as HTMLInputElement).value).toBe('');
    expect((record.element as HTMLInputElement).checked).toBe(true);
    // The second try, with the choice alone, goes through.
    const save = wrapper.get('button[type=submit]');
    expect(save.attributes('disabled')).toBeUndefined();
    signedIn.request.mockResolvedValueOnce({ ok: true });
    signedIn.loadAccount.mockImplementationOnce(async () => {
      await wrapper.setProps({ summary: summary({}, { banned: true, bio: null, showRecord: true }) });
      return true;
    });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(signedIn.request).toHaveBeenLastCalledWith('/api/account/profile', {
      link: '',
      bio: '',
      showRecord: true,
      showThanks: false,
    });
    expect(toasts.toast).toHaveBeenCalledWith('account.profile.public.saved');
    expect((record.element as HTMLInputElement).checked).toBe(true);
    // The word against the first try has gone with the second.
    expect(wrapper.find('[role=alert]').exists()).toBe(false);
    wrapper.unmount();
  });

  test('keeps what was typed when the summary cannot be read after a save', async () => {
    const wrapper = mount(ProfilePublic, { props: { summary: summary() }, global: global() });
    await flushPromises();
    const bio = wrapper.get('input[enterkeyhint="done"]');
    const save = wrapper.get('button[type=submit]');
    await bio.setValue('New line');
    // The save goes through, but the summary read after it doesn't come: the form must not go
    // back to the line the summary still has, which a later save would send over the new one.
    signedIn.request.mockResolvedValueOnce({ ok: true });
    signedIn.loadAccount.mockResolvedValueOnce(false);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(toasts.toast).toHaveBeenCalledWith('account.profile.public.saved');
    expect((bio.element as HTMLInputElement).value).toBe('New line');
    expect(save.attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  test('keeps a choice the owner is making when a kept value of another field changes', async () => {
    const wrapper = mount(ProfilePublic, { props: { summary: summary() }, global: global() });
    await flushPromises();
    const record = wrapper.findAll('input[type=checkbox]')[0];
    await record?.setValue(true);
    // A save in another tab changed the line: the line follows, the choice stays.
    await wrapper.setProps({ summary: summary({}, { bio: 'Elsewhere' }) });
    expect((wrapper.get('input[enterkeyhint="done"]').element as HTMLInputElement).value).toBe('Elsewhere');
    expect((record?.element as HTMLInputElement).checked).toBe(true);
    wrapper.unmount();
  });

  test('takes no link or line from an account the operator has barred, which still chooses what it shows', async () => {
    const wrapper = mount(ProfilePublic, {
      props: { summary: summary({}, { banned: true, bio: null }) },
      global: global(),
    });
    await flushPromises();
    expect(wrapper.text()).toContain('The operator has cleared the link and the line');
    expect(wrapper.get('input[inputmode="url"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('input[enterkeyhint="done"]').attributes('disabled')).toBeDefined();
    for (const box of wrapper.findAll('input[type=checkbox]')) expect(box.attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  test('lists who liked the page, asks them to be friends, and asks again when the friends change', async () => {
    const wrapper = mount(ProfilePublic, { props: { summary: summary() }, global: global() });
    await flushPromises();
    expect(signedIn.request).toHaveBeenCalledWith('/api/account/likers');
    const line = wrapper.get('.likers .line');
    expect(line.text()).toContain('Bob');
    // The avatar opens Bob's panel, as everywhere.
    expect(line.get('.avatar-button').attributes('aria-haspopup')).toBe('dialog');
    socket.send.mockResolvedValueOnce({ ok: true, status: 'pending' });
    await line.get('button.button').trigger('click');
    await flushPromises();
    expect(socket.send).toHaveBeenCalledWith('friends:request', { username: 'Bob' });
    expect(toasts.toast).toHaveBeenCalledWith('friends.requestSent');
    // Bob accepts: the server says the friends changed, and the list says he is one.
    signedIn.request.mockResolvedValueOnce({ ok: true, likers: [liker(true)] });
    friendsVersion.value += 1;
    await flushPromises();
    expect(wrapper.get('.likers .line').text()).toContain('Friend');
    expect(wrapper.get('.likers .line').find('button.button').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Only the latest');
    wrapper.unmount();
  });

  test('says when the list stops short of the count', async () => {
    const likers = Array.from({ length: 100 }, (_, i) => ({
      ...liker(false),
      handle: i.toString(16).padStart(12, '0'),
    }));
    signedIn.request.mockResolvedValue({ ok: true, likers });
    const wrapper = mount(ProfilePublic, { props: { summary: summary({ likes: 150 }) }, global: global() });
    await flushPromises();
    expect(wrapper.findAll('.likers .line')).toHaveLength(100);
    expect(wrapper.text()).toContain('Only the latest 100 are listed.');
    wrapper.unmount();
  });
});
