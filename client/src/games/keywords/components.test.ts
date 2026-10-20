// @vitest-environment happy-dom
import {
  clueCounts,
  defaultSettings,
  type CardView,
  type ChatMessage,
  type ClueRecord,
  type KeywordsRoomData,
  type KeywordsSettings,
  type KeywordsView,
  type MatchView,
  type RoomView,
  type Seat,
  type ShownReplay,
  type StandingView,
} from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { computed, defineComponent, h, nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { bubbles } from '../../core/emotes';
import { knowAliases } from '../../core/names';
import type { ShownRoom } from '../../core/room';
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
import KeywordsBoard from './KeywordsBoard.vue';
import KeywordsCard from './KeywordsCard.vue';
import KeywordsGame from './KeywordsGame.vue';
import { missedLine } from './missed';
import { heroLine } from './heroes';
import ReplayViewer from './ReplayViewer.vue';
import RulesSheet from './RulesSheet.vue';
import SettingsForm from './SettingsForm.vue';
import TurnStrip from './TurnStrip.vue';
import { HOLD_MS } from './useCardGestures';
import { useChatLine } from './useChatLine';
import { TURN_MS } from './useTurnedCard';

const send = vi.hoisted(() =>
  vi.fn<(event: string, payload?: object) => Promise<{ ok: boolean }>>(async () => ({ ok: true })),
);
// The page is connected already.
const page = vi.hoisted(() => ({ connection: { connected: true, everConnected: true, connects: 1 } }));
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
    history: [{ turn: 2, team: 'red', at: 0, word: 'Science', count: 2, guesses: [] }],
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
    titles: {},
    game,
  };
  return {
    roomId: 'r1',
    code: 'K7QX',
    rev: 1,
    game: 'keywords',
    language: 'en',
    fields: ['general'],
    randomFields: false,
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
    expect(entry.text()).toContain('Chat');
    expect(entry.get('.badge').text()).toBe('2');
    expect(entry.attributes('aria-label')).toBe('Group chat, 2 new');

    await entry.trigger('click');
    const turns = wrapper.findAll('.turn');
    expect(turns.map((turn) => turn.get('.turn-title').text())).toEqual(['Turn 1', 'Turn 2']);
    expect(turns[1]?.text()).toContain('You');
    expect(turns[1]?.text()).toContain('Cat');
    expect(wrapper.find('.badge').exists()).toBe(false);
  });

  // The room names a friend by the viewer's name for them, with the username kept beside (room.ts):
  // a message says the name, and its avatar is still the username's.
  test("names a friend by the viewer's name for them, and draws the avatar from the username", async () => {
    const view = room('bob', messages);
    const named: ShownRoom = {
      ...view,
      players: view.players.map((player) =>
        player.id === 'cat' ? { ...player, name: 'Kitty', username: 'Cat', handle: 'ca7000000000' } : player,
      ),
    };
    const wrapper = mount(GroupChat, { props: { room: named, draft: '', sending: false }, global: global() });
    await wrapper.get('button').trigger('click');
    expect(wrapper.findAll('.message .name').map((name) => name.text())).toEqual(['Kitty', 'You', 'Kitty']);
    expect(wrapper.get('.message .initial').attributes('data-initial')).toBe('C');
    const plain = mount(GroupChat, { props: { room: view, draft: '', sending: false }, global: global() });
    await plain.get('button').trigger('click');
    expect(wrapper.get('.message .avatar').attributes('style')).toBe(plain.get('.message .avatar').attributes('style'));
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

  test('shows who in the group has chosen it, as avatars, faded while offline, and names them to screen readers', () => {
    const wrapper = mount(KeywordsCard, {
      props: {
        card,
        index: 3,
        selectable: true,
        selected: false,
        choosers: [
          { name: 'Ann', online: true },
          { name: 'Cat', online: false },
        ],
      },
      global: global(),
    });
    expect(wrapper.get('.choosers').attributes('aria-hidden')).toBe('true');
    expect(wrapper.findAll('.choosers .avatar').map((avatar) => avatar.classes('veiled'))).toEqual([false, true]);
    expect(wrapper.find('.choosers .wait').exists()).toBe(false);
    expect(wrapper.get('button').attributes('aria-label')).toBe('Baseline, not revealed, chosen by Ann and Cat');
  });

  // Names that the viewer gives friends need not differ, from each other or from usernames: the
  // avatars are the usernames', and each chooser shows once.
  test("names a friend by the viewer's name for them, with the username's avatar", () => {
    const wrapper = mount(KeywordsCard, {
      props: {
        card,
        index: 3,
        selectable: true,
        selected: false,
        choosers: [
          { name: 'Prof. A', username: 'Ann', online: true },
          { name: 'Prof. A', username: 'Abe', online: true },
        ],
      },
      global: global(),
    });
    expect(wrapper.findAll('.choosers .initial').map((initial) => initial.attributes('data-initial'))).toEqual([
      'A',
      'A',
    ]);
    expect(wrapper.findAll('.choosers .avatar')).toHaveLength(2);
    expect(wrapper.get('button').attributes('aria-label')).toBe(
      'Baseline, not revealed, chosen by Prof. A and Prof. A',
    );
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

  // A card that has just been revealed turns over with the face it lay with: the paper, the yellow
  // of the viewer's choice, the tint of the group's mark or of the color a PI knew, or Reviewer 2's
  // ink for the PI who knew it; and, when the viewer didn't know its color, without the color's
  // label until the half-turn. A card revealed and lying still doesn't turn.
  test('turns over when it has just been revealed, with the face it had until then', async () => {
    const lying = async (
      before: Partial<InstanceType<typeof KeywordsCard>['$props']>,
      revealed: NonNullable<CardView['color']> = 'red',
    ) => {
      const wrapper = mount(KeywordsCard, {
        props: { card, index: 3, selectable: false, selected: false, choosers: [], ...before },
        global: global(),
      });
      expect(wrapper.get('button').classes()).not.toContain('turning');
      await wrapper.setProps({
        card: { ...card, color: revealed, revealed: true },
        selected: false,
        note: null,
        turning: true,
      });
      return wrapper.get('button').classes();
    };
    expect(await lying({})).toEqual(expect.arrayContaining(['turning', 'face-paper', 'was-hidden']));
    expect(await lying({ selectable: true, selected: true })).toContain('face-choice');
    expect(await lying({ note: { mark: 'theirs', color: 'blue' } })).toContain('face-blue');
    expect(await lying({ note: { mark: 'r2', color: 'r2' } })).toContain('face-r2');
    // The PI only reads the marks: the card keeps the tint of its own color, which the PI knows.
    const known = await lying({
      note: { mark: 'ours', color: 'blue' },
      noteQuiet: true,
      card: { ...card, color: 'red' },
    });
    expect(known).toContain('face-red');
    expect(known).not.toContain('was-hidden');
    expect(await lying({ card: { ...card, color: 'neutral' } }, 'neutral')).toContain('face-neutral');
    expect(await lying({ card: { ...card, color: 'reviewer2' } }, 'reviewer2')).toContain('face-ink');
    const still = mount(KeywordsCard, {
      props: {
        card: { ...card, color: 'red', revealed: true },
        index: 3,
        selectable: false,
        selected: false,
        choosers: [],
      },
      global: global(),
    });
    expect(still.get('button').classes()).not.toContain('turning');
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

  test('offers the numbers as stickers that lift and press, but for the one chosen, which stays pressed', async () => {
    const wrapper = panel();
    const pressing = () => wrapper.findAll('.counts button').map((button) => button.classes('press'));
    const chosenAt = () => wrapper.findAll('.counts button').findIndex((button) => button.classes('chosen'));
    expect(pressing().filter((pressed) => !pressed)).toHaveLength(1);
    expect(pressing()[chosenAt()]).toBe(false);
    await wrapper.findAll('.counts button')[0]?.trigger('click');
    expect(chosenAt()).toBe(0);
    expect(pressing()[0]).toBe(false);
    expect(pressing().slice(1).every(Boolean)).toBe(true);
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

  // The banner over the strip is gone: the strip says who the viewer is and what is going on for
  // them now, and the tab's title says so on their move.
  test("says who the viewer is and what is going on for them, and on their move the tab's title says so", async () => {
    // The page's own title, which the tab shows again after the viewer's move (head.ts).
    const title = document.title;
    const strip = mount(TurnStrip, { props: { game, guessRule: 'free', seat: seats.bob }, global: global() });
    await nextTick();
    expect(strip.get('.who').text()).toBe('You are Red group \u00b7 Student');
    expect(strip.get('.who').classes()).toContain('red');
    expect(strip.get('.phase').text()).toBe('Your turn to guess!');
    expect(document.title).toBe('Your turn!');
    await strip.setProps({ game: { ...game, phase: 'clue' } });
    expect(strip.get('.phase').text()).toBe('Your PI is thinking of a clue\u2026');
    expect(strip.get('.phase .dots').text()).toBe('\u2026');
    expect(document.title).toBe(title);
    await strip.setProps({ game });
    expect(document.title).toBe('Your turn!');
    strip.unmount();
    await nextTick();
    expect(document.title).toBe(title);
    // A spectator is told who is doing what, and a big screen what the current group is doing.
    const spectator = mount(TurnStrip, { props: { game, guessRule: 'free', seat: seats.eve }, global: global() });
    expect(spectator.get('.who').text()).toBe('You are a spectator');
    expect(spectator.get('.phase').text()).toBe('The Red group is guessing\u2026');
    const screen = mount(TurnStrip, { props: { game, guessRule: 'free' }, global: global() });
    expect(screen.find('.who').exists()).toBe(false);
    expect(screen.get('.phase').text()).toBe('Red group is guessing');
  });

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

  // The strip takes the tint of the viewer's group while it is their group's turn, in either phase;
  // its clock is red only while the viewer has to act.
  test("takes the viewer's group's tint on its turn, and has a red clock only on the viewer's move", async () => {
    const timed = { ...game, clock: { left: 42_000, total: 90_000 } };
    const strip = (seat: Seat | undefined, view: KeywordsView = timed) =>
      mount(TurnStrip, { props: { game: view, guessRule: 'free', seat }, global: global() });
    const guessing = strip(seats.bob);
    expect(guessing.get('.strip').classes()).toContain('ours');
    expect(guessing.get('.clock').classes()).toContain('mine');
    const thinking = strip(seats.bob, { ...timed, phase: 'clue' });
    expect(thinking.get('.strip').classes()).toContain('ours');
    expect(thinking.get('.clock').classes()).not.toContain('mine');
    const pi = strip(seats.ann);
    expect(pi.get('.strip').classes()).toContain('ours');
    expect(pi.get('.clock').classes()).not.toContain('mine');
    const theirs = strip(seats.bob, { ...timed, team: 'blue' });
    expect(theirs.get('.strip').classes()).not.toContain('ours');
    expect(theirs.get('.clock').classes()).not.toContain('mine');
    for (const other of [strip(seats.eve), strip(undefined)]) {
      expect(other.get('.strip').classes()).not.toContain('ours');
      expect(other.get('.clock').classes()).not.toContain('mine');
    }
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

describe('KeywordsBoard', () => {
  // The points rise from the card's cell of the grid, beside the card rather than in it, so that
  // they don't turn over with a card that has just been revealed.
  test('raises the points of a revealed card from its place on the board, outside the card', () => {
    const cards: CardView[] = Array.from({ length: 25 }, (_, index) => ({ word: `Word${index}`, revealed: false }));
    const wrapper = mount(KeywordsBoard, {
      props: {
        cards,
        selectable: false,
        selected: null,
        lang: 'en',
        float: { key: 1, text: '+1', team: 'red', card: 7 },
      },
      global: global(),
    });
    const float = wrapper.get('.score-float').element as HTMLElement;
    expect(float.parentElement).toBe(wrapper.get('.board').element);
    expect(float.style.gridRow).toBe('2 / 3');
    expect(float.style.gridColumn).toBe('3 / 4');
    expect(wrapper.find('.card .score-float').exists()).toBe(false);
  });
});

describe('ReplayViewer', () => {
  const replay: ShownReplay = {
    gameId: 'g1',
    language: 'en',
    startingTeam: 'red',
    cards: [
      { word: 'Baseline', color: 'red' },
      { word: 'Model', color: 'blue' },
      { word: 'Journal', color: 'reviewer2' },
    ],
    history: [
      {
        turn: 1,
        team: 'red',
        at: 0,
        word: 'Science',
        count: 2,
        captain: 'ann',
        guesses: [{ card: 0, color: 'red', player: 'bob', at: 0 }],
      },
    ],
    result: { winner: 'red', reason: 'found' },
    groups: [
      { team: 'red', captain: 'ann', guessers: ['bob'] },
      { team: 'blue', captain: 'cat', guessers: ['dee'] },
    ],
    people: {
      ann: { name: 'Ann', handle: 'h-ann' },
      bob: { guest: 2 },
      cat: { deleted: true },
      dee: { agent: 'reviewer1' },
    },
    me: 'bob',
  };

  test('shows last what the group has said since the game ended, and nothing without it', () => {
    const talk = [{ id: 4, name: 'Ann', text: 'Well played' }];
    const wrapper = mount(ReplayViewer, { props: { replay, talk }, global: global() });
    expect(wrapper.get('.talk h3').text()).toBe('Talking it over');
    expect(wrapper.get('.talk .line .name').text()).toBe('Ann');
    expect(wrapper.get('.talk .line').text()).toContain('Well played');
    expect(mount(ReplayViewer, { props: { replay }, global: global() }).find('.talk').exists()).toBe(false);
  });

  test('turns the card that a step reveals over, as the game did, and none going back', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = mount(ReplayViewer, { props: { replay }, global: global() });
      const turning = () => wrapper.findAll('.board button').map((button) => button.classes('turning'));
      await wrapper.get('input[type="range"]').setValue('1');
      expect(turning()).toEqual([false, false, false]);
      await wrapper.get('input[type="range"]').setValue('2');
      expect(turning()).toEqual([true, false, false]);
      // Every card of a replay shows its color: the card turns with the tint it lay with.
      expect(wrapper.findAll('.board button')[0]?.classes()).toContain('face-red');
      vi.advanceTimersByTime(TURN_MS);
      await nextTick();
      expect(turning()).toEqual([false, false, false]);
      await wrapper.get('input[type="range"]').setValue('0');
      expect(turning()).toEqual([false, false, false]);
      // A step back while the card is still turning lays it face down, with no turn on it, and the
      // step forward turns it again.
      await wrapper.get('input[type="range"]').setValue('2');
      expect(turning()).toEqual([true, false, false]);
      await wrapper.get('input[type="range"]').setValue('1');
      expect(turning()).toEqual([false, false, false]);
      await wrapper.get('input[type="range"]').setValue('2');
      expect(turning()).toEqual([true, false, false]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("shows the cards the PI meant through the clue's turn, and names them at the clue", async () => {
    const meant: ShownReplay = { ...replay, history: [{ ...(replay.history[0] as ClueRecord), targets: [1, 0] }] };
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

  test('names a guest who revealed a card by their number, an AI player by its persona, and someone gone as gone', async () => {
    const wrapper = mount(ReplayViewer, { props: { replay }, global: global() });
    await wrapper.get('input[type="range"]').setValue('2');
    expect(wrapper.get('.step').text()).toContain('Guest 2 revealed \u201cBaseline\u201d');
    const byAi: ShownReplay = {
      ...replay,
      history: [{ ...(replay.history[0] as ClueRecord), guesses: [{ card: 0, color: 'red', player: 'dee', at: 0 }] }],
    };
    await wrapper.setProps({ replay: byAi });
    expect(wrapper.get('.step').text()).toContain('Reviewer 1 revealed \u201cBaseline\u201d');
    const byNobody: ShownReplay = {
      ...replay,
      history: [{ ...(replay.history[0] as ClueRecord), guesses: [{ card: 0, color: 'red', player: 'zed', at: 0 }] }],
    };
    await wrapper.setProps({ replay: byNobody });
    expect(wrapper.get('.step').text()).toContain('A player who left revealed');
  });

  test('keeps its step when the same game comes again, and starts over with another game', async () => {
    const wrapper = mount(ReplayViewer, { props: { replay }, global: global() });
    await wrapper.get('input[type="range"]').setValue('2');
    expect(wrapper.get('.position').text()).toBe('Step 3 of 3');
    // The results page builds the replay anew from every snapshot, as when someone's phone locks.
    await wrapper.setProps({ replay: { ...replay, people: { ...replay.people } } });
    expect(wrapper.get('.position').text()).toBe('Step 3 of 3');
    await wrapper.setProps({ replay: { ...replay, gameId: 'g2' } });
    expect(wrapper.get('.position').text()).toBe('Step 1 of 3');
  });

  test('shows the groups above the board, with what each had still to find at the step, the viewer first', async () => {
    const wrapper = mount(ReplayViewer, { props: { replay }, global: global() });
    const bars = () => wrapper.findAll('.scores .score');
    expect(bars().map((bar) => bar.get('.sr-only').text())).toEqual(['Red group', 'Blue group']);
    const left = () => bars().map((bar) => bar.find(':scope > span:last-child').text());
    expect(left()).toEqual(['1', '1']);
    await wrapper.get('input[type="range"]').setValue('2');
    expect(left()).toEqual(['0', '1']);
    // Everyone's avatar opens their panel; a deleted account shows as deleted.
    const buttons = wrapper.findAll('.scores button.avatar-button');
    expect(buttons.map((button) => button.attributes('aria-label'))).toEqual([
      "View Ann's profile",
      "View Guest 2's profile",
      "View Deleted player's profile",
      "View Reviewer 1's profile",
    ]);
    expect(buttons[2]?.get('.initial').attributes('data-initial')).toBe('D');
    expect(buttons[1]?.get('.initial').attributes('data-initial')).toBe('G');
  });

  // The viewer's own name for a friend, as everywhere (names.ts): in the bars, the steps and the
  // panel, with the username after it on the panel's whole page; the avatar is the username's.
  test("names a friend by the viewer's name for them, with the username after it on the whole page", async () => {
    knowAliases([{ handle: 'h-ann', alias: 'Prof. A' }]);
    const byAnn: ShownReplay = {
      ...replay,
      history: [{ ...(replay.history[0] as ClueRecord), guesses: [{ card: 0, color: 'red', player: 'ann', at: 0 }] }],
    };
    const wrapper = mount(ReplayViewer, {
      props: { replay: byAnn },
      global: { ...global(), stubs: { teleport: true, ProfileCard: true } },
    });
    await wrapper.get('input[type="range"]').setValue('2');
    expect(wrapper.get('.step').text()).toContain('Prof. A revealed “Baseline”');
    const ann = wrapper.findAll('.scores button.avatar-button')[0];
    expect(ann?.attributes('aria-label')).toBe("View Prof. A's profile");
    expect(ann?.get('.initial').attributes('data-initial')).toBe('A');
    await ann?.trigger('click');
    const dialogs = () => wrapper.findAll('[role="dialog"]');
    expect(dialogs()[0]?.get('h2').text()).toBe('Prof. A Ann');
    const button = (text: string) =>
      dialogs()[0]
        ?.findAll('.actions button')
        .find((found) => found.text() === text);
    await button('Open the full page')?.trigger('click');
    expect(dialogs()[1]?.get('h2').text()).toBe('Prof. A Ann');
    expect(dialogs()[1]?.get('h2 .subtitle').text()).toBe('Ann');
    await dialogs()[1]?.get('button.back').trigger('click');
    await button('View moves')?.trigger('click');
    expect(dialogs()[1]?.get('h2').text()).toBe('Moves by Prof. A');
    wrapper.unmount();
    knowAliases([]);
  });

  test("opens a player's panel from their avatar, with their moves over it, which take the replay to their step", async () => {
    // The cards of an account's page and an AI player's read the server, which isn't here.
    const wrapper = mount(ReplayViewer, {
      props: { replay },
      global: { ...global(), stubs: { teleport: true, ProfileCard: true, AgentProfileCard: true } },
    });
    const dialogs = () => wrapper.findAll('[role="dialog"]');
    await wrapper.findAll('.scores button.avatar-button')[1]?.trigger('click');
    expect(dialogs()).toHaveLength(1);
    expect(dialogs()[0]?.get('h2').text()).toBe('Guest 2');
    // A guest has no page, and nothing of the chair's is here.
    const actions = () =>
      dialogs()[0]
        ?.findAll('.actions button')
        .map((button) => button.text());
    expect(actions()).toEqual(['View moves']);
    // The moves lie over the panel, which they hide until the way back leads to it again.
    const top = () => dialogs().at(-1);
    await dialogs()[0]?.get('.actions button').trigger('click');
    expect(dialogs()).toHaveLength(2);
    expect(wrapper.get('.backdrop.covered h2').text()).toBe('Guest 2');
    expect(top()?.get('h2').text()).toBe('Moves by Guest 2');
    await top()?.get('button.back').trigger('click');
    expect(dialogs()).toHaveLength(1);
    expect(wrapper.find('.backdrop.covered').exists()).toBe(false);
    await dialogs()[0]?.get('.actions button').trigger('click');
    const moves = top()?.findAll('.move') ?? [];
    expect(moves.map((move) => move.text())).toEqual([
      "Turn 1 · Red groupRevealed \u201cBaseline\u201d: right, one of the group's own",
    ]);
    await moves[0]?.trigger('click');
    expect(dialogs()).toHaveLength(0);
    expect(wrapper.get('.position').text()).toBe('Step 3 of 3');
    // The PI's clue, from the PI's panel, which has the way to the whole page too.
    await wrapper.findAll('.scores button.avatar-button')[0]?.trigger('click');
    expect(
      dialogs()[0]
        ?.findAll('.actions button')
        .map((button) => button.text()),
    ).toEqual(['View moves', 'Open the full page']);
    await dialogs()[0]?.get('.actions button').trigger('click');
    expect(top()?.get('.move').text()).toBe('Turn 1 · Red groupClue: Science 21 right of 1 revealed');
    await top()?.get('.move').trigger('click');
    expect(wrapper.get('.position').text()).toBe('Step 2 of 3');
  });
});

describe('ClockBar', () => {
  const PERIOD = '7:4:clue';
  const clockBar = (left: number, total = 60_000) =>
    mount(ClockBar, { props: { clock: { left, total }, period: PERIOD }, global: global() });
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("counts down from what the server said, is red only on the viewer's move, and stops at zero", async () => {
    const wrapper = clockBar(12_000);
    expect(wrapper.get('.seconds').text()).toBe('0:12');
    expect(wrapper.get('.fill').attributes('style')).toContain('scaleX(0.2)');
    expect(wrapper.classes()).not.toContain('mine');
    vi.advanceTimersByTime(5_000);
    await flushPromises();
    expect(wrapper.get('.seconds').text()).toBe('0:07');
    expect(wrapper.classes()).not.toContain('mine');
    await wrapper.setProps({ mine: true });
    expect(wrapper.classes()).toContain('mine');
    vi.advanceTimersByTime(30_000);
    await flushPromises();
    expect(wrapper.get('.seconds').text()).toBe('0:00');
    expect(wrapper.get('.fill').attributes('style')).toContain('scaleX(0)');
  });

  test('sets itself right with a snapshot that ends the period sooner', async () => {
    const wrapper = clockBar(50_000);
    vi.advanceTimersByTime(5_000);
    await wrapper.setProps({ clock: { left: 30_000, total: 60_000 } });
    expect(wrapper.get('.seconds').text()).toBe('0:30');
    vi.advanceTimersByTime(1_000);
    await flushPromises();
    expect(wrapper.get('.seconds').text()).toBe('0:29');
  });

  // A snapshot that was longer on its way than the one before gives a later end: the seconds don't
  // go back up for it.
  test("doesn't count back up for a snapshot that arrived late", async () => {
    const wrapper = clockBar(50_000);
    vi.advanceTimersByTime(4_500);
    await flushPromises();
    expect(wrapper.get('.seconds').text()).toBe('0:46');
    // Sent 300 ms after the first one, and 4.2 seconds longer on its way.
    await wrapper.setProps({ clock: { left: 49_700, total: 60_000 } });
    expect(wrapper.get('.seconds').text()).toBe('0:46');
    vi.advanceTimersByTime(500);
    await flushPromises();
    expect(wrapper.get('.seconds').text()).toBe('0:45');
  });

  // A page that was away, as after a locked screen, may have missed a pause: the first snapshot of
  // its new connection gives a later end than the snapshots before it did, and is right.
  test('starts afresh when the page connects again', async () => {
    const wrapper = clockBar(40_000);
    vi.advanceTimersByTime(5_000);
    await flushPromises();
    expect(wrapper.get('.seconds').text()).toBe('0:35');
    // Away for 2 minutes, while the game was paused and resumed.
    vi.advanceTimersByTime(120_000);
    await flushPromises();
    expect(wrapper.get('.seconds').text()).toBe('0:00');
    page.connection.connects += 1;
    await wrapper.setProps({ clock: { left: 34_000, total: 60_000 } });
    expect(wrapper.get('.seconds').text()).toBe('0:34');
    vi.advanceTimersByTime(1_000);
    await flushPromises();
    expect(wrapper.get('.seconds').text()).toBe('0:33');
  });

  // A new phase or turn, more time for this one, and a game that goes on after a pause each give an
  // end that the earlier snapshots knew nothing of.
  test('starts afresh for a new period, for more time and after a pause', async () => {
    const wrapper = clockBar(5_000);
    await wrapper.setProps({ clock: { left: 90_000, total: 90_000 }, period: '7:4:guess' });
    expect(wrapper.get('.seconds').text()).toBe('1:30');
    await wrapper.setProps({ clock: { left: 120_000, total: 120_000 } });
    expect(wrapper.get('.seconds').text()).toBe('2:00');
    vi.advanceTimersByTime(10_000);
    await wrapper.setProps({ clock: { left: 110_000, total: 120_000 }, frozen: true });
    vi.advanceTimersByTime(60_000);
    await flushPromises();
    expect(wrapper.get('.seconds').text()).toBe('1:50');
    await wrapper.setProps({ frozen: false });
    vi.advanceTimersByTime(1_000);
    await flushPromises();
    expect(wrapper.get('.seconds').text()).toBe('1:49');
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
    const wrapper = clockBar(2_300);
    expect(wrapper.get('.seconds').text()).toBe('0:03');
    expect(waits()).toEqual([300, 1_000, 1_000]);
    await flushPromises();
    expect(wrapper.get('.seconds').text()).toBe('0:00');

    const running = clockBar(30_000);
    expect(vi.getTimerCount()).toBe(1);
    running.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  // The time left is rarely a whole number of milliseconds, and a timer drops the fraction: a wait
  // of 300.5 ms that was not rounded up would end before the second changed, and the clock would
  // have to wake up twice for one second.
  test('rounds its waits up to whole milliseconds', async () => {
    const wrapper = clockBar(2_300.5);
    expect(waits()).toEqual([301, 1_000, 1_000]);
    await flushPromises();
    expect(wrapper.get('.seconds').text()).toBe('0:00');
  });

  test('shows minutes and seconds', () => {
    const wrapper = clockBar(600_000, 600_000);
    expect(wrapper.get('.seconds').text()).toBe('10:00');
  });
});

describe('ClueLog', () => {
  test('says when a turn ran out of time, before the clue or during the guesses', () => {
    const game = (room('bob').data as KeywordsRoomData).game as KeywordsView;
    const history: KeywordsView['history'] = [
      { turn: 1, team: 'red', at: 0, word: null, count: null, guesses: [], timedOut: true },
      {
        turn: 2,
        team: 'blue',
        at: 0,
        word: 'Science',
        count: 2,
        guesses: [{ card: 0, color: 'blue', player: 'dan', at: 0 }],
        timedOut: true,
      },
      { turn: 3, team: 'red', at: 0, word: 'Loss', count: 1, guesses: [] },
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
      { turn: 1, team: 'red', at: 0, word: 'Loss', count: 1, guesses: [] },
      {
        turn: 2,
        team: 'red',
        at: 0,
        word: 'Science',
        count: 2,
        guesses: [{ card: 0, color: 'red', player: 'bob', at: 0 }],
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
      {
        turn: 2,
        team: 'red',
        at: 0,
        word: 'Science',
        count: 2,
        guesses: [{ card: 1, color: 'red', player: 'bob', at: 0 }],
      },
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
  const CLUE = 'A PI who gives no clue in time loses the turn to the other group, and 5 points of their own.';
  const GUESS = 'Students whose time runs out end their turn, even if they have revealed nothing.';
  const EXTENSION = 'Each group may once a game ask for 30 seconds more for the phase it is in.';
  const PAUSE =
    'The chair can pause the game at any time. The board is hidden until the chair resumes it, and the clock goes on from where it stopped.';

  test('says which avatars can be tapped, with the roles', async () => {
    const wrapper = mount(RulesSheet, { props: { settings: STANDARD, language: 'en' }, global: global() });
    await wrapper.get('button').trigger('click');
    const roles = wrapper.findAll('.rules section').find((found) => found.get('h3').text() === 'Roles');
    expect(roles?.findAll('p').at(-1)?.text()).toBe(
      "An avatar with a shadow can be tapped: it opens the player's page, or for a guest or an AI player, their panel.",
    );
  });

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
    // Nothing marks a player who is online; one who is offline has the dots of someone the room
    // waits for, in a faded avatar.
    expect(red.find('.dot').exists()).toBe(false);
    expect(red.find('.avatar .wait').exists()).toBe(false);
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

  // A tap on a card, which counts at once (useCardGestures.ts).
  async function tapCard(wrapper: ReturnType<typeof mount>, index: number) {
    await card(wrapper, index)?.trigger('click');
    await flushPromises();
  }

  // A long press on a card, held until the menu of marks opens (MarkMenu.vue), and the click that
  // ends it, which chooses nothing.
  async function holdCard(wrapper: ReturnType<typeof mount>, index: number) {
    vi.useFakeTimers();
    const press = { isPrimary: true, button: 0, pointerType: 'touch', clientX: 5, clientY: 5 };
    await card(wrapper, index)?.trigger('pointerdown', press);
    vi.advanceTimersByTime(HOLD_MS);
    await card(wrapper, index)?.trigger('pointerup');
    await card(wrapper, index)?.trigger('click');
    vi.useRealTimers();
    await flushPromises();
  }
  // The menu is drawn in place here, where the tests stub the teleport to the end of the page.
  const menuItems = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAll<HTMLButtonElement>('.mark-menu [role="menuitemradio"]').map((item) => item.element);
  // A mark chosen in the open menu, which closes it, and then puts the mark on the card: the lifted
  // copy's move never ends here, so the menu waits for it as long as it does at most (MarkMenu.vue).
  async function chooseMark(wrapper: ReturnType<typeof mount>, index: number) {
    vi.useFakeTimers();
    menuItems(wrapper)[index]?.click();
    vi.advanceTimersByTime(1_000);
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
  test('lets a student mark cards for the group from the menu that a long press opens, and take a mark back', async () => {
    send.mockImplementation(later);
    const wrapper = mount(KeywordsGame, { props: { room: marked([]) }, global: global() });
    // No row of tools: the line above the guess bar's buttons says what a tap and a press do.
    expect(wrapper.find('.mark-tools').exists()).toBe(false);
    expect(wrapper.get('.guess-bar .hint').text()).toBe('Tap: choose \u00b7 hold: mark \u00b7 or keys 1, 2, 3');
    // A tap chooses at once, a marked card too.
    await tapCard(wrapper, 0);
    expect(send).toHaveBeenLastCalledWith('keywords:select', { gameId: 'g1', turn: 2, card: 0 });
    // A long press opens the menu for the card, which lifts out of the page meanwhile; the click
    // that ends the press chooses nothing.
    send.mockClear();
    await holdCard(wrapper, 1);
    expect(menuItems(wrapper).map((item) => item.textContent?.trim())).toEqual(['Ours1', 'Theirs2', 'R2?3']);
    expect(menuItems(wrapper).map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false']);
    expect(wrapper.find('.mark-menu [role="menu"]').attributes('aria-label')).toBe('Mark Model');
    expect(card(wrapper, 1)?.classes()).toContain('lifting');
    expect(send).not.toHaveBeenCalled();
    await chooseMark(wrapper, 0);
    expect(send).toHaveBeenLastCalledWith('keywords:mark', { gameId: 'g1', card: 1, mark: 'ours' });
    expect(wrapper.find('.mark-menu').exists()).toBe(false);
    expect(card(wrapper, 1)?.classes()).toEqual(expect.arrayContaining(['noted', 'note-red']));
    expect(card(wrapper, 1)?.classes()).not.toContain('lifting');
    // The card's own mark stands out in the menu, and choosing it again takes it off, before the
    // first has been answered; another one takes its place.
    await holdCard(wrapper, 1);
    expect(menuItems(wrapper).map((item) => item.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(menuItems(wrapper)[0]?.classList).toContain('current');
    await chooseMark(wrapper, 0);
    expect(send).toHaveBeenLastCalledWith('keywords:mark', { gameId: 'g1', card: 1, mark: null });
    expect(card(wrapper, 1)?.classes()).not.toContain('noted');
    await holdCard(wrapper, 2);
    await chooseMark(wrapper, 2);
    expect(send).toHaveBeenLastCalledWith('keywords:mark', { gameId: 'g1', card: 2, mark: 'r2' });
    expect(card(wrapper, 2)?.classes()).toContain('note-r2');
    // Escape closes the menu, wherever the focus is, and the card keeps what it had.
    send.mockClear();
    await holdCard(wrapper, 2);
    vi.useFakeTimers();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    vi.advanceTimersByTime(1_000);
    vi.useRealTimers();
    await flushPromises();
    expect(wrapper.find('.mark-menu').exists()).toBe(false);
    expect(send).not.toHaveBeenCalled();
    for (const answer of answers.splice(0)) answer();
    await flushPromises();
    send.mockImplementation(async () => ({ ok: true }));
  });

  // A press on something in the menu, as the browser dispatches it. Vue drops an event that a
  // test's trigger() stamps with a time before the menu was mounted, as under the fake timers.
  const pressOn = (element: Element) => element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

  test('keeps the menu open through the click that lands on the lifted card, and closes it on a press beside it', async () => {
    const wrapper = mount(KeywordsGame, { props: { room: marked([]) }, global: global() });
    await holdCard(wrapper, 1);
    // On a phone, the click that ends the press lands on the card's copy, which the menu lifted
    // under the finger, or beside it: a click closes nothing.
    await wrapper.get('.mark-menu .lifted').trigger('click');
    await wrapper.get('.mark-menu .scrim').trigger('click');
    expect(menuItems(wrapper)).toHaveLength(3);
    // A press beside the menu closes it, with the card as it was.
    send.mockClear();
    vi.useFakeTimers();
    pressOn(wrapper.get('.mark-menu .scrim').element);
    vi.advanceTimersByTime(1_000);
    vi.useRealTimers();
    await flushPromises();
    expect(wrapper.find('.mark-menu').exists()).toBe(false);
    expect(card(wrapper, 1)?.classes()).not.toContain('lifting');
    expect(send).not.toHaveBeenCalled();
    // So does a press on the lifted card.
    await holdCard(wrapper, 1);
    vi.useFakeTimers();
    pressOn(wrapper.get('.mark-menu .lifted').element);
    vi.advanceTimersByTime(1_000);
    vi.useRealTimers();
    await flushPromises();
    expect(wrapper.find('.mark-menu').exists()).toBe(false);
  });

  test('sinks no revealed card under a press, which opens no menu', async () => {
    const wrapper = mount(KeywordsGame, {
      props: {
        room: marked([], { cards: [{ word: 'Done', revealed: true, color: 'red' }, ...cards('Model', 'Journal')] }),
      },
      global: global(),
    });
    vi.useFakeTimers();
    const press = { isPrimary: true, button: 0, pointerType: 'touch', clientX: 5, clientY: 5 };
    await card(wrapper, 0)?.trigger('pointerdown', press);
    expect(card(wrapper, 0)?.classes()).not.toContain('pressing');
    vi.advanceTimersByTime(HOLD_MS);
    vi.useRealTimers();
    await flushPromises();
    expect(wrapper.find('.mark-menu').exists()).toBe(false);
    // A card face down sinks while it is pressed.
    await card(wrapper, 1)?.trigger('pointerdown', press);
    expect(card(wrapper, 1)?.classes()).toContain('pressing');
    await card(wrapper, 1)?.trigger('pointerup');
    expect(card(wrapper, 1)?.classes()).not.toContain('pressing');
  });

  test('opens the menu of marks on a right click with a mouse, and on no press that moves away', async () => {
    const wrapper = mount(KeywordsGame, { props: { room: marked([]) }, global: global() });
    // A press that moves, as the page scrolls, is no press.
    vi.useFakeTimers();
    const press = { isPrimary: true, button: 0, pointerType: 'touch', clientX: 5, clientY: 5 };
    await card(wrapper, 1)?.trigger('pointerdown', press);
    await card(wrapper, 1)?.trigger('pointermove', { ...press, clientY: 40 });
    vi.advanceTimersByTime(HOLD_MS);
    vi.useRealTimers();
    await flushPromises();
    expect(wrapper.find('.mark-menu').exists()).toBe(false);
    // A right click.
    await card(wrapper, 1)?.trigger('pointerdown', { isPrimary: true, button: 2, pointerType: 'mouse' });
    const context = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    card(wrapper, 1)?.element.dispatchEvent(context);
    await flushPromises();
    expect(context.defaultPrevented).toBe(true);
    expect(menuItems(wrapper)).toHaveLength(3);
    await chooseMark(wrapper, 1);
    expect(send).toHaveBeenLastCalledWith('keywords:mark', { gameId: 'g1', card: 1, mark: 'theirs' });
  });

  test('opens the menu on a press with a key held that the browser takes for a right click, once', async () => {
    const wrapper = mount(KeywordsGame, { props: { room: marked([]) }, global: global() });
    // On a Mac, a click with Control held is a right click: the press comes first, then the
    // browser's word of a context menu, and the press is over.
    vi.useFakeTimers();
    await card(wrapper, 1)?.trigger('pointerdown', {
      isPrimary: true,
      button: 0,
      pointerType: 'mouse',
      ctrlKey: true,
      clientX: 5,
      clientY: 5,
    });
    card(wrapper, 1)?.element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(menuItems(wrapper)).toHaveLength(3);
    vi.advanceTimersByTime(HOLD_MS);
    vi.useRealTimers();
    await flushPromises();
    expect(wrapper.findAll('.mark-menu')).toHaveLength(1);
    expect(card(wrapper, 1)?.classes()).not.toContain('pressing');
    await chooseMark(wrapper, 2);
    expect(send).toHaveBeenLastCalledWith('keywords:mark', { gameId: 'g1', card: 1, mark: 'r2' });
  });

  test('gives the card the focus again as the menu closes, and a key ends the press for the next tap', async () => {
    const wrapper = mount(KeywordsGame, { props: { room: marked([]) }, global: global(), attachTo: document.body });
    await holdCard(wrapper, 1);
    // The menu takes the focus as it opens, which this page, laid out by nobody, needs a hand with.
    menuItems(wrapper)[0]?.focus();
    expect(document.activeElement).toBe(menuItems(wrapper)[0]);
    await chooseMark(wrapper, 0);
    await flushPromises();
    expect(card(wrapper, 1)?.classes()).not.toContain('lifting');
    expect(document.activeElement).toBe(card(wrapper, 1)?.element);
    // Enter on the card, which the browser clicks with, chooses it: the press that opened the menu
    // is long over.
    await card(wrapper, 1)?.trigger('keydown', { key: 'Enter' });
    await tapCard(wrapper, 1);
    expect(send).toHaveBeenLastCalledWith('keywords:select', { gameId: 'g1', turn: 2, card: 1 });
    // Tab closes the menu too, rather than leaving it open over the page behind the scrim, and
    // gives the card the focus again.
    await holdCard(wrapper, 2);
    menuItems(wrapper)[0]?.focus();
    vi.useFakeTimers();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    menuItems(wrapper)[0]?.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    vi.advanceTimersByTime(1_000);
    vi.useRealTimers();
    await flushPromises();
    expect(wrapper.find('.mark-menu').exists()).toBe(false);
    expect(document.activeElement).toBe(card(wrapper, 2)?.element);
    wrapper.unmount();
    document.body.innerHTML = '';
  });

  test('closes the menu by itself once the card is revealed, or the student may no longer mark', async () => {
    const view = marked([]);
    const wrapper = mount(KeywordsGame, { props: { room: view }, global: global(), attachTo: document.body });
    await holdCard(wrapper, 1);
    expect(menuItems(wrapper)).toHaveLength(3);
    menuItems(wrapper)[0]?.focus();
    // A teammate reveals the card meanwhile: the menu goes, and the card has the focus again.
    const data = view.data as KeywordsRoomData;
    const game = data.game as KeywordsView;
    const cards = game.cards.map((card, index) =>
      index === 1 ? { ...card, revealed: true, color: 'neutral' as const } : card,
    );
    await wrapper.setProps({ room: { ...view, data: { ...data, game: { ...game, cards } } } });
    await flushPromises();
    expect(wrapper.find('.mark-menu').exists()).toBe(false);
    expect(card(wrapper, 1)?.classes()).not.toContain('lifting');
    expect(document.activeElement).toBe(card(wrapper, 1)?.element);
    // The game ends while the menu is open.
    await holdCard(wrapper, 2);
    expect(menuItems(wrapper)).toHaveLength(3);
    const over = {
      ...game,
      cards,
      phase: 'over' as const,
      result: { winner: 'red' as const, reason: 'found' as const },
    };
    await wrapper.setProps({ room: { ...view, data: { ...data, game: over } } });
    await flushPromises();
    expect(wrapper.find('.mark-menu').exists()).toBe(false);
    expect(card(wrapper, 2)?.classes()).not.toContain('lifting');
    wrapper.unmount();
    document.body.innerHTML = '';
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

  test('marks while the other group guesses, where a tap chooses nothing', async () => {
    const wrapper = mount(KeywordsGame, { props: { room: marked([], { team: 'blue' }) }, global: global() });
    expect(wrapper.find('.guess-bar').exists()).toBe(false);
    expect(wrapper.get('.status').text()).toBe('The Blue group is guessing.');
    expect(wrapper.get('.gestures').text()).toBe('Hold a card to mark it \u00b7 or keys 1, 2, 3');
    send.mockClear();
    await tapCard(wrapper, 1);
    expect(send).not.toHaveBeenCalled();
    await holdCard(wrapper, 1);
    await chooseMark(wrapper, 0);
    expect(send).toHaveBeenLastCalledWith('keywords:mark', { gameId: 'g1', card: 1, mark: 'ours' });
  });

  test('tells assistive technology of the keys that mark a card, and offers buttons that mark the focused one', async () => {
    const wrapper = mount(KeywordsGame, {
      props: {
        room: marked([], {
          team: 'blue',
          cards: [{ word: 'Done', revealed: true, color: 'red' }, ...cards('Model', 'Journal')],
        }),
      },
      global: global(),
    });
    // The first card is revealed: it takes no mark, and so says nothing of the keys.
    expect(card(wrapper, 0)?.attributes('aria-keyshortcuts')).toBeUndefined();
    expect(card(wrapper, 0)?.attributes('aria-describedby')).toBeUndefined();
    const keys = card(wrapper, 1)?.attributes('aria-describedby');
    expect(card(wrapper, 1)?.attributes('aria-keyshortcuts')).toBe('1 2 3');
    expect(wrapper.get(`[id="${keys}"]`).text()).toBe(
      'Key 1 marks it as ours, 2 as theirs, 3 as maybe Reviewer 2; the same key again clears the mark.',
    );
    // No card has had the focus: no buttons yet. Once one has, the buttons mark it, for a screen
    // reader on a phone, which can neither tap a card several times nor press a key.
    expect(wrapper.find('.mark-buttons').exists()).toBe(false);
    await card(wrapper, 1)?.trigger('focus');
    const buttons = wrapper.get('.mark-buttons');
    expect(buttons.classes()).toContain('sr-only');
    expect(buttons.findAll('button').map((button) => button.text())).toEqual([
      'Mark Model as ours',
      'Mark Model as theirs',
      'Mark Model as maybe Reviewer 2',
    ]);
    send.mockClear();
    await buttons.findAll('button')[1]?.trigger('click');
    expect(send).toHaveBeenLastCalledWith('keywords:mark', { gameId: 'g1', card: 1, mark: 'theirs' });
    // A revealed card gets none.
    await card(wrapper, 0)?.trigger('focus');
    expect(wrapper.find('.mark-buttons').exists()).toBe(false);
  });

  test("shows a PI the group's marks on the corner where the students see them, which a PI can't change", async () => {
    const wrapper = mount(KeywordsGame, {
      props: { room: marked([{ card: 0, mark: 'ours' }], {}, 'ann') },
      global: global(),
    });
    const sticker = card(wrapper, 0)?.find('.note');
    expect(sticker?.exists()).toBe(true);
    expect(sticker?.classes()).not.toContain('small');
    expect(card(wrapper, 0)?.classes()).not.toContain('noted');
    expect(card(wrapper, 0)?.attributes('aria-label')).toContain('marked as ours');
    send.mockClear();
    await card(wrapper, 0)?.trigger('keydown', { key: '2' });
    await holdCard(wrapper, 0);
    expect(wrapper.find('.mark-menu').exists()).toBe(false);
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
    const record: ClueRecord = { turn: 2, team: 'red', at: 0, word: 'Science', count: 2, guesses: [] };
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
    const record: ClueRecord = { turn: 2, team: 'red', at: 0, word: 'Theory', count: 2, guesses: [] };
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
    const mine: ClueRecord = { turn: 2, team: 'red', at: 0, word: 'Theory', count: 1, guesses: [] };
    const theirs: ClueRecord = { turn: 3, team: 'blue', at: 0, word: 'Method', count: 1, guesses: [] };
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
    const timedOut: ClueRecord = { turn: 2, team: 'red', at: 0, word: null, count: null, guesses: [], timedOut: true };
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
      at: 0,
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
      history: [
        ...shown.history,
        late(6, 'ann'),
        { turn: 7, team: 'red', at: 0, word: 'Later', count: 1, guesses: [] },
      ],
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

  test('calls out a deadline hero the moment the card that makes them one is revealed, counted for an account', async () => {
    bubbles.splice(0);
    const view = room('bob');
    const data = view.data as KeywordsRoomData;
    const hero = (player: string, count?: number) => ({
      turn: 2,
      kind: 'hero' as const,
      team: 'red' as const,
      player,
      ...(count === undefined ? {} : { count }),
    });
    const calls = () => bubbles.map((bubble) => ('call' in bubble ? [bubble.name, bubble.call] : null));
    const { t } = i18n().global;
    const line = (player: string, name: string) => t(`game.hero.lines.${heroLine('g1', 2, player)}`, { name });
    let shown = data.game as KeywordsView;
    const show = async (changes: Partial<KeywordsView>) => {
      shown = { ...shown, ...changes };
      await wrapper.setProps({ room: { ...view, data: { ...data, game: shown } } });
    };
    // Bob reveals a card of red's: his first in the last seconds, which makes him a hero, and the
    // first of Ann's last-second clue, which makes her one, her third time.
    const turned = (...indexes: number[]) => ({
      cards: shown.cards.map((card, index) =>
        indexes.includes(index) ? { ...card, revealed: true, color: 'red' as const } : card,
      ),
      history: [
        {
          ...(shown.history[0] as ClueRecord),
          guesses: indexes.map((card) => ({
            card,
            color: 'red' as const,
            player: 'bob',
            at: 0,
            lastSeconds: true as const,
          })),
        },
      ],
    });
    const wrapper = mount(KeywordsGame, {
      props: { room: { ...view, data: { ...data, game: shown } } },
      global: global(),
    });
    // Bob's first time has no count.
    await show({ ...turned(0), events: [hero('bob', 1), hero('ann', 3)] });
    expect(calls()).toEqual([
      ['Bob', line('bob', 'Bob')],
      ['Ann', `${line('ann', 'Ann')} (\u00d73)`],
    ]);
    bubbles.splice(0);
    // A snapshot that catches the page up with several cards at once says nothing.
    await show({ ...turned(0, 1, 2), events: [...shown.events, hero('cat')] });
    expect(bubbles).toEqual([]);
    expect(wrapper.find('.clue-log .event').exists()).toBe(false);
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

  test("opens a match's progress from a button beside the chat, the groups and the clue log", async () => {
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
    const game = (me: string) =>
      mount(KeywordsGame, { props: { room: { ...view, me, match } }, global: global(), attachTo: document.body });
    // On a phone, the fourth of the buttons under the board opens the table in a sheet.
    const bob = game('bob');
    const button = bob.get('.panels .open-match');
    expect(button.text()).toBe('Match');
    expect(document.querySelector('[role=dialog]')).toBeNull();
    await button.trigger('click');
    await flushPromises();
    const sheet = document.querySelector<HTMLElement>('[role=dialog]');
    expect(sheet?.textContent).toContain('Match progress');
    expect(sheet?.querySelector('.match-table')?.textContent).toContain('Game 2 of 3');
    // The table under the board is gone.
    expect(bob.find('.match-fold').exists()).toBe(false);
    // The sheet closes as the game ends, when the table comes under the letters.
    const data = view.data as KeywordsRoomData;
    const over = {
      ...(data.game as KeywordsView),
      phase: 'over' as const,
      result: { winner: 'red' as const, reason: 'found' as const },
    };
    await bob.setProps({ room: { ...view, me: 'bob', match, data: { ...data, game: over } } });
    await flushPromises();
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(bob.find('.match-table.between').exists()).toBe(true);
    bob.unmount();
    // The chair's button to end the match stands among the tools, in sight, not in the sheet.
    const chair = game('ann');
    expect(chair.get('.tools .end-match').text()).toBe('End the match');
    chair.unmount();
    expect(game('bob').find('.end-match').exists()).toBe(false);
    document.body.innerHTML = '';
  });

  test('lists the titles of a game under its letter once it is over, where no table lists them', () => {
    const view = room('bob');
    const data = view.data as KeywordsRoomData;
    const titles = { ann: [{ title: 'missed_deadline' as const, count: 2 }], bob: [] };
    const during = mount(KeywordsGame, { props: { room: { ...view, data: { ...data, titles } } }, global: global() });
    expect(during.find('.game-titles').exists()).toBe(false);
    const game = {
      ...(data.game as KeywordsView),
      phase: 'over' as const,
      result: { winner: 'red' as const, reason: 'found' as const },
    };
    const over = mount(KeywordsGame, {
      props: { room: { ...view, data: { ...data, game, titles } } },
      global: global(),
    });
    const lines = over.findAll('.game-titles li');
    expect(lines.map((line) => line.get('.title-name').text())).toEqual(['Ann']);
    expect(lines[0]?.findAll('.title-line > .pill').map((pill) => pill.text())).toEqual(['Forgot to Submit \u00d72']);
    // Between the games of a match, the table lists them; after its last game, the ranking stands
    // in the table's place, and the titles come under it.
    const standing = (playerId: string, rank: number): StandingView => ({
      playerId,
      name: playerId,
      total: 0,
      delta: 0,
      games: 1,
      rank,
      left: false,
    });
    const match: RoomView['match'] = {
      id: 'm1',
      rules: { games: 2, teams: 'fixed', grouping: 'choose' },
      played: 1,
      status: 'on',
      game: 1,
      standings: [standing('ann', 1), standing('bob', 2)],
    };
    const between = mount(KeywordsGame, {
      props: { room: { ...view, match, data: { ...data, game, titles } } },
      global: global(),
    });
    expect(between.find('.game-titles').exists()).toBe(false);
    expect(between.findAll('.match-table .title-line > .pill').map((pill) => pill.text())).toEqual([
      'Forgot to Submit \u00d72',
    ]);
    const last = mount(KeywordsGame, {
      props: {
        room: { ...view, match: { ...match, played: 2, status: 'over', game: 2 }, data: { ...data, game, titles } },
      },
      global: global(),
    });
    expect(last.find('.match-results').exists()).toBe(true);
    expect(last.findAll('.game-titles .title-name').map((name) => name.text())).toEqual(['Ann']);
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
        // A PI who missed the deadline twice.
        standing('Fay', {
          role: 'captain',
          found: 3,
          won: false,
          irrelevant: 1,
          wrong: 0,
          reviewer2: 0,
          bigClues: 0,
          openingRecord: false,
          heavenlyHand: false,
          missed: 2,
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
    expect(wrapper.findAll('.between .detail.below').map((detail) => detail.text())).toEqual([
      'PI \u00b7 found 9 \u00b7 won \u00b7 big clue +6 \u00b7 Opened the Scoring \u00b7 Heavenly Hand',
      "found 2 \u00b7 irrelevant paper \u00d71 \u00b7 other group's card \u00d71",
      'PI \u00b7 found 3 \u00b7 irrelevant paper \u00d71 \u00b7 missed deadline \u00d72',
      "found 2 \u00b7 won \u00b7 irrelevant paper \u00d71 \u00b7 other group's card \u00d71",
      'Reviewer 2',
      'found 1',
    ]);
    const scoring = wrapper.get('.between .scoring').text();
    expect(scoring).toContain('+3 for each student and +4 for the PI');
    expect(scoring).toContain('costs each student 1, 2 and 3, and the PI 2, 3 and 5');
    expect(scoring).toContain('Every turn in which the PI gives no clue in time costs the PI 5.');
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
    expect(student.findAll('.sticky-clock button').map((button) => button.text())).toEqual(['React']);
    expect(student.get('.strip .phase').text()).toBe('The game is paused.');
    // The clock stands still at what the server said.
    expect(student.get('[role="timer"]').attributes('aria-label')).toBe('42 seconds left');
    // The chair resumes, from the notice or from the end of the clock, which pauses the game
    // otherwise; the tools at the foot of the page have no way to pause.
    const chair = mount(KeywordsGame, { props: { room: paused('ann') }, global: global() });
    expect(chair.findAll('.tools button').map((button) => button.text())).toEqual(['How to play', 'End the game']);
    // With the clock, the chair's button to pause or resume comes first, then the reaction button,
    // which is at the end of the bar for everyone.
    expect(chair.find('.sticky-clock [role="timer"]').exists()).toBe(true);
    expect(chair.findAll('.sticky-clock button').map((button) => button.text())).toEqual(['Resume', 'React']);
    await chair.get('.paused button').trigger('click');
    expect(send).toHaveBeenLastCalledWith('keywords:resume', { gameId: 'g1' });
    send.mockClear();
    expect(chair.get('.sticky-clock .pause').text()).toBe('Resume');
    await chair.get('.sticky-clock .pause').trigger('click');
    expect(send).toHaveBeenLastCalledWith('keywords:resume', { gameId: 'g1' });
    const playing = mount(KeywordsGame, { props: { room: room('ann') }, global: global() });
    expect(playing.findAll('.tools button').map((button) => button.text())).not.toContain('Pause');
    expect(playing.get('.sticky-clock .pause').text()).toBe('Pause');
    expect(playing.findAll('.sticky-clock button').map((button) => button.text())).toEqual(['Pause', 'React']);
    await playing.get('.sticky-clock .pause').trigger('click');
    expect(send).toHaveBeenLastCalledWith('keywords:pause', { gameId: 'g1' });
  });

  // A game without a time limit has no clock: the chair's button to pause and the reaction button
  // stand at the top alone, and the others have the reaction button there.
  test('keeps the reaction button, and the chair the button to pause, at the top of a game without a clock', async () => {
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
    ).toEqual(['Pause', 'React']);
    await chair.get('.sticky-clock .pause').trigger('click');
    expect(send).toHaveBeenLastCalledWith('keywords:pause', { gameId: 'g1' });
    const student = mount(KeywordsGame, { props: { room: untimed('bob') }, global: global() });
    expect(student.findAll('.sticky-clock button').map((button) => button.text())).toEqual(['React']);
    // Once the game is over, the reaction button stays there, alone.
    const over = { ...game, phase: 'over' as const, result: { winner: 'red' as const, reason: 'found' as const } };
    await chair.setProps({
      room: { ...untimed('ann'), data: { ...data, side: 'red', game: { ...over, clock: { left: 0, total: 90_000 } } } },
    });
    expect(
      chair
        .get('.sticky-clock')
        .findAll('button')
        .map((button) => button.text()),
    ).toEqual(['React']);
    expect(chair.find('.sticky-clock [role="timer"]').exists()).toBe(false);
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
        {
          turn: 2,
          team: 'red',
          at: 0,
          word: 'Science',
          count: 2,
          guesses: [{ card: 0, color: 'red', player: 'bob', at: 0 }],
        },
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
    // Bob isn't the chair: there is no button to pause beside his clock, only his reaction button,
    // where the banner that stood above the strip had it.
    expect(bar.findAll('button').map((button) => button.text())).toEqual(['React']);
    expect(wrapper.find('.role-banner').exists()).toBe(false);
    expect(bar.classes()).not.toContain('below-banner');
    page.connection.connected = false;
    await flushPromises();
    expect(bar.classes()).toContain('below-banner');
    page.connection.connected = true;
  });
});
