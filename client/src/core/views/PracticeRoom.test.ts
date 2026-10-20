// @vitest-environment happy-dom
import type { FieldInfo, RoomSetup } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fields } from '../fields';
import { i18n, setLanguage } from '../i18n';
import { agents } from '../practice';
import { clearMemory, readStored, writeStored } from '../storage';
import PracticeRoom from './PracticeRoom.vue';

// The server answers whether Reviewer 1 can play, and the practice room to make.
const socket = vi.hoisted(() => ({
  replies: {} as Record<string, object>,
  send: vi.fn<(event: string, payload?: object) => Promise<object>>(),
  onceConnected: (run: () => void) => run(),
}));
vi.mock('../socket', () => socket);
vi.mock('../fields', async () => {
  const { shallowRef } = await import('vue');
  return { fields: shallowRef<FieldInfo[] | null>(null), loadFields: vi.fn() };
});
// Ann, unless a test makes a guest of her.
const signedIn = vi.hoisted(() => ({
  account: {
    loaded: true,
    summary: null as { username: string; avatar: null; roomSetup: RoomSetup } | null,
    mail: false,
  },
}));
vi.mock('../account', async () => {
  const { reactive } = await import('vue');
  signedIn.account = reactive(signedIn.account);
  return signedIn;
});
const push = vi.fn();
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

const FIELDS: FieldInfo[] = [
  { id: 'general', name: { zh: 'G', en: 'General' }, counts: { zh: 30, en: 30 } },
  { id: 'ml', name: { zh: 'M', en: 'Machine learning' }, counts: { zh: 3, en: 30 } },
  { id: 'physics', name: { zh: 'P', en: 'Physics' }, counts: { zh: 30, en: 30 } },
];

beforeEach(() => {
  setLanguage('en', { remember: false });
  localStorage.clear();
  clearMemory();
  fields.value = FIELDS;
  agents.value = 'unknown';
  signedIn.account.loaded = true;
  signedIn.account.summary = { username: 'Ann', avatar: null, roomSetup: {} };
  socket.replies = { 'meta:agents': { ok: true, available: true }, 'room:create': { ok: true, code: 'ABCD' } };
  socket.send.mockReset();
  socket.send.mockImplementation((event) => Promise.resolve(socket.replies[event] ?? { ok: false, error: 'bad' }));
  push.mockReset();
});

afterEach(() => {
  document.body.innerHTML = '';
});

// The home page's button, pressed, and the sheet it opens.
async function opened() {
  const wrapper = mount(PracticeRoom, { attachTo: document.body, global: { plugins: [i18n] } });
  await flushPromises();
  await wrapper.get('button.entry').trigger('click');
  await flushPromises();
  const sheet = document.querySelector<HTMLElement>('[role=dialog]');
  if (!sheet) throw new Error('no sheet');
  return { wrapper, sheet };
}

const checkedRole = (sheet: HTMLElement) => sheet.querySelector<HTMLInputElement>('.roles input:checked')?.value;
const summary = (sheet: HTMLElement) => sheet.querySelector('.field-fold .summary')?.textContent?.trim();
const startButton = (sheet: HTMLElement) => sheet.querySelector<HTMLButtonElement>('button.start');
// Who sits in each seat of a group, as the sheet shows them.
const seats = (sheet: HTMLElement, team: string) =>
  [...sheet.querySelectorAll(`.group.${team} .who`)].map((who) =>
    [...who.querySelectorAll('.name, .you')].map((part) => part.textContent?.trim()).join(' '),
  );
const submit = async (sheet: HTMLElement) => {
  sheet.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
  await flushPromises();
};

describe('practicing with Reviewer 1', () => {
  test('opens as the PI with the general list, with Reviewer 1 in the other seats, and makes the room', async () => {
    const { sheet } = await opened();
    expect(socket.send).toHaveBeenCalledWith('meta:agents');
    expect(sheet.querySelector('h2')?.textContent).toBe('Play with Reviewer\u00a01');
    expect(checkedRole(sheet)).toBe('captain');
    expect(seats(sheet, 'red')).toEqual(['Ann You', 'Reviewer 1']);
    expect(seats(sheet, 'blue')).toEqual(['Reviewer 1', 'Reviewer 1']);
    expect(summary(sheet)).toBe('General');
    // The lists are folded into that line.
    expect(sheet.querySelector('.toggle')?.getAttribute('aria-expanded')).toBe('false');
    await submit(sheet);
    expect(socket.send).toHaveBeenLastCalledWith('room:create', {
      game: 'keywords',
      language: 'en',
      fields: ['general'],
      practice: { who: 'me', role: 'captain' },
    });
    expect(push).toHaveBeenCalledWith('/room/ABCD');
    expect(readStored('r2.practiceRole')).toBe('captain');
    expect(readStored('r2.practiceFields')).toBe('["general"]');
  });

  test('comes back with the role and the lists of the last practice room, and names the lists in a line', async () => {
    writeStored('r2.practiceRole', 'guesser');
    // A list that the server no longer has is left out.
    writeStored('r2.practiceFields', '["ml","gone","general"]');
    const { sheet } = await opened();
    expect(checkedRole(sheet)).toBe('guesser');
    expect(seats(sheet, 'red')).toEqual(['Reviewer 1', 'Ann You']);
    expect(summary(sheet)).toBe('General and Machine learning');
    const toggle = sheet.querySelector<HTMLButtonElement>('.toggle');
    toggle?.click();
    await flushPromises();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    const physics = [...sheet.querySelectorAll<HTMLInputElement>('.fields input')][2];
    physics?.click();
    await flushPromises();
    expect(summary(sheet)).toBe('General, Machine learning and 1 more');
    // The player turns to the PI, which the seats follow.
    sheet.querySelector<HTMLInputElement>('.roles input[value="captain"]')?.click();
    await flushPromises();
    expect(seats(sheet, 'red')).toEqual(['Ann You', 'Reviewer 1']);
    await submit(sheet);
    expect(socket.send).toHaveBeenLastCalledWith(
      'room:create',
      expect.objectContaining({ fields: ['ml', 'general', 'physics'], practice: { who: 'me', role: 'captain' } }),
    );
  });

  test('opens a waiting room for the player with friends, with the lists and no role', async () => {
    // Ann last played alone as a student, with the physics list.
    writeStored('r2.practiceRole', 'guesser');
    signedIn.account.summary = {
      username: 'Ann',
      avatar: null,
      roomSetup: { keywords: { practice: { role: 'guesser', fields: ['physics'] } } },
    };
    const { wrapper, sheet } = await opened();
    // Just the player, first; the seats and the role show.
    const choice = (who: string) => sheet.querySelector<HTMLInputElement>(`.who-plays input[value="${who}"]`);
    expect(choice('me')?.checked).toBe(true);
    expect(sheet.querySelector('.seats')).not.toBeNull();
    expect(startButton(sheet)?.textContent?.trim()).toBe('Start');
    // A role picked before the choice of friends is not what the room names, and isn't kept.
    sheet.querySelector<HTMLInputElement>('.roles input[value="captain"]')?.click();
    await flushPromises();
    expect(checkedRole(sheet)).toBe('captain');
    // The lists are: the general list in place of physics.
    expect(summary(sheet)).toBe('Physics');
    sheet.querySelector<HTMLButtonElement>('.field-fold .toggle')?.click();
    await flushPromises();
    const lists = [...sheet.querySelectorAll<HTMLInputElement>('.fields input')];
    lists[0]?.click();
    await flushPromises();
    expect(summary(sheet)).toBe('General and Physics');
    lists[2]?.click();
    await flushPromises();
    expect(summary(sheet)).toBe('General');
    choice('friends')?.click();
    await flushPromises();
    expect(sheet.querySelector('.seats')).toBeNull();
    expect(sheet.querySelector('.roles')).toBeNull();
    expect(sheet.querySelector('.field-fold')).not.toBeNull();
    expect(sheet.textContent).toContain('Games that Reviewer\u00a01 plays in bring no points, streaks or titles.');
    expect(startButton(sheet)?.textContent?.trim()).toBe('Open the room');
    await submit(sheet);
    expect(socket.send).toHaveBeenLastCalledWith('room:create', {
      game: 'keywords',
      language: 'en',
      fields: ['general'],
      practice: { who: 'friends' },
    });
    expect(push).toHaveBeenCalledWith('/room/ABCD');
    // The lists are kept for the next time, in the browser and in the summary as the server keeps
    // it, and the role as it was.
    expect(readStored('r2.practiceRole')).toBe('guesser');
    expect(readStored('r2.practiceFields')).toBe('["general"]');
    expect(signedIn.account.summary?.roomSetup).toEqual({
      keywords: { practice: { role: 'guesser', fields: ['general'] } },
    });
    // The sheet opens on just the player again, as a student with the general list.
    await wrapper.get('button.entry').trigger('click');
    await flushPromises();
    expect(choice('me')?.checked).toBe(true);
    expect(sheet.querySelector('.seats')).not.toBeNull();
    expect(checkedRole(sheet)).toBe('guesser');
    expect(summary(sheet)).toBe('General');
  });

  test('opens at once with who plays and the role that the tutorial chose, and keeps them only once the player starts', async () => {
    writeStored('r2.practiceRole', 'captain');
    const wrapper = mount(PracticeRoom, {
      attachTo: document.body,
      props: { preset: { who: 'me', role: 'guesser' } },
      global: { plugins: [i18n] },
    });
    await flushPromises();
    const sheet = document.querySelector<HTMLElement>('[role=dialog]');
    if (!sheet) throw new Error('no sheet');
    expect(sheet.querySelector<HTMLInputElement>('.who-plays input[value="me"]')?.checked).toBe(true);
    expect(checkedRole(sheet)).toBe('guesser');
    expect(readStored('r2.practiceRole')).toBe('captain');
    wrapper.unmount();
    document.body.innerHTML = '';

    mount(PracticeRoom, {
      attachTo: document.body,
      props: { preset: { who: 'friends' } },
      global: { plugins: [i18n] },
    });
    await flushPromises();
    const withFriends = document.querySelector<HTMLElement>('[role=dialog]');
    expect(withFriends?.querySelector<HTMLInputElement>('.who-plays input[value="friends"]')?.checked).toBe(true);
    expect(withFriends?.querySelector('.roles')).toBeNull();
  });

  test('works without storage, and starts nothing until a list is chosen', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { sheet } = await opened();
    vi.restoreAllMocks();
    expect(checkedRole(sheet)).toBe('captain');
    sheet.querySelector<HTMLButtonElement>('.toggle')?.click();
    await flushPromises();
    sheet.querySelector<HTMLInputElement>('.fields input:checked')?.click();
    await flushPromises();
    expect(summary(sheet)).toBe('No list chosen yet');
    expect(sheet.textContent).toContain('Choose at least one word list to start.');
    expect(startButton(sheet)?.disabled).toBe(true);
    await submit(sheet);
    expect(socket.send).not.toHaveBeenCalledWith('room:create', expect.anything());
  });

  test('is grey while Reviewer 1 is offline, and says why when the server turns a room down', async () => {
    socket.replies['meta:agents'] = { ok: true, available: false };
    const wrapper = mount(PracticeRoom, { attachTo: document.body, global: { plugins: [i18n] } });
    await flushPromises();
    const entry = wrapper.get<HTMLButtonElement>('button.entry');
    expect(entry.element.disabled).toBe(true);
    // A sticker that lifts and presses as a button does (base.css), but not while it is grey.
    expect(entry.classes()).toContain('press');
    expect(entry.text()).toContain('Reviewer\u00a01 is offline for now');
    wrapper.unmount();

    // Reviewer 1 is there when the page asks, and gone by the time the room is to be made.
    socket.replies['meta:agents'] = { ok: true, available: true };
    socket.replies['room:create'] = { ok: false, error: 'agents_offline' };
    const { wrapper: again, sheet } = await opened();
    await submit(sheet);
    expect(sheet.querySelector('[role=alert]')?.textContent).toBe(
      'Reviewer\u00a01 is offline for now. Try again in a while.',
    );
    expect(push).not.toHaveBeenCalled();
    expect(again.get<HTMLButtonElement>('button.entry').element.disabled).toBe(true);
    expect(startButton(sheet)?.disabled).toBe(true);
  });

  test('shows nothing on a server without an agent', async () => {
    socket.replies['meta:agents'] = { ok: true, available: null };
    const wrapper = mount(PracticeRoom, { attachTo: document.body, global: { plugins: [i18n] } });
    await flushPromises();
    expect(wrapper.find('.practice').exists()).toBe(false);
    wrapper.unmount();
  });

  test('asks a guest to log in or to register, once the page knows them for one', async () => {
    signedIn.account.loaded = false;
    signedIn.account.summary = null;
    const { sheet } = await opened();
    expect(sheet.querySelector('form')).toBeNull();
    expect(sheet.querySelector('.row')).toBeNull();
    expect(sheet.textContent).toContain('Loading\u2026');
    signedIn.account.loaded = true;
    await flushPromises();
    expect(sheet.querySelector('form')).toBeNull();
    expect(sheet.textContent).toContain('Log in to start');
    const [login, register] = [...sheet.querySelectorAll<HTMLButtonElement>('.row button')];
    login?.click();
    expect(push).toHaveBeenLastCalledWith('/account');
    register?.click();
    expect(push).toHaveBeenLastCalledWith({ path: '/account', query: { register: '1' } });
  });
});
