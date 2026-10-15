// @vitest-environment happy-dom
import type { FieldInfo } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { h } from 'vue';
import { games, type GameScreens } from '../../games';
import { fields } from '../fields';
import { i18n, setLanguage } from '../i18n';
import { clearMemory, readStored, writeStored } from '../storage';
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
  localStorage.clear();
  clearMemory();
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
    expect(lists(wrapper).attributes('aria-label')).toBe('Word lists');
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
    signedIn.account.summary = {
      username: 'Ann Lee',
      avatar: null,
      email: 'none',
      titles: [],
      contributions: [],
      roomSetup: {},
    };
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

  test('starts from the last room as far as it still holds, and keeps this one for the next', async () => {
    writeStored(
      'r2.roomSetup',
      JSON.stringify({
        game: 'keywords',
        fields: ['ml', 'gone'],
        randomFields: false,
        match: { games: 5, teams: 'switch', grouping: 'random' },
        public: true,
        play: false,
      }),
    );
    const wrapper = await opened();
    expect(box(wrapper, 0).element.checked).toBe(false);
    expect(box(wrapper, 1).element.checked).toBe(true);
    expect(wrapper.get('.field-fold .summary').text()).toBe('Machine learning');
    expect(wrapper.get<HTMLInputElement>('.match-form input[inputmode="numeric"]').element.value).toBe('5');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    // A guest's room is private, whatever the last one was.
    const payload = socket.send.mock.calls[0]?.[1];
    expect(payload).toMatchObject({
      fields: ['ml'],
      match: { games: 5, teams: 'switch', grouping: 'random' },
      play: false,
    });
    expect(payload).not.toHaveProperty('public');
    expect(JSON.parse(readStored('r2.roomSetup') ?? 'null')).toEqual({
      game: 'keywords',
      language: 'en',
      fields: ['ml'],
      randomFields: false,
      match: { games: 5, teams: 'switch', grouping: 'random' },
      public: false,
      play: false,
    });
  });

  test('creates no room from the last setup before the lists have come, which check its lists', async () => {
    fields.value = null;
    writeStored('r2.roomSetup', JSON.stringify({ game: 'keywords', fields: ['ml', 'gone'] }));
    const wrapper = await opened();
    expect(submit(wrapper).attributes('disabled')).toBeDefined();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(socket.send).not.toHaveBeenCalled();
    fields.value = FIELDS;
    await flushPromises();
    expect(submit(wrapper).attributes('disabled')).toBeUndefined();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(socket.send.mock.calls[0]?.[1]).toMatchObject({ fields: ['ml'] });
  });

  test("reads the last room's settings for this language, told which language they were kept in", async () => {
    const restoreSettings = vi.fn(() => ({ restored: true }));
    games.keywords = {
      Settings: { render: () => h('div') },
      defaultSettings: () => ({}),
      restoreSettings,
    } as unknown as GameScreens;
    try {
      writeStored(
        'r2.roomSetup',
        JSON.stringify({ game: 'keywords', language: 'zh', fields: ['ml'], settings: { clueLength: 2 } }),
      );
      await opened();
      expect(restoreSettings).toHaveBeenLastCalledWith({ clueLength: 2 }, 'en', 'zh');
      // A setup kept before the language was, or with one that is none, says nothing of it.
      writeStored('r2.roomSetup', JSON.stringify({ game: 'keywords', language: 'xx', fields: ['ml'], settings: {} }));
      await opened();
      expect(restoreSettings).toHaveBeenLastCalledWith({}, 'en', null);
    } finally {
      delete games.keywords;
    }
  });

  test("starts an account's room from the setup that the server kept for it", async () => {
    const room = { game: 'keywords', fields: ['general'], randomFields: false, match: null, public: true, play: true };
    signedIn.account.summary = { username: 'Ann', avatar: null, roomSetup: { room } };
    const wrapper = mount(CreateRoom, { props: { game: 'keywords', wordsNeeded: 25 }, global: { plugins: [i18n] } });
    expect(box(wrapper, 0).element.checked).toBe(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(socket.send.mock.calls[0]?.[1]).toMatchObject({ fields: ['general'], public: true, play: true });
    expect(readStored('r2.roomSetup')).toBeNull();
  });

  test('may draw the lists anew for every game, which needs none chosen', async () => {
    const wrapper = await opened();
    await wrapper.get<HTMLInputElement>('.each input').setValue(true);
    expect(wrapper.text()).not.toContain(HINT);
    expect(wrapper.get('.field-fold .summary').text()).toBe('Random lists each game');
    expect(box(wrapper, 0).element.disabled).toBe(true);
    expect(submit(wrapper).attributes('disabled')).toBeUndefined();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(socket.send.mock.calls[0]?.[1]).toMatchObject({ fields: [], randomFields: true });
  });

  test('chooses every list there is words enough in, or some of them at random, at least one', async () => {
    fields.value = [...FIELDS, { id: 'tiny', name: { zh: 'T', en: 'Tiny' }, counts: { zh: 3, en: 3 } }];
    const wrapper = await opened();
    const checked = () => wrapper.findAll<HTMLInputElement>('.fields input:checked').map((input) => input.element);
    const [atRandom, all] = wrapper.findAll('.tool');
    await all!.trigger('click');
    expect(checked()).toHaveLength(2);
    for (let draw = 0; draw < 12; draw += 1) {
      await atRandom!.trigger('click');
      expect(checked().length).toBeGreaterThan(0);
      expect(box(wrapper, 2).element.checked).toBe(false);
    }
  });

  test('creates a private room unless a public one is chosen, which takes an account', async () => {
    const wrapper = await opened();
    await box(wrapper, 0).setValue(true);
    const choice = () => wrapper.findAll<HTMLInputElement>('input[type="radio"]').slice(2, 4);
    // A guest can't choose public, and is told why.
    expect(choice()[1]?.attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('Log in or register to create a public room.');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(socket.send.mock.calls[0]?.[1]).not.toHaveProperty('public');

    signedIn.account.summary = { username: 'Ann', avatar: null, roomSetup: {} };
    await flushPromises();
    expect(choice()[1]?.attributes('disabled')).toBeUndefined();
    expect(wrapper.text()).toContain('Listed on the home page, for anyone with an account to join.');
    await choice()[1]?.setValue(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(socket.send.mock.calls[1]?.[1]).toMatchObject({ public: true });
  });

  test('creates an ordinary room unless a match is chosen', async () => {
    const wrapper = await opened();
    await box(wrapper, 0).setValue(true);
    expect(wrapper.find('.match-form').exists()).toBe(false);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(socket.send.mock.calls[0]?.[1]).not.toHaveProperty('match');
  });

  test('creates a match with the rules that were chosen, three games by default', async () => {
    const wrapper = await opened();
    await box(wrapper, 0).setValue(true);
    await wrapper.findAll<HTMLInputElement>('.kind input').at(1)!.setValue(true);
    const form = wrapper.get('.match-form');
    expect(form.get<HTMLInputElement>('input[inputmode="numeric"]').element.value).toBe('3');
    // Groups that may change, made again after every game, by default; fixed groups are made for
    // the first game.
    const radios = form.findAll<HTMLInputElement>('input[type="radio"]');
    expect(radios.map((radio) => radio.element.checked)).toEqual([false, true, true, false]);
    expect(form.text()).toContain('After every game');
    await radios.at(0)!.setValue(true);
    expect(form.text()).toContain('Groups for the first game');
    await radios.at(1)!.setValue(true);
    expect(form.text()).toContain('After every game');
    await form.findAll<HTMLInputElement>('input[type="radio"]').at(3)!.setValue(true);
    await form.get('input[inputmode="numeric"]').setValue('5');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(socket.send).toHaveBeenCalledWith(
      'room:create',
      expect.objectContaining({ match: { games: 5, teams: 'switch', grouping: 'choose' } }),
    );
  });

  test('creates no match with a number of games that will not do', async () => {
    const wrapper = await opened();
    await box(wrapper, 0).setValue(true);
    await wrapper.findAll<HTMLInputElement>('.kind input').at(1)!.setValue(true);
    for (const games of ['0', '11', '2.5', 'three']) {
      await wrapper.get('.match-form input[inputmode="numeric"]').setValue(games);
      expect(wrapper.text(), games).toContain('A whole number from 1 to 10.');
      expect(submit(wrapper).attributes('disabled'), games).toBeDefined();
    }
    // Full-width digits from a Chinese keyboard are numbers too.
    await wrapper.get('.match-form input[inputmode="numeric"]').setValue('\uff11\uff10');
    expect(submit(wrapper).attributes('disabled')).toBeUndefined();
    // An ordinary room doesn't mind what the match form says.
    await wrapper.get('.match-form input[inputmode="numeric"]').setValue('0');
    await wrapper.findAll<HTMLInputElement>('.kind input').at(0)!.setValue(true);
    expect(submit(wrapper).attributes('disabled')).toBeUndefined();
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
