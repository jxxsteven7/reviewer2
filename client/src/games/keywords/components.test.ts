// @vitest-environment happy-dom
import type { ChatMessage, KeywordsRoomData, KeywordsView, RoomView, Seat } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { clearMemory } from '../../core/storage';
import en from '../../locales/en.json';
import CluePanel from './CluePanel.vue';
import GroupChat from './GroupChat.vue';
import GuessBar from './GuessBar.vue';
import KeywordsCard from './KeywordsCard.vue';
import KeywordsGame from './KeywordsGame.vue';

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

const cards = (...words: string[]) => words.map((word) => ({ word, revealed: false }));

// A game in the red group's guess phase, with the one clue "Science 2" and no guess yet.
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
  const data: KeywordsRoomData = {
    seats,
    keyViewers: ['ann'],
    side: seats[me]?.team ?? null,
    startProblems: [],
    game,
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

  test('keeps what is typed while a message is on its way, and brings back one that was refused', async () => {
    const answers: ((reply: { ok: boolean; error?: string }) => void)[] = [];
    const later = () => new Promise<{ ok: boolean }>((resolve) => answers.push(resolve));
    send.mockImplementationOnce(later).mockImplementationOnce(later);
    const wrapper = mount(GroupChat, { props: { room: room('bob', []) }, global: global() });
    await wrapper.get('button').trigger('click');
    const value = () => (wrapper.get('input').element as HTMLInputElement).value;

    await wrapper.get('input').setValue('first');
    await wrapper.get('form').trigger('submit');
    expect(send).toHaveBeenCalledWith('keywords:say', { gameId: 'g1', text: 'first' });
    expect(value()).toBe('');
    await wrapper.get('input').setValue('second');
    answers[0]?.({ ok: true });
    await flushPromises();
    expect(value()).toBe('second');

    await wrapper.get('form').trigger('submit');
    expect(send).toHaveBeenLastCalledWith('keywords:say', { gameId: 'g1', text: 'second' });
    await wrapper.get('input').setValue('third');
    answers[1]?.({ ok: false, error: 'offline' });
    await flushPromises();
    expect(value()).toBe('second third');
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

  test("stays readable, but out of the Tab order and inert, when it can't be chosen", async () => {
    const wrapper = mount(KeywordsCard, {
      props: { card: { ...card, color: 'red' }, index: 3, selectable: false, selected: false, choosers: [] },
      global: global(),
    });
    const button = wrapper.get('button');
    expect(button.attributes('disabled')).toBeUndefined();
    expect(button.attributes('aria-disabled')).toBe('true');
    expect(button.attributes('tabindex')).toBe('-1');
    expect(button.attributes('aria-label')).toBe('Baseline, Red');
    await button.trigger('click');
    expect(wrapper.emitted('select')).toBeUndefined();
  });
});

describe('GuessBar', () => {
  const game = room('bob').data as KeywordsRoomData;
  const props = (selected: number | null, busy = false) => ({
    game: { ...(game.game as KeywordsView), guessesMade: 1 },
    selected,
    busy,
  });

  test('reveals the chosen card, and asks before ending the turn', async () => {
    const wrapper = mount(GuessBar, { props: props(1), global: global() });
    const [reveal, end] = wrapper.findAll('.buttons button');
    expect(reveal?.text()).toBe('Reveal \u201cModel\u201d');
    await reveal?.trigger('click');
    expect(wrapper.emitted('reveal')).toEqual([[1]]);

    await end?.trigger('click');
    expect(wrapper.emitted('pass')).toBeUndefined();
    expect(wrapper.text()).toContain('End the turn now?');
    await wrapper.get('.confirm button.primary').trigger('click');
    expect(wrapper.emitted('pass')).toEqual([[]]);
    expect(wrapper.text()).not.toContain('End the turn now?');
  });

  test('holds both buttons while a move is on its way', () => {
    const wrapper = mount(GuessBar, { props: props(1, true), global: global() });
    for (const button of wrapper.findAll('.buttons button')) expect(button.attributes('disabled')).toBeDefined();
  });
});

describe('CluePanel', () => {
  const JOURNAL = '\u671f\u520a'; // "journal"
  const board = [...cards('Model', 'Peer review'), { word: JOURNAL, revealed: false, translations: ['Journal'] }];
  const panel = () =>
    mount(CluePanel, {
      props: { game: { ...(room('ann').data as KeywordsRoomData).game, cards: board } as KeywordsView, busy: false },
      global: global(),
    });

  test('names the card that a clue repeats, and the translation when that is what it repeats', async () => {
    const wrapper = panel();
    await wrapper.get('input').setValue('models');
    expect(wrapper.get('.problem').text()).toBe(
      "\u201cModel\u201d is on the board. A clue can't be a word on the board, or part of one.",
    );
    await wrapper.get('input').setValue('review');
    expect(wrapper.get('.problem').text()).toContain('\u201cPeer review\u201d is on the board.');
    await wrapper.get('input').setValue('journals');
    expect(wrapper.get('.problem').text()).toContain(`\u201c${JOURNAL}\u201d (Journal) is on the board.`);
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
  });

  test('warns about a likely form of a word on the board, and leaves the choice to the PI', async () => {
    const wrapper = panel();
    await wrapper.get('input').setValue('modeling');
    expect(wrapper.find('.problem').exists()).toBe(false);
    expect(wrapper.get('.warning').text()).toBe(
      'This may be another form of a word still on the board: \u201cModel\u201d. ' +
        "The rules don't allow that, but the check can't be sure, so it's your call.",
    );
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined();
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('give')).toEqual([['modeling', 1]]);
  });
});

describe('KeywordsGame', () => {
  const answers: (() => void)[] = [];
  // The server answers when the test says so.
  const later = () => new Promise<{ ok: boolean }>((resolve) => answers.push(() => resolve({ ok: true })));
  const card = (wrapper: ReturnType<typeof mount>, index: number) => wrapper.findAll('.board button')[index];

  test('shows a choice at once and sends it, takes it back, and reveals the card chosen last', async () => {
    send.mockImplementation(later);
    const wrapper = mount(KeywordsGame, { props: { room: room('bob') }, global: global() });

    await card(wrapper, 1)?.trigger('click');
    expect(send).toHaveBeenLastCalledWith('keywords:select', { gameId: 'g1', turn: 2, card: 1 });
    expect(card(wrapper, 1)?.classes()).toContain('selected');
    expect(wrapper.get('.guess-bar button.primary').text()).toBe('Reveal \u201cModel\u201d');

    // A second tap takes the choice back, also before the first one has been answered.
    await card(wrapper, 1)?.trigger('click');
    expect(send).toHaveBeenLastCalledWith('keywords:select', { gameId: 'g1', turn: 2, card: null });
    expect(card(wrapper, 1)?.classes()).not.toContain('selected');

    await card(wrapper, 2)?.trigger('click');
    expect(send).toHaveBeenLastCalledWith('keywords:select', { gameId: 'g1', turn: 2, card: 2 });
    await wrapper.get('.guess-bar button.primary').trigger('click');
    expect(send).toHaveBeenLastCalledWith('keywords:reveal', { gameId: 'g1', turn: 2, card: 2 });

    // While the reveal is on its way, the buttons are held, and a second tap sends nothing.
    expect(wrapper.get('.guess-bar button.primary').attributes('disabled')).toBeDefined();
    await wrapper.get('.guess-bar button.primary').trigger('click');
    expect(send).toHaveBeenCalledTimes(4);
    for (const answer of answers.splice(0)) answer();
    await flushPromises();
    // Once every choice has been answered, the server's snapshot, which carries none, is shown,
    // and the next choice can be revealed again.
    expect(card(wrapper, 2)?.classes()).not.toContain('selected');
    expect(wrapper.get('.guess-bar button.primary').text()).toBe('Reveal a card');
    await card(wrapper, 0)?.trigger('click');
    expect(card(wrapper, 0)?.classes()).toContain('selected');
    expect(wrapper.get('.guess-bar button.primary').attributes('disabled')).toBeUndefined();
    send.mockImplementation(async () => ({ ok: true }));
  });

  test('renders the group chat once, and keeps it after the game', async () => {
    const view = room('bob', []);
    const wrapper = mount(KeywordsGame, { props: { room: view }, global: global() });
    expect(wrapper.findAll('.who-row button')).toHaveLength(1);
    expect(wrapper.text()).toContain('Only the PIs see the colors of hidden cards.');

    const data = view.data as KeywordsRoomData;
    const game = data.game as KeywordsView;
    await wrapper.setProps({
      room: {
        ...view,
        data: { ...data, game: { ...game, phase: 'over', result: { winner: 'red', reason: 'found' } } },
      },
    });
    expect(wrapper.findAll('.who-row button')).toHaveLength(1);
    expect(wrapper.text()).toContain('Accepted');
    expect(wrapper.text()).not.toContain('Only the PIs see the colors of hidden cards.');
    expect(wrapper.find('.actions').classes()).not.toContain('sticky');
  });
});
