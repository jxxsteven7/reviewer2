// @vitest-environment happy-dom
import {
  defaultSettings,
  type ChatMessage,
  type KeywordsRoomData,
  type KeywordsSettings,
  type KeywordsView,
  type RoomView,
  type Seat,
} from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { clearMemory } from '../../core/storage';
import en from '../../locales/en.json';
import ClockBar from './ClockBar.vue';
import ClueLog from './ClueLog.vue';
import CluePanel from './CluePanel.vue';
import DecisionLetter from './DecisionLetter.vue';
import GroupChat from './GroupChat.vue';
import GuessBar from './GuessBar.vue';
import KeywordsCard from './KeywordsCard.vue';
import KeywordsGame from './KeywordsGame.vue';
import RoleBanner from './RoleBanner.vue';
import RulesSheet from './RulesSheet.vue';
import SettingsForm from './SettingsForm.vue';
import TurnStrip from './TurnStrip.vue';

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

// The standard guess rule, under which a clue's number limits the guesses.
const STANDARD: KeywordsSettings = { ...defaultSettings('en'), guessRule: 'standard' };

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
    clock: null,
    history: [{ turn: 2, team: 'red', word: 'Science', count: 2, guesses: [] }],
    result: null,
    selections: [],
    ...(chat ? { chat } : {}),
  };
  const data: KeywordsRoomData = {
    settings: STANDARD,
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

describe('RoleBanner', () => {
  const game = (room('bob').data as KeywordsRoomData).game as KeywordsView;

  test("stands out on the viewer's move, and says so in the tab's title for as long as it lasts", async () => {
    document.title = 'Reviewer 2';
    const wrapper = mount(RoleBanner, { props: { seat: seats.bob as Seat, game }, global: global() });
    expect(wrapper.find('.who').text()).toBe('Red group · Student');
    expect(wrapper.find('.line').text()).toBe('Your turn to guess!');
    expect(wrapper.classes()).toEqual(expect.arrayContaining(['red', 'urgent']));
    expect(document.title).toBe('Your turn!');

    await wrapper.setProps({ game: { ...game, phase: 'clue' } });
    expect(wrapper.find('.line').text()).toBe('Your PI is thinking of a clue.');
    expect(wrapper.classes()).not.toContain('urgent');
    expect(document.title).toBe('Reviewer 2');

    await wrapper.setProps({ game });
    expect(document.title).toBe('Your turn!');
    wrapper.unmount();
    expect(document.title).toBe('Reviewer 2');
  });

  test('tells a spectator who is doing what', () => {
    const wrapper = mount(RoleBanner, { props: { seat: seats.eve as Seat, game }, global: global() });
    expect(wrapper.find('.who').text()).toBe('Spectator');
    expect(wrapper.find('.line').text()).toBe('The Red group is guessing.');
    expect(wrapper.classes()).toEqual(['role-banner', 'spectator']);
  });

  test('reads out its words as they change, but not the button beside them', () => {
    const wrapper = mount(RoleBanner, {
      props: { seat: seats.eve as Seat, game },
      slots: { default: '<button>React (9)</button>' },
      global: global(),
    });
    const live = wrapper.findAll('[aria-live]');
    expect(live).toHaveLength(1);
    expect(live[0]?.find('.line').text()).toBe('The Red group is guessing.');
    expect(live[0]?.find('button').exists()).toBe(false);
    expect(wrapper.find('button').text()).toBe('React (9)');
  });
});

describe('DecisionLetter', () => {
  const over = (result: KeywordsView['result'], remaining = { red: 0, blue: 2 }, gameId = 'g1'): KeywordsView => ({
    ...((room('bob').data as KeywordsRoomData).game as KeywordsView),
    phase: 'over',
    result,
    remaining,
    gameId,
  });
  const letters = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAll('.letter').map((letter) => ({
      to: letter.find('.kicker').text(),
      verdict: letter.find('.verdict').text(),
      body: letter.find('.body').text(),
    }));

  test("gives each group its own letter, and a spectator both, the winner's first", () => {
    const game = over({ winner: 'blue', reason: 'reviewer2' }, { red: 4, blue: 3 });
    const mountFor = (side: 'red' | 'blue' | null) =>
      mount(DecisionLetter, { props: { game, side, isChair: false }, global: global() });
    const [blue] = letters(mountFor('blue'));
    const [red] = letters(mountFor('red'));
    expect(blue?.to).toBe('Decision letter · Blue group');
    expect(blue?.verdict).toBe('Accept (Oral)');
    expect(blue?.body).toContain('Blue group');
    expect(red?.verdict).toBe('Desk Reject');
    expect(letters(mountFor(null))).toEqual([blue, red]);
  });

  test('writes to a winner whose rivals revealed Reviewer 2 about that, not about a finish', () => {
    // The letters as they read for this game, from both sets of the verdict.
    const { t } = i18n().global;
    const set = (name: string) =>
      [1, 2, 3].map((n) =>
        t(`game.letter.bodies.oral.${name}.${n}`, { group: 'Blue group', other: 'Red group', left: 4 }),
      );
    const luck = set('reviewer2');
    const finish = set('found');
    for (let game = 0; game < 12; game += 1) {
      const props = {
        game: over({ winner: 'blue', reason: 'reviewer2' }, { red: 4, blue: 6 }, `g${game}`),
        side: 'blue' as const,
        isChair: false,
      };
      const [letter] = letters(mount(DecisionLetter, { props, global: global() }));
      expect(letter?.verdict).toBe('Accept (Oral)');
      expect(luck).toContain(letter?.body);
      expect(finish).not.toContain(letter?.body);
    }
  });

  test('reads the same for a group however often it is shown, and may differ in the next game', () => {
    const bodies = new Set<string>();
    for (let game = 0; game < 12; game += 1) {
      const props = {
        game: over({ winner: 'red', reason: 'found' }, { red: 0, blue: 1 }, `g${game}`),
        side: 'red' as const,
        isChair: false,
      };
      const first = letters(mount(DecisionLetter, { props, global: global() }));
      expect(letters(mount(DecisionLetter, { props, global: global() }))).toEqual(first);
      expect(first[0]?.verdict).toBe('Accept (Poster)');
      bodies.add(first[0]?.body ?? '');
    }
    expect(bodies.size).toBeGreaterThan(1);
  });

  test('has one letter for everyone when the chair withdrew the game, and offers the chair another game', async () => {
    const game = over({ winner: null, reason: 'withdrawn' });
    for (const side of ['red', null] as const) {
      const wrapper = mount(DecisionLetter, { props: { game, side, isChair: side === 'red' }, global: global() });
      expect(letters(wrapper).map(({ verdict }) => verdict)).toEqual(['Withdrawn']);
    }
    const chair = mount(DecisionLetter, { props: { game, side: 'red', isChair: true }, global: global() });
    await chair.find('button').trigger('click');
    expect(chair.emitted('again')).toHaveLength(1);
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
  const DATA = '\u6570\u636e'; // "data"
  const NUMBER = '\u6570\u5b57'; // "number", which shares a character with DATA
  const board = [
    ...cards('Model', 'Peer review'),
    { word: JOURNAL, revealed: false, translations: ['Journal'] },
    { word: 'Data', revealed: false, translations: [DATA], forms: ['dataset'] },
  ];
  const panel = (settings: KeywordsSettings = STANDARD, language: 'en' | 'zh' = 'en') =>
    mount(CluePanel, {
      props: {
        game: { ...(room('ann').data as KeywordsRoomData).game, cards: board } as KeywordsView,
        settings,
        language,
        busy: false,
      },
      global: global(),
    });
  const counts = (wrapper: ReturnType<typeof panel>) =>
    wrapper.findAll('.counts button').map((button) => button.text());

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

  test("offers the numbers of the room's guess rule", () => {
    expect(counts(panel())).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '\u221e']);
    // Red has 9 cards left in the test game.
    expect(counts(panel({ ...STANDARD, guessRule: 'free' }))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  });

  test('refuses a listed form under the strict rule, and only warns about it under the loose one', async () => {
    const strict = panel();
    await strict.get('input').setValue('datasets');
    expect(strict.get('.problem').text()).toBe(
      '\u201cData\u201d (dataset) is on the board, and this clue repeats a form of it that the word lists give. ' +
        "This room's clue check doesn't allow it.",
    );
    // The form is named after the card when the clue only repeats a part of it.
    await strict.get('input').setValue('dataset-scale');
    expect(strict.get('.problem').text()).toContain('\u201cData\u201d (dataset) is on the board');
    const loose = panel({ ...STANDARD, clueRule: 'loose' });
    await loose.get('input').setValue('datasets');
    expect(loose.find('.problem').exists()).toBe(false);
    expect(loose.get('.warning').text()).toBe(
      'This clue repeats a form that the word lists give of a word still on the board: \u201cData\u201d (dataset). ' +
        "This room's clue check leaves it to you.",
    );
  });

  test('gives one line to each kind of warning', async () => {
    const wrapper = panel();
    await wrapper.get('input').setValue(NUMBER);
    expect(wrapper.findAll('.warning').map((line) => line.text())).toEqual([
      `This clue has a Chinese character in common with a word still on the board: \u201cData\u201d (${DATA}). ` +
        "It's your call.",
    ]);
    await wrapper.get('input').setValue('metamodeling');
    expect(wrapper.findAll('.warning')).toHaveLength(1);
    await wrapper.get('input').setValue('datacenter');
    expect(wrapper.get('.warning').text()).toContain('contains a word still on the board: \u201cData\u201d.');
  });

  test("shows the room's limit on the length of a clue, and holds a clue that goes over it", async () => {
    const wrapper = panel({ ...STANDARD, clueLength: 2 });
    expect(wrapper.get('.limit').text()).toBe('Words in a clue: at most 2.');
    await wrapper.get('input').setValue('gentle nudge');
    expect(wrapper.find('.problem').exists()).toBe(false);
    await wrapper.get('input').setValue('a gentle nudge');
    expect(wrapper.get('.problem').text()).toBe('That clue has more words than this room allows.');
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
    const chinese = panel({ ...STANDARD, clueLength: 4 }, 'zh');
    expect(chinese.get('.limit').text()).toBe('Chinese characters in a clue: at most 4.');
  });
});

describe('TurnStrip', () => {
  const game = (room('bob').data as KeywordsRoomData).game as KeywordsView;

  test('shows how many guesses are left under the standard rule only', () => {
    const standard = mount(TurnStrip, { props: { game, guessRule: 'standard' }, global: global() });
    expect(standard.get('.left').text()).toBe('Guesses left: 3');
    const free = mount(TurnStrip, {
      props: { game: { ...game, guessesLeft: null }, guessRule: 'free' },
      global: global(),
    });
    expect(free.find('.left').exists()).toBe(false);
  });

  test('shows the time that the phase has left, if it has a limit', () => {
    const untimed = mount(TurnStrip, { props: { game, guessRule: 'free' }, global: global() });
    expect(untimed.find('.clock').exists()).toBe(false);
    const timed = mount(TurnStrip, {
      props: { game: { ...game, clock: { left: 42_000, total: 90_000 } }, guessRule: 'free' },
      global: global(),
    });
    expect(timed.get('.clock').attributes('aria-label')).toBe('42 seconds left');
  });
});

describe('ClockBar', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('counts down from what the server said, turns red for the last 10 seconds, and stops at zero', async () => {
    const wrapper = mount(ClockBar, { props: { clock: { left: 12_000, total: 60_000 } }, global: global() });
    expect(wrapper.get('.seconds').text()).toBe('0:12');
    expect(wrapper.get('.fill').attributes('style')).toContain('scaleX(0.2)');
    expect(wrapper.classes()).not.toContain('urgent');
    vi.advanceTimersByTime(2_000);
    await flushPromises();
    expect(wrapper.get('.seconds').text()).toBe('0:10');
    expect(wrapper.classes()).toContain('urgent');
    vi.advanceTimersByTime(30_000);
    await flushPromises();
    expect(wrapper.get('.seconds').text()).toBe('0:00');
    expect(wrapper.get('.fill').attributes('style')).toContain('scaleX(0)');
  });

  test('sets itself right with every snapshot', async () => {
    const wrapper = mount(ClockBar, { props: { clock: { left: 50_000, total: 60_000 } }, global: global() });
    vi.advanceTimersByTime(5_000);
    await wrapper.setProps({ clock: { left: 30_000, total: 60_000 } });
    expect(wrapper.get('.seconds').text()).toBe('0:30');
    vi.advanceTimersByTime(1_000);
    await flushPromises();
    expect(wrapper.get('.seconds').text()).toBe('0:29');
  });

  // How long the clock waits between wakeups, until it sets no further timer.
  function waits(): number[] {
    const result: number[] = [];
    for (let i = 0; i < 10 && vi.getTimerCount() > 0; i += 1) {
      const before = performance.now();
      vi.advanceTimersToNextTimer();
      result.push(performance.now() - before);
    }
    return result;
  }

  // A page with a clock has nothing to draw between two seconds, so the clock wakes up only when
  // the seconds shown change.
  test('wakes up once a second, when the seconds change, and no more once it is at zero', async () => {
    const wrapper = mount(ClockBar, { props: { clock: { left: 2_300, total: 60_000 } }, global: global() });
    expect(wrapper.get('.seconds').text()).toBe('0:03');
    expect(waits()).toEqual([300, 1_000, 1_000]);
    await flushPromises();
    expect(wrapper.get('.seconds').text()).toBe('0:00');

    const running = mount(ClockBar, { props: { clock: { left: 30_000, total: 60_000 } }, global: global() });
    expect(vi.getTimerCount()).toBe(1);
    running.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  // The time left is rarely a whole number of milliseconds, and a timer drops the fraction: a wait
  // of 300.5 ms that was not rounded up would end before the second changed, and the clock would
  // have to wake up twice for one second.
  test('rounds its waits up to whole milliseconds', async () => {
    const wrapper = mount(ClockBar, { props: { clock: { left: 2_300.5, total: 60_000 } }, global: global() });
    expect(waits()).toEqual([301, 1_000, 1_000]);
    await flushPromises();
    expect(wrapper.get('.seconds').text()).toBe('0:00');
  });

  test('shows minutes and seconds', () => {
    const wrapper = mount(ClockBar, { props: { clock: { left: 600_000, total: 600_000 } }, global: global() });
    expect(wrapper.get('.seconds').text()).toBe('10:00');
  });
});

describe('ClueLog', () => {
  test('says when a turn ran out of time, before the clue or during the guesses', () => {
    const game = (room('bob').data as KeywordsRoomData).game as KeywordsView;
    const history: KeywordsView['history'] = [
      { turn: 1, team: 'red', word: null, count: null, guesses: [], timedOut: true },
      { turn: 2, team: 'blue', word: 'Science', count: 2, guesses: [{ card: 0, color: 'blue' }], timedOut: true },
      { turn: 3, team: 'red', word: 'Loss', count: 1, guesses: [] },
    ];
    const wrapper = mount(ClueLog, { props: { game: { ...game, history } }, global: global() });
    const items = wrapper.findAll('li');
    expect(items[2]?.text()).toContain('No clue in time');
    expect(items[1]?.text()).toContain('Science');
    expect(items[1]?.text()).toContain('Time ran out');
    expect(items[0]?.text()).not.toContain('Time ran out');
  });
});

describe('RulesSheet', () => {
  // The lines of the rules' section on time, once the sheet is open, in a room with these time
  // limits.
  const timeLines = async (times: Partial<KeywordsSettings>) => {
    const wrapper = mount(RulesSheet, {
      props: { settings: { ...STANDARD, ...times }, language: 'en' },
      global: global(),
    });
    await wrapper.get('button').trigger('click');
    const section = wrapper.findAll('.rules section').find((found) => found.get('h3').text() === 'Time');
    return section?.findAll('p').map((line) => line.text());
  };
  const BAR = 'The settings above say how much time each phase has, and the bar under the turn shows what is left.';
  const CLUE = 'A PI who gives no clue in time loses the turn to the other group.';
  const GUESS = 'Students whose time runs out end their turn, even if they have revealed nothing.';

  test('tells what time does in the phases that have a limit, and nothing about the others', async () => {
    expect(await timeLines({})).toEqual([BAR, CLUE, GUESS]);
    expect(await timeLines({ guessTime: 0 })).toEqual([BAR, CLUE]);
    expect(await timeLines({ firstClueTime: 0 })).toEqual([BAR, CLUE, GUESS]);
    expect(await timeLines({ firstClueTime: 0, clueTime: 0 })).toEqual([BAR, GUESS]);
    expect(await timeLines({ firstClueTime: 0, clueTime: 0, guessTime: 0 })).toEqual(['This room has no time limits.']);
  });
});

describe('SettingsForm', () => {
  const form = (language: 'en' | 'zh' = 'en', settings = defaultSettings(language)) =>
    mount(SettingsForm, { props: { modelValue: settings, language }, global: global() });
  const sent = (wrapper: ReturnType<typeof form>) =>
    wrapper.emitted('update:modelValue')?.at(-1)?.[0] as KeywordsSettings;
  // The form says whether the settings will do when that changes; they start out fine.
  const valid = (wrapper: ReturnType<typeof form>) => wrapper.emitted('update:valid')?.at(-1)?.[0] ?? true;
  // The parent takes what the form sends, as v-model does.
  const take = (wrapper: ReturnType<typeof form>) => wrapper.setProps({ modelValue: sent(wrapper) });
  const boxes = (wrapper: ReturnType<typeof form>) => wrapper.findAll('input[inputmode="numeric"]');

  test('sends the rules that are chosen', async () => {
    const wrapper = form();
    await wrapper.find('input[value="standard"]').setValue(true);
    expect(sent(wrapper).guessRule).toBe('standard');
  });

  test('takes whole numbers in range, full-width digits too, and says what is wrong with the rest', async () => {
    const wrapper = form();
    const [length, first] = boxes(wrapper);
    await first?.setValue('\uff11\uff12\uff10');
    expect(sent(wrapper).firstClueTime).toBe(120);
    expect(valid(wrapper)).toBe(true);
    await take(wrapper);

    await first?.setValue('5');
    await take(wrapper);
    expect(wrapper.text()).toContain('0, or from 10 to 600.');
    expect(valid(wrapper)).toBe(false);

    await first?.setValue('1.5');
    await take(wrapper);
    expect(wrapper.text()).toContain('Enter a whole number.');
    // What was typed stays in the box.
    expect((first?.element as HTMLInputElement).value).toBe('1.5');

    await length?.setValue('4');
    await take(wrapper);
    expect(wrapper.text()).toContain('From 1 to 3.');
    await first?.setValue('0');
    await length?.setValue('3');
    await take(wrapper);
    expect(valid(wrapper)).toBe(true);
  });

  test('counts a clue in Chinese characters in a Chinese room', async () => {
    const wrapper = form('zh');
    expect(wrapper.text()).toContain('Chinese characters in a clue');
    expect((boxes(wrapper)[0]?.element as HTMLInputElement).value).toBe('4');
    // Another language brings its own default length.
    await wrapper.setProps({ language: 'en' });
    expect(sent(wrapper).clueLength).toBe(1);
  });

  test('shows settings that change elsewhere', async () => {
    const wrapper = form();
    await wrapper.setProps({ modelValue: { ...defaultSettings('en'), guessTime: 45 } });
    expect((boxes(wrapper)[3]?.element as HTMLInputElement).value).toBe('45');
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

  test('shows both letters to a player who sat down only after the game, as to a spectator', () => {
    const view = room('bob');
    const data = view.data as KeywordsRoomData;
    const game = {
      ...(data.game as KeywordsView),
      phase: 'over' as const,
      result: { winner: 'red' as const, reason: 'found' as const },
    };
    const wrapper = mount(KeywordsGame, {
      props: { room: { ...view, data: { ...data, side: null, game } } },
      global: global(),
    });
    expect(wrapper.findAll('.letter .verdict').map((verdict) => verdict.text())).toEqual(['Accept (Oral)', 'Reject']);
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
    expect(wrapper.find('.letter .verdict').text()).toBe('Accept (Oral)');
    expect(wrapper.text()).not.toContain('Only the PIs see the colors of hidden cards.');
    expect(wrapper.find('.actions').classes()).not.toContain('sticky');
  });
});
