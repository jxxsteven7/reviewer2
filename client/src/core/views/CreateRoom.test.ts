// @vitest-environment happy-dom
import type { FieldInfo } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fields } from '../fields';
import { i18n, setLanguage } from '../i18n';
import CreateRoom from './CreateRoom.vue';

const socket = vi.hoisted(() => ({
  send: vi.fn<
    (event: string, payload?: object) => Promise<{ ok: true; code: string } | { ok: false; error: string }>
  >(),
}));
vi.mock('../socket', () => socket);

// The word lists come from the server; here they are set by hand. A game's own settings form is
// left out, since it has nothing to do with the lists.
vi.mock('../fields', async () => {
  const { shallowRef } = await import('vue');
  return { fields: shallowRef<FieldInfo[] | null>(null), loadFields: vi.fn() };
});
vi.mock('../../games', () => ({ games: {} }));
// A guest, unless a test logs in.
const signedIn = vi.hoisted(() => ({ account: { loaded: true, summary: null as object | null, mail: false } }));
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
];

beforeEach(() => {
  signedIn.account.summary = null;
  setLanguage('en', { remember: false });
  fields.value = FIELDS;
  socket.send.mockReset();
  socket.send.mockResolvedValue({ ok: true, code: 'ABCD' });
  push.mockReset();
});

async function opened() {
  const wrapper = mount(CreateRoom, { props: { game: 'keywords', wordsNeeded: 25 }, global: { plugins: [i18n] } });
  await wrapper.get('input[autocomplete="nickname"]').setValue('Ann');
  return wrapper;
}

type Wrapper = Awaited<ReturnType<typeof opened>>;
const box = (wrapper: Wrapper, index: number) => wrapper.findAll<HTMLInputElement>('.fields input').at(index)!;
const submit = (wrapper: Wrapper) => wrapper.get('button[type="submit"]');
// The group of word lists, which the hint describes while none is chosen.
const lists = (wrapper: Wrapper) => wrapper.get('section[role="group"]');
const byId = (wrapper: Wrapper, id: string | undefined) => wrapper.get(`[id="${id}"]`);
const HINT = 'Choose at least one word list to create the room.';

describe('the room setup', () => {
  test('starts with no word list chosen', async () => {
    const wrapper = await opened();
    expect(box(wrapper, 0).element.checked).toBe(false);
    expect(box(wrapper, 1).element.checked).toBe(false);
  });

  test('says to choose a list, and creates no room, until one is chosen', async () => {
    const wrapper = await opened();
    expect(submit(wrapper).attributes('disabled')).toBeDefined();
    expect(byId(wrapper, lists(wrapper).attributes('aria-labelledby')).text()).toBe('Word lists');
    expect(byId(wrapper, lists(wrapper).attributes('aria-describedby')).text()).toBe(HINT);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(socket.send).not.toHaveBeenCalled();
  });

  test('creates the room with the lists that were chosen', async () => {
    const wrapper = await opened();
    await box(wrapper, 1).setValue(true);
    expect(wrapper.text()).not.toContain(HINT);
    expect(lists(wrapper).attributes('aria-describedby')).toBeUndefined();
    expect(submit(wrapper).attributes('disabled')).toBeUndefined();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(socket.send).toHaveBeenCalledWith('room:create', expect.objectContaining({ fields: ['ml'], name: 'Ann' }));
    expect(push).toHaveBeenCalledWith('/room/ABCD');
  });

  test('asks a player who is logged in for no nickname, and sends none', async () => {
    signedIn.account.summary = { username: 'Ann Lee', avatar: null, email: 'none', titles: [] };
    const wrapper = mount(CreateRoom, { props: { game: 'keywords', wordsNeeded: 25 }, global: { plugins: [i18n] } });
    expect(wrapper.find('input[autocomplete="nickname"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('As Ann Lee');
    await box(wrapper, 0).setValue(true);
    expect(submit(wrapper).attributes('disabled')).toBeUndefined();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const payload = socket.send.mock.calls[0]?.[1];
    expect(payload).toMatchObject({ fields: ['general'] });
    expect(payload).not.toHaveProperty('name');
  });

  test('keeps only the lists that are still usable when the language changes, and adds none', async () => {
    const wrapper = await opened();
    await box(wrapper, 0).setValue(true);
    await box(wrapper, 1).setValue(true);
    setLanguage('zh', { remember: false });
    await flushPromises();
    expect(box(wrapper, 0).element.checked).toBe(true);
    expect(box(wrapper, 1).element.checked).toBe(false);
    await box(wrapper, 0).setValue(false);
    setLanguage('en', { remember: false });
    await flushPromises();
    expect(box(wrapper, 0).element.checked).toBe(false);
    expect(box(wrapper, 1).element.checked).toBe(false);
    expect(submit(wrapper).attributes('disabled')).toBeDefined();
  });
});
