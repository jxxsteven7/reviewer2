// @vitest-environment happy-dom
import type { ChatMessage, KeywordsRoomData, KeywordsView, RoomView, Seat } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { clearMemory } from '../../core/storage';
import en from '../../locales/en.json';
import CluePanel from './CluePanel.vue';
import GroupChat from './GroupChat.vue';
import KeywordsCard from './KeywordsCard.vue';

const send = vi.hoisted(() =>
  vi.fn<(event: string, payload?: object) => Promise<{ ok: boolean }>>(async () => ({ ok: true })),
);
vi.mock('../../core/socket', () => ({
  send,
  act: (event: string, payload: object = {}) => send(event, payload),
  connect: vi.fn(),
  socket: { connected: true, on: vi.fn(), once: vi.fn() },
}));

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en } });
// The sheet is teleported to the page's body; rendering it in place keeps it inside the wrapper.
const global = () => ({ plugins: [i18n()], stubs: { teleport: true } });

const seats: Record<string, Seat> = {
  ann: { team: 'red', role: 'captain' },
  bob: { team: 'red', role: 'guesser' },
  cat: { team: 'red', role: 'guesser' },
  eve: { team: null, role: 'spectator' },
};

function room(me: string, chat?: ChatMessage[], phase: KeywordsView['phase'] = 'guess'): RoomView {
  const game: KeywordsView = {
    gameId: 'g1',
    turn: 2,
    team: 'red',
    phase,
    startingTeam: 'red',
    cards: cards('Baseline', 'Model', 'Journal'),
    remaining: { red: 9, blue: 8 },
    clue: { word: 'Science', count: 2 },
    guessesMade: 0,
    guessesLeft: 3,
    history: [{ turn: 2, team: 'red', word: 'Science', count: 2, guesses: [] }],
    result: null,
    selections: [],
    ...(chat ? { chat } : {}),
  };
const cards = (...words: string[]) => words.map((word) => ({ word, revealed: false }));

// A game in the red group's guess phase, with the one clue "Science 2" and no guess yet.
  const data: KeywordsRoomData = {
    seats,
    keyViewers: ['ann'],
    side: seats[me]?.team ?? null,
    startProblems: [],
    game: game as unknown as KeywordsView,
  };
  return {
    roomId: 'r1',
    code: 'K7QX',
    rev: 1,
    game: 'keywords',
    language: 'en',
    fields: ['general'],
    phase: 'playing',
    round: 1,
    gameId: 'g1',
    chairId: 'ann',
    players: ['ann', 'bob', 'cat', 'eve'].map((id) => ({ id, name: id[0]?.toUpperCase() + id.slice(1), online: true })),
    screens: 0,
    me,
    data,
  };
}

const messages: ChatMessage[] = [
  { id: 1, player: 'cat', turn: 1, text: 'maybe the second row' },
  { id: 2, player: 'bob', turn: 2, text: 'agreed' },
  { id: 3, player: 'cat', turn: 2, text: 'go on' },
];

describe('GroupChat', () => {
  beforeEach(() => {
    clearMemory();
    send.mockClear();
  });
  afterEach(() => clearMemory());

  test("shows a student the others' new messages, by turn", async () => {
    const wrapper = mount(GroupChat, { props: { room: room('bob', messages) }, global: global() });
    const entry = wrapper.get('button');
    expect(entry.text()).toContain('Group chat');
    expect(entry.get('.badge').text()).toBe('2');
    expect(entry.attributes('aria-label')).toBe('Group chat, 2 new');

    await entry.trigger('click');
    const turns = wrapper.findAll('.turn');
    expect(turns.map((turn) => turn.get('.turn-title').text())).toEqual(['Turn 1', 'Turn 2']);
    expect(turns[1]?.text()).toContain('You');
    expect(turns[1]?.text()).toContain('Cat');
    expect(wrapper.find('.badge').exists()).toBe(false);
  });

  test('lets a student send only a message that passes the check', async () => {
    const wrapper = mount(GroupChat, { props: { room: room('bob', []) }, global: global() });
    await wrapper.get('button').trigger('click');
    expect(wrapper.text()).toContain('No messages yet.');
    const input = wrapper.get('input');
    const sendButton = () => wrapper.get('form button[type="submit"]');

    expect(sendButton().attributes('disabled')).toBeDefined();
    await input.setValue('x'.repeat(201));
    expect(sendButton().attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('That message is too long.');

    await input.setValue('  the second row  ');
    expect(sendButton().attributes('disabled')).toBeUndefined();
    expect(wrapper.get('.hint').text()).toBe('14/200');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('keywords:say', { gameId: 'g1', text: '  the second row  ' });
    // The teleport stub renders the sheet anew, so the input is looked up again.
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('');
    expect(wrapper.get('.hint').text()).toBe('0/200');
  });

  test('keeps the input and its focus after sending, so that a phone keeps its keyboard open', async () => {
    const wrapper = mount(GroupChat, {
      props: { room: room('bob', []) },
      global: { plugins: [i18n()] },
      attachTo: document.body,
    });
    await wrapper.get('button').trigger('click');
    const input = document.body.querySelector<HTMLInputElement>('#chat-text');
    if (!input) throw new Error('no input');
    input.focus();
    input.value = 'hello';
    input.dispatchEvent(new Event('input'));
    await flushPromises();
    // A tap on the send button takes the focus away from the input.
    document.body.querySelector<HTMLButtonElement>('form button[type="submit"]')?.focus();
    document.body.querySelector('form')?.dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(send).toHaveBeenCalledWith('keywords:say', { gameId: 'g1', text: 'hello' });
    expect(document.body.querySelector('#chat-text')).toBe(input);
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    wrapper.unmount();
  });

  test('lets a PI read the chat but not write in it', async () => {
    const wrapper = mount(GroupChat, { props: { room: room('ann', messages) }, global: global() });
    await wrapper.get('button').trigger('click');
    expect(wrapper.findAll('.message')).toHaveLength(3);
    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.text()).toContain('the clue is all a PI may say');
  });

  test('closes the input once the game is over', async () => {
    const wrapper = mount(GroupChat, { props: { room: room('bob', messages, 'over') }, global: global() });
    await wrapper.get('button').trigger('click');
    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.text()).toContain('The game is over');
  });

  test('offers nothing to someone without a chat, such as a spectator', () => {
    const wrapper = mount(GroupChat, { props: { room: room('eve') }, global: global() });
    expect(wrapper.find('button').exists()).toBe(false);
  });
});

describe('KeywordsCard', () => {
  const card = { word: 'Baseline', revealed: false };

  test('shows who in the group has chosen it, also to screen readers', () => {
    const wrapper = mount(KeywordsCard, {
      props: { card, index: 3, selectable: true, selected: false, choosers: ['Ann', 'Cat'] },
      global: global(),
    });
    expect(wrapper.get('.choosers').text()).toBe('Ann and Cat');
    expect(wrapper.get('button').attributes('aria-label')).toBe('Baseline, not revealed, chosen by Ann and Cat');
  });

  test('shows no names when nobody else has chosen it', () => {
    const wrapper = mount(KeywordsCard, {
      props: { card, index: 3, selectable: true, selected: true, choosers: [] },
      global: global(),
    });
    expect(wrapper.find('.choosers').exists()).toBe(false);
    expect(wrapper.get('button').classes()).toContain('selected');
  });
});
