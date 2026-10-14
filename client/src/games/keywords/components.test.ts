// @vitest-environment happy-dom
import {
  clueCounts,
  defaultSettings,
  type ChatMessage,
  type ClueRecord,
  type KeywordsReplay,
  type KeywordsRoomData,
  type KeywordsSettings,
  type KeywordsView,
  type MatchView,
  type RoomView,
  type Seat,
  type StandingView,
} from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { computed, defineComponent, h } from 'vue';
import { createI18n } from 'vue-i18n';
import { bubbles } from '../../core/emotes';
import { clearMemory, readStored, writeStored } from '../../core/storage';
import { seenIn } from './chat';
import { toasts } from '../../core/toast';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';
import ClockBar from './ClockBar.vue';
import ClueLog from './ClueLog.vue';
import CluePanel from './CluePanel.vue';
import DecisionLetter from './DecisionLetter.vue';
import GameRosters from './GameRosters.vue';
import GroupChat from './GroupChat.vue';
import GuessBar from './GuessBar.vue';
import KeywordsCard from './KeywordsCard.vue';
import KeywordsGame from './KeywordsGame.vue';
import { missedLine } from './missed';
import ReplayViewer from './ReplayViewer.vue';
import RoleBanner from './RoleBanner.vue';
import RulesSheet from './RulesSheet.vue';
import SettingsForm from './SettingsForm.vue';
import TurnStrip from './TurnStrip.vue';
import { HOLD_MS, TAP_MS } from './useCardGestures';
import { useChatLine } from './useChatLine';

const send = vi.hoisted(() =>
  vi.fn<(event: string, payload?: object) => Promise<{ ok: boolean }>>(async () => ({ ok: true })),
);
// The page is connected already.
const page = vi.hoisted(() => ({ connection: { connected: true, everConnected: true } }));
vi.mock('../../core/socket', async () => {
  const { computed, reactive } = await import('vue');
  page.connection = reactive(page.connection);
  const reconnecting = computed(() => page.connection.everConnected && !page.connection.connected);
  return {
    send,
    act: (event: string, payload: object = {}) => send(event, payload),
    onceConnected: (run: () => void) => {
      run();
      return () => {};
    },
    socket: { connected: true, on: vi.fn(), once: vi.fn() },
    connection: page.connection,
    reconnecting,
  };
});

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
    paused: false,
    remaining: { red: 9, blue: 8 },
    clue: { word: 'Science', count: 2 },
    guessesMade: 0,
    guessesLeft: 3,
    clock: null,
    history: [{ turn: 2, team: 'red', word: 'Science', count: 2, guesses: [] }],
    events: [],
    extended: { red: false, blue: false },
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
    lineup: 'free',
    joinsNext: false,
    mayEmote: true,
    game,
  };
  return {
    roomId: 'r1',
    code: 'K7QX',
    rev: 1,
    game: 'keywords',
    language: 'en',
    fields: ['general'],
    public: false,
    customWordCount: 0,
    phase: 'playing',
    round: 1,
    gameId: 'g1',
    chairId: 'ann',
    players: ['ann', 'bob', 'cat', 'eve'].map((id) => ({ id, name: id[0]?.toUpperCase() + id.slice(1), online: true })),
    agents: false,
    screens: 0,
    me,
    match: null,
    streaks: [],
    duos: [],
    agentsPlayed: false,
    points: [],
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

  // The chat as the page shows it: the line and its sending are the page's (useChatLine.ts), and
  // the panel and the button are two chats, one at a time, as on the page.
  const chatOf = (view: RoomView) =>
    defineComponent({
      props: { panel: { type: Boolean, default: false } },
      setup(props) {
        const line = useChatLine(computed(() => (view.data as KeywordsRoomData).game ?? null));
        return () =>
          h(GroupChat, {
            key: props.panel ? 'panel' : 'button',
            room: view,
            panel: props.panel,
            draft: line.draft.value,
            'onUpdate:draft': (draft: string) => (line.draft.value = draft),
            sending: line.sending.value,
            onSend: line.say,
          });
      },
    });

  test("shows a student the others' new messages, by turn", async () => {
    const wrapper = mount(GroupChat, {
      props: { room: room('bob', messages), draft: '', sending: false },
      global: global(),
    });
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
    const wrapper = mount(chatOf(room('bob', [])), { global: global() });
    await wrapper.get('button').trigger('click');
    expect(wrapper.text()).toContain('No messages yet.');
    // The teleport stub renders the sheet anew whenever the line changes, so the input and the
    // button are looked up again each time.
    const input = () => wrapper.get('input');
    const sendButton = () => wrapper.get('form button[type="submit"]');

    expect(sendButton().attributes('disabled')).toBeDefined();
    await input().setValue('x'.repeat(201));
    expect(sendButton().attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('That message is too long.');

    await input().setValue('  the second row  ');
    expect(sendButton().attributes('disabled')).toBeUndefined();
    expect(wrapper.get('.hint').text()).toBe('14/200');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('keywords:say', { gameId: 'g1', text: '  the second row  ' });
    expect((input().element as HTMLInputElement).value).toBe('');
    expect(wrapper.get('.hint').text()).toBe('0/200');
  });

  test('keeps the input and its focus after sending, so that a phone keeps its keyboard open', async () => {
    const wrapper = mount(chatOf(room('bob', [])), { global: { plugins: [i18n()] }, attachTo: document.body });
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
    const wrapper = mount(chatOf(room('bob', [])), { global: global() });
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

  test('keeps a half-written line, and brings back a refused one, while the sheet is closed', async () => {
    const answers: ((reply: { ok: boolean; error?: string }) => void)[] = [];
    send.mockImplementationOnce(() => new Promise<{ ok: boolean }>((resolve) => answers.push(resolve)));
    const wrapper = mount(chatOf(room('bob', [])), { global: global() });
    await wrapper.get('button').trigger('click');
    await wrapper.get('input').setValue('first');
    await wrapper.get('form').trigger('submit');
    await wrapper.get('input').setValue('half a');
    // The sheet closes, on the board a student wants a look at, and takes the thread with it.
    await wrapper.get('.close').trigger('click');
    expect(wrapper.find('input').exists()).toBe(false);
    answers[0]?.({ ok: false, error: 'offline' });
    await flushPromises();
    await wrapper.get('button').trigger('click');
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('first half a');
  });

  test('keeps a message on its way, and brings back a refused one, as the panel gives way to the button', async () => {
    const answers: ((reply: { ok: boolean; error?: string }) => void)[] = [];
    send.mockImplementationOnce(() => new Promise<{ ok: boolean }>((resolve) => answers.push(resolve)));
    const wrapper = mount(chatOf(room('bob', [])), { props: { panel: true }, global: global() });
    await wrapper.get('.chat-panel input').setValue('first');
    await wrapper.get('form').trigger('submit');
    await wrapper.get('input').setValue('half a');
    // The page narrows while the message is on its way, as a tablet turns: the panel goes, and the
    // button and the sheet come, which the student opens. The line is there, and nothing else can
    // be sent until the answer comes.
    await wrapper.setProps({ panel: false });
    expect(wrapper.find('.chat-panel').exists()).toBe(false);
    await wrapper.get('button').trigger('click');
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('half a');
    expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeDefined();
    answers[0]?.({ ok: false, error: 'offline' });
    await flushPromises();
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('first half a');
    expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('lets a PI read the chat but not write in it', async () => {
    const wrapper = mount(GroupChat, {
      props: { room: room('ann', messages), draft: '', sending: false },
      global: global(),
    });
    await wrapper.get('button').trigger('click');
    expect(wrapper.findAll('.message')).toHaveLength(3);
    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.text()).toContain('the clue is all a PI may say');
  });

  test('stays open after the game to those who played for the group, the PI too, after the turns', async () => {
    const talk: ChatMessage[] = [...messages, { id: 4, player: 'ann', turn: 2, text: 'well played', after: true }];
    for (const me of ['bob', 'ann']) {
      const wrapper = mount(GroupChat, {
        props: { room: room(me, talk, 'over'), draft: '', sending: false },
        global: global(),
      });
      await wrapper.get('button').trigger('click');
      expect(wrapper.find('input').exists()).toBe(true);
      expect(wrapper.text()).toContain('The game is over: talk it over with your group');
      expect(wrapper.findAll('.turn').map((turn) => turn.get('.turn-title').text())).toEqual([
        'Turn 1',
        'Turn 2',
        'After the game',
      ]);
      wrapper.unmount();
    }
    // Whoever sat down in the group after the end reads.
    const late = room('eve', talk, 'over');
    (late.data as KeywordsRoomData).seats = { ...seats, eve: { team: 'red', role: 'guesser' } };
    const wrapper = mount(GroupChat, { props: { room: late, draft: '', sending: false }, global: global() });
    await wrapper.get('button').trigger('click');
    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.text()).toContain('After the game, only those who played for the group in it can write here.');
    // The messages read here count for no other test.
    localStorage.clear();
  });

  test('brings up the keyboard on opening while there is nothing to read, and not once there is', async () => {
    const opened = async (chat: ChatMessage[]) => {
      const wrapper = mount(GroupChat, {
        props: { room: room('bob', chat), draft: '', sending: false },
        global: global(),
        attachTo: document.body,
      });
      await wrapper.get('button').trigger('click');
      await flushPromises();
      const focused = document.activeElement?.tagName;
      wrapper.unmount();
      return focused;
    };
    expect(await opened([])).toBe('INPUT');
    expect(await opened(messages)).toBe('SECTION');
  });

  test('offers nothing to someone without a chat, such as a spectator', () => {
    const wrapper = mount(GroupChat, { props: { room: room('eve'), draft: '', sending: false }, global: global() });
    expect(wrapper.find('button').exists()).toBe(false);
  });

  test('stands open beside the board as a panel, where every message counts as read', () => {
    const wrapper = mount(GroupChat, {
      props: { room: room('bob', messages), panel: true, draft: '', sending: false },
      global: global(),
    });
    expect(wrapper.find('.open-chat').exists()).toBe(false);
    expect(wrapper.get('.chat-panel h2').text()).toBe('Chat of the Red group');
    expect(wrapper.findAll('.turn').map((turn) => turn.get('.turn-title').text())).toEqual(['Turn 1', 'Turn 2']);
    expect(wrapper.findAll('.message')).toHaveLength(3);
    expect(wrapper.find('input').exists()).toBe(true);
    expect(wrapper.find('.badge').exists()).toBe(false);
    expect(seenIn('g1')).toBe(3);
  });

  test('lets a PI read the panel but not write in it', () => {
    const wrapper = mount(GroupChat, {
      props: { room: room('ann', messages), panel: true, draft: '', sending: false },
      global: global(),
    });
    expect(wrapper.findAll('.chat-panel .message')).toHaveLength(3);
    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.text()).toContain('the clue is all a PI may say');
  });

  test('shows a spectator no panel', () => {
    const wrapper = mount(GroupChat, {
      props: { room: room('eve'), panel: true, draft: '', sending: false },
      global: global(),
    });
    expect(wrapper.find('.chat-panel').exists()).toBe(false);
    expect(wrapper.text()).toBe('');
  });
});

describe('RoleBanner', () => {
  const game = (room('bob').data as KeywordsRoomData).game as KeywordsView;

  test("stands out on the viewer's move, and says so in the tab's title for as long as it lasts", async () => {
    document.title = 'Reviewer 2';
    const wrapper = mount(RoleBanner, { props: { seat: seats.bob as Seat, game }, global: global() });
    expect(wrapper.find('.who').text()).toBe('You are Red group · Student');
    expect(wrapper.find('.line').text()).toBe('Your turn to guess!');
    expect(wrapper.classes()).toEqual(expect.arrayContaining(['red', 'urgent']));
    expect(document.title).toBe('Your turn!');

    await wrapper.setProps({ game: { ...game, phase: 'clue' } });
    expect(wrapper.find('.line').text()).toBe('Your PI is thinking of a clue\u2026');
    expect(wrapper.find('.line .dots').text()).toBe('\u2026');
    expect(wrapper.classes()).not.toContain('urgent');
    expect(document.title).toBe('Reviewer 2');

    await wrapper.setProps({ game });
    expect(document.title).toBe('Your turn!');
    wrapper.unmount();
    expect(document.title).toBe('Reviewer 2');
  });

  test('tells a spectator who is doing what', () => {
    const wrapper = mount(RoleBanner, { props: { seat: seats.eve as Seat, game }, global: global() });
    expect(wrapper.find('.who').text()).toBe('You are a spectator');
    expect(wrapper.find('.line').text()).toBe('The Red group is guessing\u2026');
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
    expect(live[0]?.find('.line').text()).toBe('The Red group is guessing\u2026');
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
    await chair.find('.decision > button').trigger('click');
    expect(chair.emitted('again')).toHaveLength(1);
  });

  test('says what a decision means when it is tapped, except on a big screen', async () => {
    const game = over({ winner: 'red', reason: 'found' }, { red: 0, blue: 2 });
    const wrapper = mount(DecisionLetter, {
      props: { game, side: 'red', isChair: false },
      global: global(),
      attachTo: document.body,
    });
    await wrapper.find('.verdict button').trigger('click');
    const sheet = document.body.querySelector('[role=dialog]');
    expect(sheet?.textContent).toContain('Accept (Spotlight)');
    expect(sheet?.textContent).toContain('two or three keywords');
    wrapper.unmount();
    const screen = mount(DecisionLetter, {
      props: { game, side: null, isChair: false, compact: true },
      global: global(),
    });
    expect(screen.find('.verdict button').exists()).toBe(false);
    expect(screen.find('.verdict').text()).toBe('Accept (Spotlight)');
  });
});

describe('KeywordsCard', () => {
  const card = { word: 'Baseline', revealed: false };

  test('shows who in the group has chosen it, as avatars, and names them to screen readers', () => {
    const wrapper = mount(KeywordsCard, {
      props: { card, index: 3, selectable: true, selected: false, choosers: [{ name: 'Ann' }, { name: 'Cat' }] },
      global: global(),
    });
    expect(wrapper.get('.choosers').attributes('aria-hidden')).toBe('true');
    expect(wrapper.findAll('.choosers .avatar')).toHaveLength(2);
    expect(wrapper.get('button').attributes('aria-label')).toBe('Baseline, not revealed, chosen by Ann and Cat');
  });

  test("shows the group's mark in the tint of its color, with its sticker, and names it to screen readers", () => {
    const wrapper = mount(KeywordsCard, {
      props: {
        card,
        index: 3,
        selectable: true,
        selected: false,
        choosers: [],
        note: { mark: 'theirs', color: 'blue' },
      },
      global: global(),
    });
    expect(wrapper.get('button').classes()).toEqual(expect.arrayContaining(['noted', 'note-blue']));
    expect(wrapper.get('.note').classes()).toContain('blue');
    expect(wrapper.get('.note').attributes('aria-hidden')).toBe('true');
    expect(wrapper.get('button').attributes('aria-label')).toBe('Baseline, not revealed, marked as theirs');
  });

  test('shows no names when nobody else has chosen it', () => {
    const wrapper = mount(KeywordsCard, {
      props: { card, index: 3, selectable: true, selected: true, choosers: [] },
      global: global(),
    });
    expect(wrapper.find('.choosers').exists()).toBe(false);
    expect(wrapper.get('button').classes()).toContain('selected');
  });

  test('labels an irrelevant paper N/A in its corner, and Irrelevant to a screen reader', () => {
    const wrapper = mount(KeywordsCard, {
      props: {
        card: { ...card, color: 'neutral', revealed: true },
        index: 3,
        selectable: false,
        selected: false,
        choosers: [],
      },
      // The board's lang is the words', as in a replay of a Chinese game seen in English.
      attrs: { lang: 'zh-CN' },
      global: global(),
    });
    expect(wrapper.get('.tag').text()).toBe('N/A');
    // The label's own lang is the interface's, which sets its size.
    expect(wrapper.get('.tag').attributes('lang')).toBe('en');
    expect(wrapper.get('button').attributes('aria-label')).toBe('Baseline, Irrelevant');
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
  // The numbers that the rule offers the PI's group, which has 9 cards left in the test game.
  const countsOf = (settings: KeywordsSettings) => clueCounts(settings.guessRule, 9);
  const panel = (settings: KeywordsSettings = STANDARD, language: 'en' | 'zh' = 'en', targets: number[] = []) =>
    mount(CluePanel, {
      props: {
        game: { ...(room('ann').data as KeywordsRoomData).game, cards: board } as KeywordsView,
        counts: countsOf(settings),
        settings,
        language,
        busy: false,
        targets,
      },
      global: global(),
    });
  const chosen = (wrapper: ReturnType<typeof panel>) => wrapper.get('.counts button.chosen').text();
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

  test('offers the numbers it is given, as the rule allows them', () => {
    expect(counts(panel())).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '\u221e']);
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
      'This clue has a character in common with a word still on the board, as a Chinese character, a number ' +
        `however it is written, or the English or the pinyin of a character: \u201cData\u201d (${DATA}). ` +
        "It's your call.",
    ]);
    // In an English room, a clue that contains a word on the board is a warning under either rule.
    await wrapper.get('input').setValue('metamodeling');
    expect(wrapper.find('.problem').exists()).toBe(false);
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
    expect(chinese.get('.limit').text()).toBe(
      'At most 4 characters: a Chinese character counts as one, two letters or digits as one. An English word or abbreviation is fine, but not the English for a word on the board, nor its pinyin.',
    );
    // Eight letters fit; nine don't. The pinyin of a card is refused.
    await chinese.get('input').setValue('abcdefgh');
    expect(chinese.find('.problem').exists()).toBe(false);
    await chinese.get('input').setValue('abcdefghi');
    expect(chinese.get('.problem').text()).toBe('That clue is too long.');
    // In a Chinese room, a clue that contains a Latin word on the board is refused under the
    // strict rule, which the room has.
    await chinese.setProps({ game: { ...chinese.props('game'), cards: [{ word: 'Python', revealed: false }] } });
    await chinese.get('input').setValue('Pythonic');
    expect(chinese.get('.problem').text()).toBe(
      "This clue contains \u201cPython\u201d, which is on the board. This room's clue check doesn't allow it.",
    );
    await chinese.setProps({
      game: { ...chinese.props('game'), cards: [{ word: '\u57fa\u56e0', revealed: false, pinyin: 'ji yin' }] },
    });
    await chinese.get('input').setValue('JiYin');
    expect(chinese.get('.problem').text()).toBe(
      "\u201c\u57fa\u56e0\u201d (ji yin) is on the board. A clue can't be a word on the board, or part of one.",
    );
  });

  test('asks the PI loudly to mark the cards the clue is for, and counts and names them once marked', async () => {
    const wrapper = panel();
    await wrapper.setProps({ team: 'red' });
    // A sticker in the group's tint until a card is marked, with a "Tips" tag for the eye alone.
    expect(wrapper.get('.targets').classes()).toEqual(['targets', 'none', 'red']);
    expect(wrapper.get('.targets .tips').text()).toBe('Tips');
    expect(wrapper.get('.targets .tips').attributes('aria-hidden')).toBe('true');
    expect(wrapper.get('.targets').text()).toBe(
      'Tips First tap the cards this clue is meant for, and the number follows. ' +
        'Nobody sees them during the game; the replay shows them.',
    );
    await wrapper.setProps({ targets: [1] });
    expect(wrapper.get('.targets').classes()).toEqual(['targets']);
    expect(wrapper.get('.targets').text()).toBe(
      '1 card marked: \u201cPeer review\u201d. Everyone sees it after the game.',
    );
    await wrapper.setProps({ targets: [1, 0] });
    expect(wrapper.get('.targets').text()).toBe(
      '2 cards marked: \u201cPeer review\u201d and \u201cModel\u201d. Everyone sees them after the game.',
    );
    // Nothing more is asked of a clue without marks: it goes at the first tap.
    await wrapper.setProps({ targets: [] });
    await wrapper.get('input').setValue('Science');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('give')).toEqual([['Science', 1]]);
  });

  test('sets the number to how many cards are marked, until the PI picks one', async () => {
    const wrapper = panel({ ...STANDARD, guessRule: 'free' });
    expect(chosen(wrapper)).toBe('1');
    await wrapper.setProps({ targets: [0, 1, 2] });
    expect(chosen(wrapper)).toBe('3');
    await wrapper.setProps({ targets: [0, 1] });
    expect(chosen(wrapper)).toBe('2');
    // With no card marked, the number goes back to where it started.
    await wrapper.setProps({ targets: [] });
    expect(chosen(wrapper)).toBe('1');
    await wrapper.setProps({ targets: [0, 1] });
    // The PI picks a number: from then on it stays, whatever is marked.
    const four = wrapper.findAll('.counts button').find((button) => button.text() === '4');
    await four?.trigger('click');
    await wrapper.setProps({ targets: [0] });
    expect(chosen(wrapper)).toBe('4');
    await wrapper.get('input').setValue('Science');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('give')).toEqual([['Science', 4]]);
  });

  test('holds the clue while the PI prepares it ahead of their turn, and says that only they see it', async () => {
    const wrapper = mount(CluePanel, {
      props: {
        game: { ...(room('ann').data as KeywordsRoomData).game, cards: board } as KeywordsView,
        counts: countsOf(STANDARD),
        settings: STANDARD,
        language: 'en',
        canGive: false,
        word: 'Sci',
      },
      global: global(),
    });
    expect(wrapper.classes()).toContain('draft');
    expect(wrapper.get('.ahead').text()).toBe(
      "This is the draft of your next clue. Only you see it, and you give it once it's your turn.",
    );
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('Sci');
    // The keyboard's enter key can't send the clue yet, and says so.
    expect(wrapper.get('input').attributes('enterkeyhint')).toBe('done');
    await wrapper.get('input').setValue('Science');
    expect(wrapper.find('.problem').exists()).toBe(false);
    const submit = () => wrapper.get('button[type="submit"]');
    expect(submit().attributes('disabled')).toBeDefined();
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('give')).toBeUndefined();
    // The word and the number picked are told to whoever keeps the draft.
    expect(wrapper.emitted('update:word')).toEqual([['Science']]);
    await wrapper
      .findAll('.counts button')
      .find((button) => button.text() === '4')
      ?.trigger('click');
    expect(wrapper.emitted('update:count')).toEqual([[4]]);
    // The turn comes.
    await wrapper.setProps({ canGive: true });
    expect(wrapper.find('.ahead').exists()).toBe(false);
    expect(wrapper.classes()).not.toContain('draft');
    expect(wrapper.get('input').attributes('enterkeyhint')).toBe('send');
    expect(submit().attributes('disabled')).toBeUndefined();
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('give')).toEqual([['Science', 4]]);
  });

  test('says which marked cards were revealed meanwhile', async () => {
    const wrapper = mount(CluePanel, {
      props: {
        game: { ...(room('ann').data as KeywordsRoomData).game, cards: board } as KeywordsView,
        counts: countsOf(STANDARD),
        settings: STANDARD,
        language: 'en',
        gone: ['Model'],
      },
      global: global(),
    });
    expect(wrapper.get('.gone').text()).toBe(
      'You marked \u201cModel\u201d, which has been revealed, so the mark is gone.',
    );
    await wrapper.setProps({ gone: ['Model', 'Data'] });
    expect(wrapper.get('.gone').text()).toBe(
      'You marked \u201cModel\u201d and \u201cData\u201d, which have been revealed, so the marks are gone.',
    );
    await wrapper.setProps({ gone: [] });
    expect(wrapper.find('.gone').exists()).toBe(false);
  });

  // A Chinese room's page is in Chinese, and there a clue is one word whatever the settings.
  test('tells a Chinese room plainly that a clue has no spaces, and that English may do', async () => {
    const wrapper = mount(CluePanel, {
      props: {
        game: { ...(room('ann').data as KeywordsRoomData).game, cards: board } as KeywordsView,
        counts: countsOf(STANDARD),
        settings: { ...STANDARD, clueLength: 4 },
        language: 'zh',
      },
      global: { plugins: [createI18n({ legacy: false, locale: 'zh', messages: { zh } })] },
    });
    expect(wrapper.get('.limit').text()).toContain(
      '\u4e24\u4e2a\u5b57\u6bcd\u6216\u6570\u5b57\u7b97\u4e00\u4e2a\u5b57',
    );
    await wrapper.get('input').setValue('GPU');
    expect(wrapper.find('.problem').exists()).toBe(false);
    await wrapper.get('input').setValue('deep learning');
    expect(wrapper.get('.problem').text()).toBe('中文房间的提示只能是一个词，不能有空格或标点。');
  });
});

describe('TurnStrip', () => {
  const game = (room('bob').data as KeywordsRoomData).game as KeywordsView;

  test('shows how many guesses are left under the standard rule only', () => {
    const standard = mount(TurnStrip, { props: { game, guessRule: 'standard' }, global: global() });
    expect(standard.get('.left').text()).toBe('3 more to reveal');
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

  test('keeps the clock still while the game is paused, as on a big screen', async () => {
    vi.useFakeTimers();
    try {
      const paused = mount(TurnStrip, {
        props: {
          game: { ...game, paused: true, cards: [], clock: { left: 42_000, total: 90_000 } },
          guessRule: 'free',
        },
        global: global(),
      });
      vi.advanceTimersByTime(5_000);
      await flushPromises();
      expect(paused.get('.clock').attributes('aria-label')).toBe('42 seconds left');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ReplayViewer', () => {
  const replay: KeywordsReplay = {
    gameId: 'g1',
    language: 'en',
    startingTeam: 'red',
    cards: [
      { word: 'Baseline', color: 'red' },
      { word: 'Model', color: 'blue' },
      { word: 'Journal', color: 'reviewer2' },
    ],
    history: [{ turn: 1, team: 'red', word: 'Science', count: 2, guesses: [{ card: 0, color: 'red', player: 'bob' }] }],
    result: { winner: 'red', reason: 'found' },
    players: { bob: 'Bob' },
  };

  test('shows last what the group has said since the game ended, and nothing without it', () => {
    const talk = [{ id: 4, name: 'Ann', text: 'Well played' }];
    const wrapper = mount(ReplayViewer, { props: { replay, talk }, global: global() });
    expect(wrapper.get('.talk h3').text()).toBe('Talking it over');
    expect(wrapper.get('.talk .line .name').text()).toBe('Ann');
    expect(wrapper.get('.talk .line').text()).toContain('Well played');
    expect(mount(ReplayViewer, { props: { replay }, global: global() }).find('.talk').exists()).toBe(false);
  });

  test("shows the cards the PI meant through the clue's turn, and names them at the clue", async () => {
    const meant: KeywordsReplay = { ...replay, history: [{ ...(replay.history[0] as ClueRecord), targets: [1, 0] }] };
    const wrapper = mount(ReplayViewer, { props: { replay: meant }, global: global() });
    expect(wrapper.findAll('.target')).toHaveLength(0);
    await wrapper.get('input[type="range"]').setValue('1');
    expect(wrapper.get('.step').text()).toContain('Meant: Model and Baseline');
    expect(wrapper.findAll('.board button')[0]?.find('.target').text()).toBe('2');
    expect(wrapper.findAll('.board button')[1]?.find('.target').text()).toBe('1');
    expect(wrapper.findAll('.board button')[2]?.find('.target').exists()).toBe(false);
    // The step of the guess keeps the numbers, and names the guess instead.
    await wrapper.get('input[type="range"]').setValue('2');
    expect(wrapper.get('.step').text()).not.toContain('Meant');
    expect(wrapper.findAll('.target')).toHaveLength(2);
  });

  test('names an AI player who revealed a card by its persona', async () => {
    const withAi: KeywordsReplay = {
      ...replay,
      history: [{ ...(replay.history[0] as ClueRecord), guesses: [{ card: 0, color: 'red', player: 'ai' }] }],
      players: { ai: 'reviewer1' },
      agents: { ai: 'reviewer1' },
    };
    const wrapper = mount(ReplayViewer, { props: { replay: withAi }, global: global() });
    await wrapper.get('input[type="range"]').setValue('2');
    expect(wrapper.get('.step').text()).toContain('Reviewer 1 revealed \u201cBaseline\u201d');
  });

  test('keeps its step when the same game comes again, and starts over with another game', async () => {
    const wrapper = mount(ReplayViewer, { props: { replay }, global: global() });
    await wrapper.get('input[type="range"]').setValue('2');
    expect(wrapper.get('.position').text()).toBe('Step 3 of 3');
    // The results page builds the replay anew from every snapshot, as when someone's phone locks.
    await wrapper.setProps({ replay: { ...replay, players: { ...replay.players } } });
    expect(wrapper.get('.position').text()).toBe('Step 3 of 3');
    await wrapper.setProps({ replay: { ...replay, gameId: 'g2' } });
    expect(wrapper.get('.position').text()).toBe('Step 1 of 3');
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
      {
        turn: 2,
        team: 'blue',
        word: 'Science',
        count: 2,
        guesses: [{ card: 0, color: 'blue', player: 'dan' }],
        timedOut: true,
      },
      { turn: 3, team: 'red', word: 'Loss', count: 1, guesses: [] },
    ];
    const wrapper = mount(ClueLog, { props: { game: { ...game, history } }, global: global() });
    const items = wrapper.findAll('li');
    expect(items[2]?.text()).toContain('No clue in time');
    expect(items[1]?.text()).toContain('Science');
    expect(items[1]?.text()).toContain('Time ran out');
    expect(items[0]?.text()).not.toContain('Time ran out');
  });

  test('notes a pause, its end and an extension under their turns, in short', () => {
    const game = (room('bob').data as KeywordsRoomData).game as KeywordsView;
    const events: KeywordsView['events'] = [
      { turn: 1, kind: 'extended', team: 'red' },
      { turn: 2, kind: 'paused' },
      { turn: 2, kind: 'resumed' },
    ];
    // Turn 1 has no clue on record: the chair paused the game before one came, say.
    const wrapper = mount(ClueLog, { props: { game: { ...game, events } }, global: global() });
    const items = wrapper.findAll('li');
    expect(items).toHaveLength(2);
    expect(items[0]?.text()).toContain('Science');
    expect(items[0]?.findAll('.event').map((line) => line.text())).toEqual([
      'The chair paused the game',
      'The game went on',
    ]);
    expect(items[1]?.text()).toContain('[1]');
    expect(items[1]?.findAll('.event').map((line) => line.text())).toEqual(['The Red group asked for an extension']);
    expect(items[1]?.classes()).toContain('red');
  });

  test('names the cards a PI meant, once they are known, and how many of them the group found', () => {
    const game = (room('bob').data as KeywordsRoomData).game as KeywordsView;
    const history: KeywordsView['history'] = [
      { turn: 1, team: 'red', word: 'Loss', count: 1, guesses: [] },
      {
        turn: 2,
        team: 'red',
        word: 'Science',
        count: 2,
        guesses: [{ card: 0, color: 'red', player: 'bob' }],
        targets: [2, 0],
      },
    ];
    const wrapper = mount(ClueLog, { props: { game: { ...game, history } }, global: global() });
    const items = wrapper.findAll('li');
    expect(items[0]?.get('.meant').text()).toBe('Meant: Journal and Baseline \u00b7 1 of 2 found');
    expect(items[1]?.find('.meant').exists()).toBe(false);
  });

  test('shows a revealed card by its color alone while the game is paused, since there is no board', () => {
    const game = (room('bob').data as KeywordsRoomData).game as KeywordsView;
    const history: KeywordsView['history'] = [
      { turn: 2, team: 'red', word: 'Science', count: 2, guesses: [{ card: 1, color: 'red', player: 'bob' }] },
    ];
    const wrapper = mount(ClueLog, {
      props: { game: { ...game, history, cards: [], paused: true } },
      global: global(),
    });
    expect(wrapper.get('.guess').text()).toBe('Red');
    expect(wrapper.text()).not.toContain('Model');
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
  const BAR =
    'The settings above say how much time each phase has. The bar under the turn shows what is left, and stays at the top of the screen when you scroll down.';
  const CLUE = 'A PI who gives no clue in time loses the turn to the other group.';
  const GUESS = 'Students whose time runs out end their turn, even if they have revealed nothing.';
  const EXTENSION = 'Each group may once a game ask for 30 seconds more for the phase it is in.';
  const PAUSE =
    'The chair can pause the game at any time. The board is hidden until the chair resumes it, and the clock goes on from where it stopped.';

  test('tells what time does in the phases that have a limit, and nothing about the others', async () => {
    expect(await timeLines({})).toEqual([BAR, CLUE, GUESS, PAUSE]);
    expect(await timeLines({ guessTime: 0 })).toEqual([BAR, CLUE, PAUSE]);
    expect(await timeLines({ firstClueTime: 0 })).toEqual([BAR, CLUE, GUESS, PAUSE]);
    expect(await timeLines({ firstClueTime: 0, clueTime: 0 })).toEqual([BAR, GUESS, PAUSE]);
    expect(await timeLines({ firstClueTime: 0, clueTime: 0, guessTime: 0 })).toEqual([
      'This room has no time limits.',
      PAUSE,
    ]);
    // Extensions only matter where there is time to extend.
    expect(await timeLines({ extensions: true })).toEqual([BAR, CLUE, GUESS, EXTENSION, PAUSE]);
    expect(await timeLines({ extensions: true, firstClueTime: 0, clueTime: 0, guessTime: 0 })).toEqual([
      'This room has no time limits.',
      PAUSE,
    ]);
  });

  // The lines of the section on clues, once the sheet is open, for a room of this language.
  const clueLines = async (language: 'zh' | 'en') => {
    const wrapper = mount(RulesSheet, { props: { settings: STANDARD, language }, global: global() });
    await wrapper.get('button').trigger('click');
    const section = wrapper.findAll('.rules section').find((found) => found.get('h3').text() === 'Clues');
    return section?.findAll('p').map((line) => line.text()) ?? [];
  };

  test('asks a Chinese room alone for no clue that sounds like a word on the board, and every PI to hold reactions', async () => {
    const sound = (lines: string[]) => lines.filter((line) => line.startsWith('In a Chinese room'));
    const zh = await clueLines('zh');
    expect(sound(zh)).toHaveLength(1);
    expect(sound(zh)[0]).toContain('\u9e21\u97f3 (j\u012by\u012bn) for \u57fa\u56e0');
    // Right after the lines on what a clue can't be.
    expect(zh.indexOf(sound(zh)[0] as string)).toBe(3);
    expect(sound(await clueLines('en'))).toEqual([]);
    for (const lines of [zh, await clueLines('en')]) {
      expect(lines).toContain(
        "While the students guess, neither group's PI may send a quick reaction, nor may anyone who has been a PI in this game.",
      );
    }
  });

  test('opens from a small word on the home page, with the defaults and a word that rooms may change them', async () => {
    const wrapper = mount(RulesSheet, {
      props: { settings: STANDARD, language: 'en', link: true, defaults: true },
      global: global(),
    });
    expect(wrapper.get('button.rules-link').text()).toBe('Rules');
    expect(wrapper.find('.button').exists()).toBe(false);
    await wrapper.get('button.rules-link').trigger('click');
    expect(wrapper.get('.rules .defaults').text()).toBe(
      "These are the default settings. Each room can change them; the room's own settings apply.",
    );
    // The settings are headed as the defaults, not as a room's, since there is none.
    expect(wrapper.get('.rules section h3').text()).toBe('Default settings');
    // In a room there is no such word, and the settings are the room's.
    const room = mount(RulesSheet, { props: { settings: STANDARD, language: 'en' }, global: global() });
    await room.get('button').trigger('click');
    expect(room.find('.rules .defaults').exists()).toBe(false);
    expect(room.get('.rules section h3').text()).toBe('Rules of this room');
  });

  test('ends with what becomes of the record of the game, for everyone who plays, guests included', async () => {
    const wrapper = mount(RulesSheet, { props: { settings: STANDARD, language: 'en' }, global: global() });
    await wrapper.get('button').trigger('click');
    const last = wrapper.findAll('.rules section').at(-1);
    expect(last?.get('h3').text()).toBe('Game records');
    expect(last?.text()).toContain('may be used for research and published as a dataset, without names or accounts');
  });

  test('lists the settings, with the extensions and how many words the chair brought', async () => {
    const wrapper = mount(RulesSheet, {
      props: { settings: { ...STANDARD, extensions: true }, language: 'en', customWords: 12 },
      global: global(),
    });
    await wrapper.get('button').trigger('click');
    const summary = wrapper.get('.settings-summary').text();
    expect(summary).toContain('Extensions');
    expect(summary).toContain('On');
    expect(summary).toContain('12 words');
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
    expect(wrapper.text()).toContain('Characters in a clue');
    expect((boxes(wrapper)[0]?.element as HTMLInputElement).value).toBe('2');
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

describe('GameRosters', () => {
  test('puts each role on a line of its own, one player a line, and no spectators without any', () => {
    const view = room('bob');
    const data = view.data as KeywordsRoomData;
    const wrapper = mount(GameRosters, { props: { room: view }, global: global() });
    const red = wrapper.get('.group.red');
    expect(red.findAll('.seat').map((seat) => seat.get('.role').text())).toEqual(['PI', 'Students']);
    expect(
      red
        .findAll('.seat')[1]
        ?.findAll('li')
        .map((line) => line.get('.name').text()),
    ).toEqual(['Bob', 'Cat']);
    // "You" and "Chair" stay on the line of the name.
    expect(
      red
        .findAll('.seat')[1]
        ?.findAll('li')[0]
        ?.findAll('.label .mark')
        .map((mark) => mark.text()),
    ).toEqual(['you']);
    expect(wrapper.find('.spectators').exists()).toBe(true);
    const nobody = mount(GameRosters, {
      props: { room: { ...view, data: { ...data, seats: { ...data.seats, eve: { team: 'blue', role: 'guesser' } } } } },
      global: global(),
    });
    expect(nobody.find('.spectators').exists()).toBe(false);
    // Whether a player is online is a dot on the avatar's corner.
    expect(red.find('.face .dot.on').exists()).toBe(true);
  });

  test('raises the numbers that the floats give, on the avatars of their players', () => {
    const floats = new Map([['bob', { key: 1, text: '+1', team: 'red' as const }]]);
    const wrapper = mount(GameRosters, { props: { room: room('bob'), floats }, global: global() });
    expect(wrapper.findAll('.score-float').map((float) => float.text())).toEqual(['+1']);
    expect(wrapper.get('.score-float').attributes('aria-hidden')).toBe('true');
  });

  test('lets whoever plays from the next game of a match change their mind and just watch', async () => {
    const view = room('eve');
    const data = view.data as KeywordsRoomData;
    const match: RoomView['match'] = {
      id: 'm1',
      rules: { games: 3, teams: 'fixed', grouping: 'choose' },
      played: 1,
      status: 'on',
      game: 2,
      standings: [],
    };
    const wrapper = mount(GameRosters, {
      props: { room: { ...view, match, data: { ...data, joinsNext: true } } },
      global: global(),
    });
    // Eve plays from the next game, so no group is hers to join now, but she may stay a spectator.
    expect(wrapper.text()).not.toContain('Play for the');
    await wrapper.get('.own button').trigger('click');
    expect(send).toHaveBeenLastCalledWith('keywords:seat', { team: null, role: 'spectator' });
    // A spectator of an ordinary game is offered the groups, and has no mind to change.
    const ordinary = mount(GameRosters, { props: { room: view }, global: global() });
    expect(ordinary.text()).toContain('Play for the');
    expect(ordinary.find('.own button').exists()).toBe(false);
  });
});

describe('KeywordsGame', () => {
  // The draft of a clue is kept in the browser's storage, which starts every test empty.
  const forget = () => {
    clearMemory();
    try {
      localStorage.clear();
    } catch {
      // no storage in this test
    }
  };
  beforeEach(forget);
  afterEach(() => {
    vi.unstubAllGlobals();
    forget();
  });
  const answers: (() => void)[] = [];
  // The server answers when the test says so.
  const later = () => new Promise<{ ok: boolean }>((resolve) => answers.push(() => resolve({ ok: true })));
  const card = (wrapper: ReturnType<typeof mount>, index: number) => wrapper.findAll('.board button')[index];

  // A student's taps on a card (useCardGestures.ts), which count once the time for one more is over.
  async function tapCard(wrapper: ReturnType<typeof mount>, index: number, taps = 1) {
    vi.useFakeTimers();
    for (let tap = 0; tap < taps; tap += 1) await card(wrapper, index)?.trigger('click');
    vi.advanceTimersByTime(TAP_MS);
    vi.useRealTimers();
    await flushPromises();
  }

  test('shows a choice at once and sends it, takes it back, and reveals the card chosen last', async () => {
    send.mockImplementation(later);
    const wrapper = mount(KeywordsGame, { props: { room: room('bob') }, global: global() });

    await tapCard(wrapper, 1);
    expect(send).toHaveBeenLastCalledWith('keywords:select', { gameId: 'g1', turn: 2, card: 1 });
    expect(card(wrapper, 1)?.classes()).toContain('selected');
    expect(wrapper.get('.guess-bar button.primary').text()).toBe('Reveal \u201cModel\u201d');

    // A second tap takes the choice back, also before the first one has been answered.
    await tapCard(wrapper, 1);
    expect(send).toHaveBeenLastCalledWith('keywords:select', { gameId: 'g1', turn: 2, card: null });
    expect(card(wrapper, 1)?.classes()).not.toContain('selected');

    await tapCard(wrapper, 2);
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
    await tapCard(wrapper, 0);
    expect(card(wrapper, 0)?.classes()).toContain('selected');
    expect(wrapper.get('.guess-bar button.primary').attributes('disabled')).toBeUndefined();
    send.mockImplementation(async () => ({ ok: true }));
  });

  // Bob, a red student, with the group's marks as the server sends them, in whatever phase.
  const marked = (marks: KeywordsView['marks'], change: Partial<KeywordsView> = {}, me = 'bob') => {
    const view = room(me);
    const data = view.data as KeywordsRoomData;
    return { ...view, data: { ...data, game: { ...(data.game as KeywordsView), marks, ...change } } };
  };
  test('lets a student mark cards for the group with taps and a long press, and take a mark back', async () => {
    send.mockImplementation(later);
    const wrapper = mount(KeywordsGame, { props: { room: marked([]) }, global: global() });
    // No row of tools: the line above the guess bar's buttons says what taps do.
    expect(wrapper.find('.mark-tools').exists()).toBe(false);
    expect(wrapper.get('.guess-bar .hint').text()).toBe(
      'Tap: choose \u00b7 double-tap: ours \u00b7 triple-tap: theirs \u00b7 hold: R2?',
    );
    await tapCard(wrapper, 0, 2);
    expect(send).toHaveBeenLastCalledWith('keywords:mark', { gameId: 'g1', card: 0, mark: 'ours' });
    expect(send).not.toHaveBeenCalledWith('keywords:select', expect.anything());
    expect(card(wrapper, 0)?.classes()).toEqual(expect.arrayContaining(['noted', 'note-red']));
    expect(card(wrapper, 0)?.classes()).not.toContain('selected');
    // The same mark again takes it off, before the first has been answered.
    await tapCard(wrapper, 0, 2);
    expect(send).toHaveBeenLastCalledWith('keywords:mark', { gameId: 'g1', card: 0, mark: null });
    expect(card(wrapper, 0)?.classes()).not.toContain('noted');
    await tapCard(wrapper, 1, 3);
    expect(send).toHaveBeenLastCalledWith('keywords:mark', { gameId: 'g1', card: 1, mark: 'theirs' });
    expect(card(wrapper, 1)?.classes()).toContain('note-blue');
    // A long press, and the click that ends it, which chooses nothing.
    vi.useFakeTimers();
    await card(wrapper, 2)?.trigger('pointerdown', { isPrimary: true, button: 0, clientX: 5, clientY: 5 });
    vi.advanceTimersByTime(HOLD_MS);
    await card(wrapper, 2)?.trigger('pointerup');
    await card(wrapper, 2)?.trigger('click');
    vi.advanceTimersByTime(TAP_MS);
    vi.useRealTimers();
    await flushPromises();
    expect(send).toHaveBeenLastCalledWith('keywords:mark', { gameId: 'g1', card: 2, mark: 'r2' });
    for (const answer of answers.splice(0)) answer();
    await flushPromises();
    // One tap chooses, once the time for a second has passed.
    await tapCard(wrapper, 2);
    expect(send).toHaveBeenLastCalledWith('keywords:select', { gameId: 'g1', turn: 2, card: 2 });
    send.mockImplementation(async () => ({ ok: true }));
  });

  test("shows the group's marks from the server, and changes a teammate's mark, also from the keyboard", async () => {
    const wrapper = mount(KeywordsGame, {
      props: {
        room: marked([
          { card: 0, mark: 'r2' },
          { card: 2, mark: 'ours' },
        ]),
      },
      global: global(),
    });
    expect(card(wrapper, 0)?.classes()).toContain('note-r2');
    expect(card(wrapper, 0)?.attributes('aria-label')).toBe('Baseline, not revealed, marked as maybe Reviewer 2');
    expect(card(wrapper, 2)?.classes()).toContain('note-red');
    await card(wrapper, 0)?.trigger('keydown', { key: '1' });
    expect(send).toHaveBeenLastCalledWith('keywords:mark', { gameId: 'g1', card: 0, mark: 'ours' });
    await card(wrapper, 2)?.trigger('keydown', { key: '1' });
    expect(send).toHaveBeenLastCalledWith('keywords:mark', { gameId: 'g1', card: 2, mark: null });
    await card(wrapper, 1)?.trigger('keydown', { key: '3' });
    expect(send).toHaveBeenLastCalledWith('keywords:mark', { gameId: 'g1', card: 1, mark: 'r2' });
  });

  test('marks while the other group guesses, where one tap chooses nothing', async () => {
    const wrapper = mount(KeywordsGame, { props: { room: marked([], { team: 'blue' }) }, global: global() });
    expect(wrapper.find('.guess-bar').exists()).toBe(false);
    expect(wrapper.get('.status').text()).toBe('The Blue group is guessing.');
    expect(wrapper.get('.gestures').text()).toBe(
      'Double-tap: ours \u00b7 triple-tap: theirs \u00b7 hold: R2? \u00b7 the same again clears it',
    );
    send.mockClear();
    await tapCard(wrapper, 1);
    expect(send).not.toHaveBeenCalled();
    await tapCard(wrapper, 1, 2);
    expect(send).toHaveBeenLastCalledWith('keywords:mark', { gameId: 'g1', card: 1, mark: 'ours' });
  });

  test("shows a PI the group's marks small in the corner, which a PI can't change", async () => {
    const wrapper = mount(KeywordsGame, {
      props: { room: marked([{ card: 0, mark: 'ours' }], {}, 'ann') },
      global: global(),
    });
    const sticker = card(wrapper, 0)?.find('.note');
    expect(sticker?.classes()).toContain('quiet');
    expect(card(wrapper, 0)?.classes()).not.toContain('noted');
    expect(card(wrapper, 0)?.attributes('aria-label')).toContain('marked as ours');
    send.mockClear();
    await card(wrapper, 0)?.trigger('keydown', { key: '2' });
    await tapCard(wrapper, 0, 2);
    expect(send).not.toHaveBeenCalledWith('keywords:mark', expect.anything());
  });

  test('gives no marks to a spectator, nor once the game is paused or over', async () => {
    const marks = [{ card: 0, mark: 'ours' as const }];
    const eve = mount(KeywordsGame, { props: { room: marked(marks, {}, 'eve') }, global: global() });
    expect(eve.find('.board .note').exists()).toBe(false);
    expect(eve.find('.gestures').exists()).toBe(false);
    const over = mount(KeywordsGame, {
      props: { room: marked(marks, { phase: 'over', result: { winner: 'red', reason: 'found' } }) },
      global: global(),
    });
    expect(over.find('.board .note').exists()).toBe(false);
    const paused = mount(KeywordsGame, {
      props: { room: marked(marks, { paused: true, cards: [] }) },
      global: global(),
    });
    expect(paused.find('.gestures').exists()).toBe(false);
  });

  test('says nothing under the board of who the viewer is or what the others chose, but who plays next', async () => {
    const view = marked([], {
      selections: [
        { player: 'cat', card: 1 },
        { player: 'bob', card: 0 },
      ],
    });
    const wrapper = mount(KeywordsGame, { props: { room: view }, global: global() });
    expect(wrapper.find('.actions').text()).not.toContain('student');
    expect(wrapper.find('.actions').text()).not.toContain('Cat');
    // Cat's choice hangs on the card, as before.
    expect(card(wrapper, 1)?.attributes('aria-label')).toContain('chosen by Cat');
    const data = view.data as KeywordsRoomData;
    const next = mount(KeywordsGame, {
      props: { room: { ...room('eve'), data: { ...(room('eve').data as KeywordsRoomData), joinsNext: true } } },
      global: global(),
    });
    expect(next.get('.joins-next').text()).toBe('You play from the next game.');
    expect(data.joinsNext).toBe(false);
  });

  test("greys out a PI's reactions while the game holds them back, and says why on a tap", async () => {
    toasts.splice(0);
    const view = room('ann');
    const held = { ...view, data: { ...(view.data as KeywordsRoomData), mayEmote: false } };
    const wrapper = mount(KeywordsGame, { props: { room: held }, global: global() });
    const button = wrapper.get('.emote-button .button');
    expect(button.attributes('aria-disabled')).toBe('true');
    expect(button.classes()).toContain('held');
    await button.trigger('click');
    expect(toasts.map((item) => item.key)).toEqual(['errors.emote_not_now']);
    expect(wrapper.find('.emotes').exists()).toBe(false);
    // Once they may again, the button opens the phrases.
    await wrapper.setProps({ room: view });
    expect(wrapper.get('.emote-button .button').attributes('aria-disabled')).toBeUndefined();
    await wrapper.get('.emote-button .button').trigger('click');
    expect(wrapper.find('.emotes').exists()).toBe(true);
    toasts.splice(0);
  });

  test("lets the PI mark the group's cards that are still hidden, and sends them with the clue", async () => {
    const view = room('ann');
    const data = view.data as KeywordsRoomData;
    const game: KeywordsView = {
      ...(data.game as KeywordsView),
      phase: 'clue',
      clue: null,
      cards: [
        { word: 'Baseline', revealed: false, color: 'red' },
        { word: 'Model', revealed: false, color: 'blue' },
        { word: 'Journal', revealed: true, color: 'red' },
        { word: 'Ablation', revealed: false, color: 'red' },
      ],
    };
    const props = { room: { ...view, data: { ...data, game } } };
    const wrapper = mount(KeywordsGame, { props, global: global() });
    const sent = send.mock.calls.length;
    // The other group's card and a revealed one can't be marked.
    expect(card(wrapper, 1)?.attributes('aria-disabled')).toBe('true');
    expect(card(wrapper, 2)?.attributes('aria-disabled')).toBe('true');
    await card(wrapper, 3)?.trigger('click');
    await card(wrapper, 0)?.trigger('click');
    await card(wrapper, 1)?.trigger('click');
    expect(card(wrapper, 3)?.get('.target').text()).toBe('1');
    expect(card(wrapper, 0)?.get('.target').text()).toBe('2');
    expect(card(wrapper, 0)?.attributes('aria-pressed')).toBe('true');
    expect(card(wrapper, 1)?.find('.target').exists()).toBe(false);
    expect(wrapper.get('.clue-panel .counts button.chosen').text()).toBe('2');
    // A second tap takes a mark back. Marking sends nothing until the clue goes.
    await card(wrapper, 3)?.trigger('click');
    await card(wrapper, 3)?.trigger('click');
    expect(card(wrapper, 0)?.get('.target').text()).toBe('1');
    expect(send.mock.calls.length).toBe(sent);
    await wrapper.get('.clue-panel input').setValue('Science');
    await wrapper.get('form.clue-panel').trigger('submit');
    expect(send).toHaveBeenLastCalledWith('keywords:clue', {
      gameId: 'g1',
      turn: 2,
      word: 'Science',
      count: 2,
      targets: [0, 3],
    });
    // Once the server's snapshot has the clue, the marks go with it.
    await flushPromises();
    expect(wrapper.findAll('.target')).toHaveLength(2);
    const record: ClueRecord = { turn: 2, team: 'red', word: 'Science', count: 2, guesses: [] };
    await wrapper.setProps({
      room: { ...view, data: { ...data, game: { ...game, phase: 'guess', history: [...game.history, record] } } },
    });
    expect(wrapper.findAll('.target')).toHaveLength(0);
  });

  // The red PI's view while the blue group is on, with the key: red's cards are 0 and 3, and 2
  // has been found. The history holds red's clue of the turn before.
  const waiting = (changes: Partial<KeywordsView> = {}, me = 'ann', settings = STANDARD): RoomView => {
    const view = room(me);
    const data = view.data as KeywordsRoomData;
    const game: KeywordsView = {
      ...(data.game as KeywordsView),
      team: 'blue',
      phase: 'clue',
      clue: null,
      cards: [
        { word: 'Baseline', revealed: false, color: 'red' },
        { word: 'Model', revealed: false, color: 'blue' },
        { word: 'Journal', revealed: true, color: 'red' },
        { word: 'Ablation', revealed: false, color: 'red' },
      ],
      ...changes,
    };
    return { ...view, data: { ...data, settings, game } };
  };
  const HISTORY = ((waiting().data as KeywordsRoomData).game as KeywordsView).history;
  const typed = (wrapper: ReturnType<typeof mount>) =>
    (wrapper.get('.clue-panel input').element as HTMLInputElement).value;
  const DRAFT = 'r2.clueDraft';

  test('lets a PI prepare the next clue while the other group is on, and give it when their turn comes', async () => {
    const wrapper = mount(KeywordsGame, { props: { room: waiting() }, global: global() });
    const sent = send.mock.calls.length;
    expect(wrapper.get('.status').text()).toBe('Waiting for the PI of the Blue group to give a clue.');
    // The panel is open from the start, under the board, with nothing to open or fold it.
    expect(wrapper.find('.prepare').exists()).toBe(false);
    expect(wrapper.find('[aria-expanded]').exists()).toBe(false);
    expect(wrapper.get('.clue-panel').classes()).toContain('draft');
    expect(wrapper.find('.clue-panel .ahead').exists()).toBe(true);
    expect(wrapper.get('.clue-panel button[type="submit"]').attributes('disabled')).toBeDefined();
    await wrapper.get('.clue-panel input').setValue('Theory');
    // Only the group's own hidden cards can be marked, as in the PI's turn.
    expect(card(wrapper, 1)?.attributes('aria-disabled')).toBe('true');
    await card(wrapper, 3)?.trigger('click');
    await card(wrapper, 0)?.trigger('click');
    expect(card(wrapper, 3)?.get('.target').text()).toBe('1');
    expect(card(wrapper, 0)?.get('.target').text()).toBe('2');
    expect(wrapper.get('.clue-panel .counts button.chosen').text()).toBe('2');
    expect(wrapper.get('.clue-panel .targets').text()).toBe(
      '2 cards marked: \u201cAblation\u201d and \u201cBaseline\u201d. Everyone sees them after the game.',
    );
    // Nothing went to the server, and the draft is in the browser's storage, for this game.
    expect(send.mock.calls.length).toBe(sent);
    expect(JSON.parse(readStored(DRAFT) ?? '')).toEqual({
      game: 'g1',
      since: 1,
      word: 'Theory',
      count: null,
      targets: [3, 0],
    });

    // The PI's turn: the panel is open with the draft in it, and the clue goes with one tap.
    await wrapper.setProps({ room: waiting({ team: 'red' }) });
    const panel = wrapper.get('form.clue-panel');
    expect(panel.classes()).not.toContain('draft');
    expect(typed(wrapper)).toBe('Theory');
    expect(panel.get('.counts button.chosen').text()).toBe('2');
    expect(panel.get('button[type="submit"]').attributes('disabled')).toBeUndefined();
    await panel.trigger('submit');
    expect(send).toHaveBeenLastCalledWith('keywords:clue', {
      gameId: 'g1',
      turn: 2,
      word: 'Theory',
      count: 2,
      targets: [3, 0],
    });
    await flushPromises();
    // The server's snapshot has the clue, and with it the draft is gone: from the board, the
    // panel and the storage. While the group guesses, the PI prepares the next one in the same
    // panel, empty again.
    const record: ClueRecord = { turn: 2, team: 'red', word: 'Theory', count: 2, guesses: [] };
    await wrapper.setProps({
      room: waiting({ team: 'red', phase: 'guess', clue: { word: 'Theory', count: 2 }, history: [...HISTORY, record] }),
    });
    expect(wrapper.findAll('.target')).toHaveLength(0);
    expect(readStored(DRAFT)).toBeNull();
    expect(wrapper.get('.clue-panel').classes()).toContain('draft');
    expect(typed(wrapper)).toBe('');
  });

  test('keeps the draft while the answer to the clue is lost, until the snapshot has the clue', async () => {
    const wrapper = mount(KeywordsGame, { props: { room: waiting({ team: 'red' }) }, global: global() });
    await wrapper.get('.clue-panel input').setValue('Theory');
    await card(wrapper, 3)?.trigger('click');
    // The server took the clue, but its answer never came.
    send.mockImplementationOnce(async () => ({ ok: false, error: 'timeout' }));
    await wrapper.get('form.clue-panel').trigger('submit');
    await flushPromises();
    expect(typed(wrapper)).toBe('Theory');
    expect(wrapper.findAll('.target')).toHaveLength(1);
    expect(JSON.parse(readStored(DRAFT) ?? '')).toEqual({
      game: 'g1',
      since: 1,
      word: 'Theory',
      count: null,
      targets: [3],
    });
    // The snapshot that the connection brings back says that the clue went, and the next one was
    // given meanwhile too, so that two records came at once.
    const mine: ClueRecord = { turn: 2, team: 'red', word: 'Theory', count: 1, guesses: [] };
    const theirs: ClueRecord = { turn: 3, team: 'blue', word: 'Method', count: 1, guesses: [] };
    await wrapper.setProps({ room: waiting({ turn: 3, history: [...HISTORY, mine, theirs] }) });
    expect(wrapper.findAll('.target')).toHaveLength(0);
    expect(typed(wrapper)).toBe('');
    expect(readStored(DRAFT)).toBeNull();
  });

  test('drops a draft read back after a reload if its clue went meanwhile', async () => {
    // The clue went, the page was reloaded before the snapshot with it came, and the draft was
    // last changed before red's clue in the history.
    writeStored(DRAFT, JSON.stringify({ game: 'g1', since: 0, word: 'Science', count: null, targets: [0] }));
    const wrapper = mount(KeywordsGame, { props: { room: waiting() }, global: global() });
    expect(typed(wrapper)).toBe('');
    expect(wrapper.findAll('.target')).toHaveLength(0);
    expect(readStored(DRAFT)).toBeNull();
  });

  test('keeps the input, its focus and what is typed in it when the turn comes', async () => {
    const wrapper = mount(KeywordsGame, { props: { room: waiting() }, global: global(), attachTo: document.body });
    const input = document.body.querySelector<HTMLInputElement>('#clue-word');
    if (!input) throw new Error('no input');
    input.focus();
    await wrapper.get('.clue-panel input').setValue('Theo');
    expect(document.activeElement).toBe(input);
    await wrapper.setProps({ room: waiting({ team: 'red' }) });
    expect(wrapper.get('form.clue-panel').classes()).not.toContain('draft');
    expect(document.body.querySelector('#clue-word')).toBe(input);
    expect(input.value).toBe('Theo');
    expect(document.activeElement).toBe(input);
    wrapper.unmount();
  });

  test('keeps the draft in the open panel through a clue phase that ran out', async () => {
    const wrapper = mount(KeywordsGame, { props: { room: waiting() }, global: global() });
    await wrapper.get('.clue-panel input').setValue('Theory');
    await wrapper.setProps({ room: waiting({ team: 'red' }) });
    expect(wrapper.get('.clue-panel').classes()).not.toContain('draft');
    // The time ran out: the record has no word, and the draft waits in the panel for the next
    // turn, while the PI watches the other group play above it.
    const timedOut: ClueRecord = { turn: 2, team: 'red', word: null, count: null, guesses: [], timedOut: true };
    await wrapper.setProps({ room: waiting({ turn: 3, history: [...HISTORY, timedOut] }) });
    expect(wrapper.get('.clue-panel').classes()).toContain('draft');
    expect(typed(wrapper)).toBe('Theory');
  });

  test('offers a PI the numbers for their own group, and takes back a number picked that the rule no longer offers', async () => {
    const free: KeywordsSettings = { ...STANDARD, guessRule: 'free' };
    // Red has 9 cards left and blue, which is on, 8.
    const wrapper = mount(KeywordsGame, { props: { room: waiting({}, 'ann', free) }, global: global() });
    const numbers = () => wrapper.findAll('.clue-panel .counts button').map((button) => button.text());
    expect(numbers()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    await card(wrapper, 3)?.trigger('click');
    await card(wrapper, 0)?.trigger('click');
    await wrapper.findAll('.clue-panel .counts button').at(-1)?.trigger('click');
    expect(wrapper.get('.clue-panel .counts button.chosen').text()).toBe('9');
    // The blue group finds one of red's cards, one the PI didn't mark: the rule now offers red one
    // number fewer, and 9 isn't one of them, so the number follows the marks again.
    await wrapper.setProps({ room: waiting({ remaining: { red: 8, blue: 8 } }, 'ann', free) });
    expect(wrapper.get('.clue-panel .counts button.chosen').text()).toBe('2');
    expect(JSON.parse(readStored(DRAFT) ?? '')).toEqual({
      game: 'g1',
      since: 1,
      word: '',
      count: null,
      targets: [3, 0],
    });
    await wrapper.setProps({ room: waiting({ team: 'red', remaining: { red: 8, blue: 8 } }, 'ann', free) });
    expect(numbers()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(wrapper.get('.clue-panel .counts button.chosen').text()).toBe('2');
  });

  test('takes the mark off a card that is revealed meanwhile, says so, and keeps the draft through a pause', async () => {
    const wrapper = mount(KeywordsGame, { props: { room: waiting() }, global: global() });
    await card(wrapper, 3)?.trigger('click');
    await card(wrapper, 0)?.trigger('click');
    const cards = ((waiting().data as KeywordsRoomData).game as KeywordsView).cards;
    const revealed = cards.map((card, index) => (index === 3 ? { ...card, revealed: true } : card));
    await wrapper.setProps({ room: waiting({ cards: revealed }) });
    expect(wrapper.findAll('.target')).toHaveLength(1);
    expect(card(wrapper, 0)?.get('.target').text()).toBe('1');
    expect(wrapper.get('.clue-panel .gone').text()).toBe(
      'You marked \u201cAblation\u201d, which has been revealed, so the mark is gone.',
    );
    // The number followed the marks down.
    expect(wrapper.get('.clue-panel .counts button.chosen').text()).toBe('1');
    // A pause takes the board away, and the draft waits for it to come back.
    await wrapper.setProps({ room: waiting({ cards: [], paused: true }) });
    expect(wrapper.find('.clue-panel').exists()).toBe(false);
    await wrapper.setProps({ room: waiting({ cards: revealed }) });
    expect(wrapper.find('.clue-panel .gone').exists()).toBe(true);
    expect(card(wrapper, 0)?.get('.target').text()).toBe('1');
    // The next mark takes the line away.
    await card(wrapper, 0)?.trigger('click');
    expect(wrapper.find('.clue-panel .gone').exists()).toBe(false);
    expect(wrapper.findAll('.target')).toHaveLength(0);
  });

  test('brings the draft back after a reload, less a card found meanwhile, and starts the next game without it', async () => {
    writeStored(DRAFT, JSON.stringify({ game: 'g1', since: 1, word: 'Science', count: 4, targets: [0, 2] }));
    const wrapper = mount(KeywordsGame, { props: { room: waiting() }, global: global() });
    expect(card(wrapper, 0)?.get('.target').text()).toBe('1');
    expect(typed(wrapper)).toBe('Science');
    expect(wrapper.get('.clue-panel .gone').text()).toContain('\u201cJournal\u201d');
    // The number the PI picked stays picked.
    expect(wrapper.get('.clue-panel .counts button.chosen').text()).toBe('4');
    expect(JSON.parse(readStored(DRAFT) ?? '')).toEqual({
      game: 'g1',
      since: 1,
      word: 'Science',
      count: 4,
      targets: [0],
    });
    // Another game starts over, and the old draft is gone.
    await wrapper.setProps({ room: { ...waiting({ gameId: 'g2' }), gameId: 'g2' } });
    expect(typed(wrapper)).toBe('');
    expect(wrapper.findAll('.target')).toHaveLength(0);
    expect(readStored(DRAFT)).toBeNull();
    // A draft of another game is no draft for this one.
    writeStored(DRAFT, JSON.stringify({ game: 'g0', since: 1, word: 'Old', count: null, targets: [3] }));
    const other = mount(KeywordsGame, { props: { room: waiting() }, global: global() });
    expect(typed(other)).toBe('');
    expect(readStored(DRAFT)).toBeNull();
  });

  test('plays on without storage for the draft, which then lasts as long as the page', async () => {
    const throwing = (): never => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
    vi.stubGlobal('localStorage', { getItem: throwing, setItem: throwing, removeItem: throwing });
    const wrapper = mount(KeywordsGame, { props: { room: waiting() }, global: global() });
    await wrapper.get('.clue-panel input').setValue('Science');
    await card(wrapper, 3)?.trigger('click');
    await wrapper.setProps({ room: waiting({ team: 'red' }) });
    expect(typed(wrapper)).toBe('Science');
    await wrapper.get('form.clue-panel').trigger('submit');
    expect(send).toHaveBeenLastCalledWith('keywords:clue', {
      gameId: 'g1',
      turn: 2,
      word: 'Science',
      count: 1,
      targets: [3],
    });
  });

  test('offers the draft to a PI alone, and not once the game is over', async () => {
    const over: Partial<KeywordsView> = { phase: 'over', result: { winner: 'blue', reason: 'found' } };
    const prepare = (view: RoomView) =>
      mount(KeywordsGame, { props: { room: view }, global: global() })
        .find('.clue-panel.draft')
        .exists();
    // The PI's draft in the browser's storage is left alone by anyone else who views the game,
    // or one that has ended, in another tab of the same browser.
    const stored = JSON.stringify({ game: 'g1', since: 1, word: 'Science', count: null, targets: [3] });
    writeStored(DRAFT, stored);
    expect(prepare(waiting({}, 'bob'))).toBe(false);
    expect(prepare(waiting({}, 'eve'))).toBe(false);
    expect(prepare(waiting(over, 'eve'))).toBe(false);
    expect(prepare({ ...waiting({ gameId: 'g2' }, 'bob'), gameId: 'g2' })).toBe(false);
    await flushPromises();
    expect(readStored(DRAFT)).toBe(stored);
    // The PI's own page of the game that has ended drops it.
    expect(prepare(waiting(over))).toBe(false);
    await flushPromises();
    expect(readStored(DRAFT)).toBeNull();
    expect(prepare(waiting())).toBe(true);
  });

  test('calls out a PI who missed the deadline the moment it happens, counted for an account', async () => {
    bubbles.splice(0);
    const view = room('bob');
    const data = view.data as KeywordsRoomData;
    const game = data.game as KeywordsView;
    const late = (turn: number, captain: string): ClueRecord => ({
      turn,
      team: 'blue',
      word: null,
      count: null,
      guesses: [],
      timedOut: true,
      captain,
    });
    const missed = (turn: number, player: string, count?: number) => ({
      turn,
      kind: 'missed' as const,
      team: 'blue' as const,
      player,
      ...(count === undefined ? {} : { count }),
    });
    const calls = () => bubbles.map((bubble) => ('call' in bubble ? [bubble.name, bubble.call] : null));
    const { t } = i18n().global;
    const line = (turn: number, name: string) => t(`game.missed.lines.${missedLine('g1', turn)}`, { name });
    // A miss that was on record when the page opened is old news.
    let shown: KeywordsView = { ...game, history: [...game.history, late(3, 'eve')], events: [missed(3, 'eve')] };
    const show = async (changes: Partial<KeywordsView>) => {
      shown = { ...shown, ...changes };
      await wrapper.setProps({ room: { ...view, data: { ...data, game: shown } } });
    };
    const wrapper = mount(KeywordsGame, {
      props: { room: { ...view, data: { ...data, game: shown } } },
      global: global(),
    });
    expect(bubbles).toEqual([]);
    // Ann's account has missed the deadline three times now, this one included: the next turn's
    // clock has just started.
    await show({
      history: [...shown.history, late(4, 'ann')],
      events: [...shown.events, missed(4, 'ann', 3)],
      clock: { left: 88_000, total: 90_000 },
    });
    expect(calls()).toEqual([['Ann', `${line(4, 'Ann')} (\u00d73)`]]);
    bubbles.splice(0);
    // Cat is a guest, whose misses nobody counts; a turn without a clock is taken as it comes.
    await show({
      history: [...shown.history, late(5, 'cat')],
      events: [...shown.events, missed(5, 'cat')],
      clock: null,
    });
    expect(calls()).toEqual([['Cat', line(5, 'Cat')]]);
    bubbles.splice(0);
    // A page that slept through a miss and the clue after it, or wakes with the next clock well
    // on its way, says nothing: the moment has passed.
    await show({
      history: [...shown.history, late(6, 'ann'), { turn: 7, team: 'red', word: 'Later', count: 1, guesses: [] }],
      events: [...shown.events, missed(6, 'ann', 4)],
    });
    expect(bubbles).toEqual([]);
    await show({
      history: [...shown.history, late(8, 'cat')],
      events: [...shown.events, missed(8, 'cat')],
      clock: { left: 60_000, total: 90_000 },
    });
    expect(bubbles).toEqual([]);
    // Nor does a snapshot of another game, however many misses it has on record.
    await show({
      gameId: 'g2',
      history: [...shown.history, late(9, 'ann')],
      events: [...shown.events, missed(9, 'ann', 5)],
      clock: { left: 89_000, total: 90_000 },
    });
    expect(bubbles).toEqual([]);
    // The clue log says no more than that the turns had no clue.
    expect(wrapper.findAll('.clue-log .missing')).toHaveLength(6);
    expect(wrapper.find('.clue-log .event').exists()).toBe(false);
    bubbles.splice(0);
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

  test("folds a match's table under the board to a line with the progress and the viewer's standing", () => {
    const view = room('bob');
    const line = (playerId: string, total: number, rank: number | null): StandingView => ({
      playerId,
      name: playerId,
      total,
      delta: null,
      games: rank === null ? 0 : 1,
      rank,
      left: false,
    });
    const match: RoomView['match'] = {
      id: 'm1',
      rules: { games: 3, teams: 'fixed', grouping: 'choose' },
      played: 1,
      status: 'on',
      game: 2,
      standings: [line('ann', 4, 1), line('bob', 1, 2), line('dan', -1, 3), line('eve', 0, null)],
    };
    const game = (me: string) => mount(KeywordsGame, { props: { room: { ...view, me, match } }, global: global() });
    const fold = (me: string) => game(me).get('.match-fold summary');
    // One point is "1 point", and so is minus one.
    expect(fold('bob').text()).toBe('Match progress \u00b7 Game 2 of 3 \u00b7 Your place: 2 \u00b7 1 point');
    expect(fold('dan').text()).toBe('Match progress \u00b7 Game 2 of 3 \u00b7 Your place: 3 \u00b7 \u22121 point');
    expect(fold('ann').text()).toBe('Match progress \u00b7 Game 2 of 3 \u00b7 Your place: 1 \u00b7 4 points');
    // Someone without a scored game yet sees the progress alone.
    expect(fold('eve').text()).toBe('Match progress \u00b7 Game 2 of 3');
    // The chair's button to end the match stands among the tools, in sight, not in the fold.
    const chair = game('ann');
    expect(chair.find('.match-fold .end-match').exists()).toBe(false);
    expect(chair.get('.tools .end-match').text()).toBe('End the match');
    expect(game('bob').find('.end-match').exists()).toBe(false);
  });

  test("says between the games where the points came from, and reads an older detail as a student's", () => {
    const view = room('bob');
    const data = view.data as KeywordsRoomData;
    const game = {
      ...(data.game as KeywordsView),
      phase: 'over' as const,
      result: { winner: 'red' as const, reason: 'found' as const },
    };
    const standing = (name: string, detail: object): StandingView => ({
      playerId: name.toLowerCase(),
      name,
      total: 0,
      delta: 0,
      games: 1,
      rank: 1,
      left: false,
      detail,
    });
    const match: MatchView = {
      id: 'm1',
      rules: { games: 2, teams: 'fixed', grouping: 'random' },
      played: 1,
      status: 'on',
      game: 1,
      standings: [
        // With the PI's stakes: a PI with a big clue, the opening record and the heavenly hand, and
        // a student who pays for what another revealed.
        standing('Ann', {
          role: 'captain',
          found: 9,
          won: true,
          irrelevant: 0,
          wrong: 0,
          reviewer2: 0,
          bigClues: 6,
          openingRecord: true,
          heavenlyHand: true,
        }),
        standing('Dan', {
          role: 'guesser',
          found: 2,
          won: false,
          irrelevant: 1,
          wrong: 1,
          reviewer2: 0,
          bigClues: 0,
          openingRecord: false,
          heavenlyHand: false,
        }),
        // From before the PI's stakes, and from before a count of irrelevant papers.
        standing('Bob', { found: 2, won: true, irrelevant: 1, wrong: 1, reviewer2: 0 }),
        standing('Eve', { found: 0, won: false, irrelevant: 0, wrong: 0, reviewer2: 1 }),
        standing('Cat', { found: 1, won: false, wrong: 0, reviewer2: 0 }),
      ],
    };
    const wrapper = mount(KeywordsGame, {
      props: { room: { ...view, match, data: { ...data, game } } },
      global: global(),
    });
    expect(wrapper.findAll('.between .detail').map((detail) => detail.text())).toEqual([
      'PI \u00b7 found 9 \u00b7 won \u00b7 big clue +6 \u00b7 Opened the Scoring \u00b7 Heavenly Hand',
      "found 2 \u00b7 irrelevant paper \u00d71 \u00b7 other group's card \u00d71",
      "found 2 \u00b7 won \u00b7 irrelevant paper \u00d71 \u00b7 other group's card \u00d71",
      'Reviewer 2',
      'found 1',
    ]);
    const scoring = wrapper.get('.between .scoring').text();
    expect(scoring).toContain('+3 for each student and +4 for the PI');
    expect(scoring).toContain('costs each student 1, 2 and 3, and the PI 2, 3 and 5');
  });

  test('renders the group chat once, and keeps it after the game', async () => {
    const view = room('bob', []);
    const wrapper = mount(KeywordsGame, { props: { room: view }, global: global() });
    // The test's window is as wide as the three columns, which the page finds out once mounted:
    // the chat is then the panel beside the board, and there is no button under it.
    await flushPromises();
    expect(wrapper.findAll('.chat-panel')).toHaveLength(1);
    expect(wrapper.findAll('.open-chat')).toHaveLength(0);
    expect(wrapper.text()).toContain('Only the PIs see the colors of hidden cards.');

    const data = view.data as KeywordsRoomData;
    const game = data.game as KeywordsView;
    await wrapper.setProps({
      room: {
        ...view,
        data: { ...data, game: { ...game, phase: 'over', result: { winner: 'red', reason: 'found' } } },
      },
    });
    expect(wrapper.findAll('.chat-panel')).toHaveLength(1);
    expect(wrapper.find('.letter .verdict').text()).toBe('Accept (Oral)');
    expect(wrapper.text()).not.toContain('Only the PIs see the colors of hidden cards.');
  });

  test('shows a paused game without its board, and offers the chair the way to resume', async () => {
    const view = room('bob');
    const data = view.data as KeywordsRoomData;
    const game = { ...(data.game as KeywordsView), paused: true, cards: [], clock: { left: 42_000, total: 90_000 } };
    const paused = (me: string) => ({ ...view, me, data: { ...data, side: seats[me]?.team ?? null, game } });
    const student = mount(KeywordsGame, { props: { room: paused('bob') }, global: global() });
    expect(student.find('.board').exists()).toBe(false);
    expect(student.get('.paused-title').text()).toBe('Paused');
    expect(student.text()).toContain('The chair has paused the game.');
    expect(student.find('.guess-bar').exists()).toBe(false);
    expect(student.find('.paused button').exists()).toBe(false);
    expect(student.find('.sticky-clock button').exists()).toBe(false);
    expect(student.get('.role-banner .line').text()).toBe('The game is paused.');
    // The clock stands still at what the server said.
    expect(student.get('[role="timer"]').attributes('aria-label')).toBe('42 seconds left');
    // The chair resumes, from the notice or from the end of the clock, which pauses the game
    // otherwise; the tools at the foot of the page have no way to pause.
    const chair = mount(KeywordsGame, { props: { room: paused('ann') }, global: global() });
    expect(chair.findAll('.tools button').map((button) => button.text())).toEqual(['How to play', 'End the game']);
    await chair.get('.paused button').trigger('click');
    expect(send).toHaveBeenLastCalledWith('keywords:resume', { gameId: 'g1' });
    send.mockClear();
    expect(chair.get('.sticky-clock .pause').text()).toBe('Resume the game');
    await chair.get('.sticky-clock .pause').trigger('click');
    expect(send).toHaveBeenLastCalledWith('keywords:resume', { gameId: 'g1' });
    const playing = mount(KeywordsGame, { props: { room: room('ann') }, global: global() });
    expect(playing.findAll('.tools button').map((button) => button.text())).not.toContain('Pause the game');
    expect(playing.get('.sticky-clock .pause').text()).toBe('Pause the game');
    await playing.get('.sticky-clock .pause').trigger('click');
    expect(send).toHaveBeenLastCalledWith('keywords:pause', { gameId: 'g1' });
  });

  // A game without a time limit has no clock: the chair's button to pause stands at the top alone,
  // and the others have nothing there.
  test('gives the chair the button to pause at the top of a game without a clock', async () => {
    const view = room('bob');
    const data = view.data as KeywordsRoomData;
    const game = { ...(data.game as KeywordsView), clock: null };
    const untimed = (me: string) => ({ ...view, me, data: { ...data, side: seats[me]?.team ?? null, game } });
    const chair = mount(KeywordsGame, { props: { room: untimed('ann') }, global: global() });
    expect(chair.find('[role="timer"]').exists()).toBe(false);
    expect(
      chair
        .get('.strip + .sticky-clock')
        .findAll('button')
        .map((button) => button.text()),
    ).toEqual(['Pause the game']);
    await chair.get('.sticky-clock .pause').trigger('click');
    expect(send).toHaveBeenLastCalledWith('keywords:pause', { gameId: 'g1' });
    const student = mount(KeywordsGame, { props: { room: untimed('bob') }, global: global() });
    expect(student.find('.sticky-clock').exists()).toBe(false);
  });

  test("offers the group's extension in its own turn, where the room allows one, and tells everyone of it", async () => {
    const view = room('bob');
    const data = view.data as KeywordsRoomData;
    const game = { ...(data.game as KeywordsView), clock: { left: 20_000, total: 90_000 } };
    const settings = { ...STANDARD, extensions: true };
    const extend = (wrapper: ReturnType<typeof mount>) =>
      wrapper.findAll('button').find((button) => button.text() === 'Ask for 30 seconds more');
    // Not without the setting, and not for the other group or a spectator.
    expect(
      extend(mount(KeywordsGame, { props: { room: { ...view, data: { ...data, game } } }, global: global() })),
    ).toBeUndefined();
    const allowed = (me: string, more: Partial<KeywordsView> = {}) => ({
      ...view,
      me,
      data: { ...data, settings, side: seats[me]?.team ?? null, game: { ...game, ...more } },
    });
    expect(extend(mount(KeywordsGame, { props: { room: allowed('eve') }, global: global() }))).toBeUndefined();
    expect(extend(mount(KeywordsGame, { props: { room: allowed('ann') }, global: global() }))).toBeUndefined();
    const wrapper = mount(KeywordsGame, { props: { room: allowed('bob') }, global: global() });
    await extend(wrapper)?.trigger('click');
    expect(send).toHaveBeenLastCalledWith('keywords:extend', { gameId: 'g1', turn: 2 });
    // Once used, it is gone, and the toast says who asked.
    await wrapper.setProps({
      room: allowed('bob', {
        extended: { red: true, blue: false },
        events: [{ turn: 2, kind: 'extended', team: 'red' }],
      }),
    });
    expect(extend(wrapper)).toBeUndefined();
    expect(toasts.map((item) => item.key)).toContain('game.extended');
    toasts.splice(0);
  });

  test('reviews the game that has ended, step by step, from the start', async () => {
    const view = room('bob');
    const data = view.data as KeywordsRoomData;
    const game: KeywordsView = {
      ...(data.game as KeywordsView),
      phase: 'over',
      cards: [
        { word: 'Baseline', revealed: true, color: 'red' },
        { word: 'Model', revealed: false, color: 'blue' },
        { word: 'Journal', revealed: false, color: 'reviewer2' },
      ],
      history: [
        { turn: 2, team: 'red', word: 'Science', count: 2, guesses: [{ card: 0, color: 'red', player: 'bob' }] },
      ],
      result: { winner: 'red', reason: 'found' },
    };
    const wrapper = mount(KeywordsGame, { props: { room: { ...view, data: { ...data, game } } }, global: global() });
    await wrapper
      .findAll('.tools button')
      .find((button) => button.text() === 'Review the game')
      ?.trigger('click');
    const replay = wrapper.get('.replay');
    expect(replay.get('.position').text()).toBe('Step 1 of 3');
    expect(replay.get('.step').text()).toBe('The start. Nothing has been revealed yet.');
    expect(replay.findAll('.board .card.revealed')).toHaveLength(0);
    expect(replay.findAll('.board .card.known')).toHaveLength(3);
    await replay.get('input[type="range"]').setValue('2');
    expect(replay.get('.position').text()).toBe('Step 3 of 3');
    expect(replay.findAll('.step p').map((line) => line.text())).toEqual([
      'Turn 2 \u00b7 Red group',
      'Clue: Science 2',
      "You revealed \u201cBaseline\u201d: right, one of the group's own".replace('You', 'Bob'),
      'The Red group won.',
    ]);
    expect(
      replay
        .get('.board .card.marked .word')
        .text()
        .replace(/\u00ad/g, ''),
    ).toBe('Baseline');
    expect(replay.findAll('.board .card.revealed')).toHaveLength(1);
    const buttons = replay.findAll('.controls button');
    expect(buttons[1]?.attributes('disabled')).toBeDefined();
    await buttons[0]?.trigger('click');
    expect(replay.get('.position').text()).toBe('Step 2 of 3');
  });

  // The clock stands apart from the turn strip, where it can stay at the top of the screen, and
  // under the banner while the page reconnects. A screen reader finds one timer.
  test('shows one clock, under the turn strip, which moves below the reconnecting banner', async () => {
    const view = room('bob');
    const data = view.data as KeywordsRoomData;
    const game = { ...(data.game as KeywordsView), clock: { left: 42_000, total: 90_000 } };
    const wrapper = mount(KeywordsGame, { props: { room: { ...view, data: { ...data, game } } }, global: global() });
    expect(wrapper.findAll('[role="timer"]')).toHaveLength(1);
    expect(wrapper.find('.strip .clock').exists()).toBe(false);
    const bar = wrapper.get('.strip + .sticky-clock');
    expect(bar.get('.clock').attributes('aria-label')).toBe('42 seconds left');
    // Bob isn't the chair: there is no button to pause beside his clock.
    expect(bar.find('button').exists()).toBe(false);
    expect(bar.classes()).not.toContain('below-banner');
    page.connection.connected = false;
    await flushPromises();
    expect(bar.classes()).toContain('below-banner');
    page.connection.connected = true;
  });
});
