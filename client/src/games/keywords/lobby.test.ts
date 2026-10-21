// @vitest-environment happy-dom
import { type RoomView } from '@reviewer2/shared';
import { defaultSettings, type KeywordsRoomData } from '@reviewer2/shared/keywords';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';
import { account } from '../../core/account';
import { fields } from '../../core/fields';
import { knowAliases } from '../../core/names';
import en from '../../locales/en.json';
import KeywordsLobby from './KeywordsLobby.vue';

const send = vi.hoisted(() =>
  vi.fn<(event: string, payload?: object) => Promise<{ ok: boolean; fields?: []; friends?: [] }>>(),
);
// The page is connected already.
const page = vi.hoisted(() => ({ connection: { connected: true, everConnected: true } }));
vi.mock('../../core/socket', async () => {
  const { computed, reactive } = await import('vue');
  page.connection = reactive(page.connection);
  return {
    send,
    act: (event: string, payload: object = {}) => send(event, payload),
    onceConnected: (run: () => void) => {
      run();
      return () => {};
    },
    socket: { connected: true, on: vi.fn(), once: vi.fn() },
    connection: page.connection,
    reconnecting: computed(() => page.connection.everConnected && !page.connection.connected),
  };
});

// The way to log in, which the tag offers a guest, is a link of the page's router. The sheets are
// teleported to the body; rendering them in place keeps them inside the wrapper.
const router = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { render: () => null } }],
  });
const global = () => ({
  plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } }), router()],
  stubs: { teleport: true },
});

const data: KeywordsRoomData = {
  settings: defaultSettings('en'),
  seats: {},
  keyViewers: [],
  side: null,
  startProblems: [],
  lineup: 'free',
  joinsNext: false,
  mayEmote: true,
  titles: {},
  game: null,
};

const view = (me: string, screens: number, settings = data.settings): RoomView => ({
  roomId: 'room-1',
  code: 'K7QX',
  rev: 1,
  game: 'keywords',
  language: 'en',
  fields: ['general'],
  randomFields: false,
  public: false,
  customWordCount: 0,
  phase: 'lobby',
  round: 2,
  gameId: null,
  chairId: 'ann',
  players: [
    { id: 'ann', name: 'Ann', online: true },
    { id: 'bob', name: 'Bob', online: true },
  ],
  agents: false,
  screens,
  me,
  match: null,
  streaks: [],
  duos: [],
  agentsPlayed: false,
  points: [],
  data: { ...data, settings },
});

// A room whose chair may invite AI players, with one as the red group's student and Bob as a blue
// student, unless `seats` says otherwise.
const withAgents = (
  me: string,
  seats: KeywordsRoomData['seats'] = { ai: { team: 'red', role: 'guesser' }, bob: { team: 'blue', role: 'guesser' } },
  settings = data.settings,
): RoomView => {
  const room = view(me, 0, settings);
  return {
    ...room,
    agents: true,
    players: [...room.players, { id: 'ai', name: 'Reviewer 1', online: true, agent: 'reviewer1' }],
    data: { ...data, settings, seats },
  };
};

describe('KeywordsLobby', () => {
  // The banner that stood at the top of the waiting room is gone: the reaction button goes into the
  // room's masthead, left of the room menu (RoomPage.vue).
  test('puts the reaction button in the masthead, and has no banner', () => {
    const lobby = mount(KeywordsLobby, { props: { room: withAgents('bob') }, global: global() });
    expect(lobby.find('.role-banner').exists()).toBe(false);
    const teleport = lobby.get('teleport-stub');
    expect(teleport.attributes('to')).toBe('#room-actions');
    expect(teleport.find('.emote-button').exists()).toBe(true);
  });

  beforeEach(() => {
    send.mockReset();
    send.mockImplementation(async (event) => (event === 'meta:fields' ? { ok: true, fields: [] } : { ok: true }));
  });

  test('lets a chair who may have them invite AI players to the seats left, and says what they need', async () => {
    const chair = mount(KeywordsLobby, { props: { room: withAgents('ann') }, global: global() });
    const invites = chair.findAll('button').filter((button) => button.text() === 'Invite Reviewer 1');
    // Both PIs' seats, and the blue students: the red group has its AI student.
    expect(invites).toHaveLength(3);
    // Each invitation is one button, a chip with Reviewer 1's avatar as a sticker that presses, a
    // plus on it, and the words, with the name in one piece (InviteAgent.vue).
    const chip = invites[0];
    expect(chip?.classes()).toEqual(expect.arrayContaining(['invite-agent', 'press-host']));
    expect(chip?.get('.face').classes()).toContain('press-part');
    expect(chip?.find('.face .avatar svg').exists()).toBe(true);
    expect(chip?.find('.face .plus').exists()).toBe(true);
    expect(chip?.get('.words .name').text()).toBe('Reviewer 1');
    // Under a vacant PI's seat, the invitation follows the seat's line; among the students, it
    // follows the names and comes before the button to join them. The names take two lines.
    const red = chair.get('.group.red');
    expect(red.get('dd.seat-line').element.children[0]?.className).toBe('vacant-line');
    expect(red.get('dd.seat-line').element.children[1]?.className).toContain('invite-agent');
    const blueStudents = chair.get('.group.blue').findAll('dd')[1];
    expect([...(blueStudents?.element.children ?? [])].map((child) => child.className.split(' ')[0])).toEqual([
      'names',
      'invite-agent',
      'button',
    ]);
    expect(chair.findAll('.group .player').every((player) => player.classes().includes('stacked'))).toBe(true);
    await invites[0]?.trigger('click');
    expect(send).toHaveBeenCalledWith('room:addAgent', {
      persona: 'reviewer1',
      seat: { team: 'red', role: 'captain' },
    });
    await invites[2]?.trigger('click');
    expect(send).toHaveBeenCalledWith('room:addAgent', {
      persona: 'reviewer1',
      seat: { team: 'blue', role: 'guesser' },
    });
    // The AI student is marked as one.
    expect(chair.get('.group.red').text()).toContain('Reviewer 1AI');
    // With every time limit on, nothing says that they are needed; with one off, the groups do.
    expect(chair.text()).not.toContain('needs time limits');
    const untimed = withAgents('ann', undefined, { ...data.settings, guessTime: 0 });
    const reminded = mount(KeywordsLobby, { props: { room: untimed }, global: global() });
    expect(reminded.get('.groups').text()).toContain('A room with AI players needs time limits');

    // Nobody else invites them, but everyone reads what they mean for the game, and that an AI
    // plays for whoever is offline in their turn, which it does in this room with or without an AI
    // player in it.
    const player = mount(KeywordsLobby, { props: { room: withAgents('bob') }, global: global() });
    expect(player.findAll('button').filter((button) => button.text() === 'Invite Reviewer 1')).toHaveLength(0);
    expect(player.text()).toContain(
      'A game that an AI plays in brings nobody points, a streak, a title or a friend title.',
    );
    expect(player.text()).toContain('A player who is offline for 20 seconds in their turn is played for by an AI');
    const alone = mount(KeywordsLobby, { props: { room: { ...view('bob', 0), agents: true } }, global: global() });
    expect(alone.text()).toContain('A player who is offline for 20 seconds in their turn is played for by an AI');
    // With AI players in a room whose chair may no longer invite them, nobody is played for.
    const handed = mount(KeywordsLobby, { props: { room: { ...withAgents('bob'), agents: false } }, global: global() });
    expect(handed.text()).toContain('A game that an AI plays in brings nobody points');
    expect(handed.text()).not.toContain('is played for by an AI');
    // Nor a chair who may not.
    const barred = mount(KeywordsLobby, { props: { room: view('ann', 0) }, global: global() });
    expect(barred.text()).not.toContain('Invite Reviewer 1');
    expect(barred.text()).not.toContain('an AI');
  });

  test('offers to invite AI players only once a person sits in a group', () => {
    // The chair and Bob watch: the AI student alone is seated.
    const nobody = mount(KeywordsLobby, {
      props: { room: withAgents('ann', { ai: { team: 'red', role: 'guesser' } }) },
      global: global(),
    });
    expect(nobody.findAll('button').filter((button) => button.text() === 'Invite Reviewer 1')).toHaveLength(0);
    // Everyone still reads what the AI student means for the game.
    expect(nobody.text()).toContain('A game that an AI plays in brings nobody points');
    const seated = mount(KeywordsLobby, {
      props: {
        room: withAgents('ann', { ai: { team: 'red', role: 'guesser' }, ann: { team: 'blue', role: 'captain' } }),
      },
      global: global(),
    });
    expect(seated.findAll('button').filter((button) => button.text() === 'Invite Reviewer 1')).toHaveLength(2);
  });

  test('says what AI players still need before the game can start', () => {
    const room = withAgents('ann');
    const blocked = {
      ...room,
      data: {
        ...data,
        seats: { ai: { team: 'red', role: 'guesser' } },
        startProblems: [{ problem: 'needs_timers' as const }, { problem: 'needs_human' as const }],
      },
    };
    const chair = mount(KeywordsLobby, { props: { room: blocked }, global: global() });
    expect(chair.get('.readiness').text()).toBe(
      'A room with AI players needs time limits for the clues and the guesses.',
    );
    expect(chair.get('.desk .problems').text()).toContain(
      'At least one person must sit in a group with the AI players.',
    );
  });

  test('tells everyone how many screens show the room, and lets the chair send them away', async () => {
    const chair = mount(KeywordsLobby, { props: { room: view('ann', 2) }, global: global() });
    expect(chair.find('.screens').text()).toContain('Big screens showing this room: 2.');
    await chair.find('.screens button').trigger('click');
    expect(send).toHaveBeenCalledWith('room:dismiss', {});

    const player = mount(KeywordsLobby, { props: { room: view('bob', 2) }, global: global() });
    expect(player.find('.screens').text()).toContain('2');
    expect(player.find('.screens button').exists()).toBe(false);

    const none = mount(KeywordsLobby, { props: { room: view('ann', 0) }, global: global() });
    expect(none.find('.screens').exists()).toBe(false);
  });

  test('shows everyone but the chair the settings, and lets the chair change them with the word lists', async () => {
    const player = mount(KeywordsLobby, { props: { room: view('bob', 0) }, global: global() });
    expect(player.find('.settings-form').exists()).toBe(false);
    expect(player.get('.settings-summary').text()).toContain('Free');

    const chair = mount(KeywordsLobby, { props: { room: view('ann', 0) }, global: global() });
    await flushPromises();
    expect(chair.find('.settings-summary').exists()).toBe(false);
    expect(chair.find('.save').exists()).toBe(false);
    await chair.find('.settings-form input[value="loose"]').setValue(true);
    // Another player's snapshot leaves the chair's unsaved choice alone.
    await chair.setProps({ room: { ...view('ann', 1) } });
    await chair.get('.save button').trigger('click');
    // The words didn't change, so they don't go along.
    expect(send).toHaveBeenCalledWith('room:settings', {
      fields: ['general'],
      randomFields: false,
      settings: { ...defaultSettings('en'), clueRule: 'loose' },
    });
    // Once the room has the settings, there is nothing left to save.
    await chair.setProps({ room: view('ann', 1, { ...defaultSettings('en'), clueRule: 'loose' }) });
    expect(chair.find('.save').exists()).toBe(false);
  });

  test('keeps the save and the start buttons off while a setting is wrong, and says so in the start bar', async () => {
    const chair = mount(KeywordsLobby, { props: { room: view('ann', 0) }, global: global() });
    await flushPromises();
    const field = chair.findAll('.settings-form input[inputmode="numeric"]')[1];
    const was = (field?.element as HTMLInputElement).value;
    await field?.setValue('5');
    expect(chair.get('.save button').attributes('disabled')).toBeDefined();
    expect(chair.get('.start-bar .primary').attributes('disabled')).toBeDefined();
    // The bar's line says why the game can't start, since the field may be scrolled out of sight
    // under it; the desk marks the field itself.
    const line = chair.get('.start-bar .readiness');
    expect(line.text()).toBe("What was changed at the desk can't be saved yet.");
    expect(line.classes()).not.toContain('ready');
    await field?.setValue(was);
    expect(line.text()).toBe('Everyone needed is seated.');
    expect(line.classes()).toContain('ready');
    expect(chair.get('.start-bar .primary').attributes('disabled')).toBeUndefined();
  });

  test('starts the game with the number of games the room has started', async () => {
    const chair = mount(KeywordsLobby, { props: { room: view('ann', 0) }, global: global() });
    await flushPromises();
    await chair.find('.start-bar .primary').trigger('click');
    expect(send).toHaveBeenCalledWith('room:start', { round: 2 });
    expect(send).not.toHaveBeenCalledWith('room:settings', expect.anything());
  });

  test('saves what the chair has changed at the desk before starting the game', async () => {
    const chair = mount(KeywordsLobby, { props: { room: view('ann', 0) }, global: global() });
    await flushPromises();
    await chair.find('.settings-form input[value="standard"]').setValue(true);
    expect(chair.get('.save .hint').text()).toBe('Starting the game saves these as well.');
    await chair.find('.start-bar .primary').trigger('click');
    await flushPromises();
    expect(send.mock.calls.filter(([event]) => event !== 'meta:fields')).toEqual([
      [
        'room:settings',
        { fields: ['general'], randomFields: false, settings: { ...defaultSettings('en'), guessRule: 'standard' } },
      ],
      ['room:start', { round: 2 }],
    ]);
  });

  test('lets the chair paste words of their own, counted for the players, and checked as typed', async () => {
    const chair = mount(KeywordsLobby, { props: { room: view('ann', 0) }, global: global() });
    await flushPromises();
    const words = chair.get('textarea');
    await words.setValue('Alpha, Beta\nalpha\nFourteenletters');
    expect(chair.get('.problem').text()).toBe('Too long for a card: Fourteenletters');
    expect(chair.get('.save button').attributes('disabled')).toBeDefined();
    await words.setValue('Alpha, Beta\nalpha');
    expect(chair.find('.problem').exists()).toBe(false);
    expect(chair.text()).toContain('2 words');
    await chair.get('.save button').trigger('click');
    expect(send).toHaveBeenCalledWith('room:settings', {
      fields: ['general'],
      randomFields: false,
      settings: defaultSettings('en'),
      words: 'Alpha, Beta\nalpha',
    });
    // The server sends the words back, one per line, and then there is nothing left to save.
    await chair.setProps({ room: { ...view('ann', 0), customWordCount: 2, customWords: ['Alpha', 'Beta'] } });
    expect((chair.get('textarea').element as HTMLTextAreaElement).value).toBe('Alpha\nBeta');
    expect(chair.find('.save').exists()).toBe(false);
    // The players hear how many there are.
    const player = mount(KeywordsLobby, {
      props: { room: { ...view('bob', 0), customWordCount: 2 } },
      global: global(),
    });
    expect(player.get('.settings-summary').text()).toContain('2 words');
    expect(player.text()).not.toContain('Alpha');
  });

  test('lets the chair have every game draw its word lists anew, which needs none chosen', async () => {
    fields.value = [{ id: 'general', name: { zh: 'G', en: 'General' }, counts: { zh: 300, en: 300 } }];
    const chair = mount(KeywordsLobby, { props: { room: view('ann', 0) }, global: global() });
    await flushPromises();
    await chair.get('.field-fold .each input').setValue(true);
    expect(chair.get('.field-fold .summary').text()).toBe('Random lists each game');
    expect(chair.get<HTMLInputElement>('.fields input').element.disabled).toBe(true);
    await chair.get('.save button').trigger('click');
    expect(send).toHaveBeenCalledWith('room:settings', {
      fields: ['general'],
      randomFields: true,
      settings: defaultSettings('en'),
    });
    // Once the room draws its lists, there is nothing left to save.
    await chair.setProps({ room: { ...view('ann', 0), randomFields: true } });
    expect(chair.find('.save').exists()).toBe(false);
    expect(chair.get<HTMLInputElement>('.field-fold .each input').element.checked).toBe(true);
  });

  test('needs a word list unless the chair has 25 words of their own', async () => {
    fields.value = [{ id: 'general', name: { zh: '通用', en: 'General' }, counts: { zh: 300, en: 300 } }];
    const chair = mount(KeywordsLobby, { props: { room: view('ann', 0) }, global: global() });
    await flushPromises();
    await chair.get('.fields input[type="checkbox"]').setValue(false);
    const words = (count: number) => Array.from({ length: count }, (_, i) => `Word${i}`).join('\n');
    await chair.get('textarea').setValue(words(24));
    expect(chair.get('.save button').attributes('disabled')).toBeDefined();
    await chair.get('textarea').setValue(words(25));
    expect(chair.get('.save button').attributes('disabled')).toBeUndefined();
    await chair.get('.save button').trigger('click');
    expect(send).toHaveBeenCalledWith('room:settings', {
      fields: [],
      randomFields: false,
      settings: defaultSettings('en'),
      words: words(25),
    });
  });

  test('takes no words in a public room, and drops what was typed and not saved when the room is listed', async () => {
    const chair = mount(KeywordsLobby, { props: { room: view('ann', 0) }, global: global() });
    await flushPromises();
    await chair.get('textarea').setValue('Alpha\nBeta');
    expect(chair.find('.save').exists()).toBe(true);
    await chair.setProps({ room: { ...view('ann', 0), public: true } });
    expect(chair.find('textarea').exists()).toBe(false);
    expect(chair.text()).toContain('Custom words are for private rooms');
    // Nothing is left to save, and the game starts without a word of the chair's own.
    expect(chair.find('.save').exists()).toBe(false);
    await chair.find('.start-bar .primary').trigger('click');
    await flushPromises();
    expect(send.mock.calls.filter(([event]) => event !== 'meta:fields')).toEqual([['room:start', { round: 2 }]]);
  });

  test("doesn't start the game when the server refuses what the chair changed", async () => {
    send.mockImplementation(async (event) => (event === 'room:settings' ? { ok: false } : { ok: true, fields: [] }));
    const chair = mount(KeywordsLobby, { props: { room: view('ann', 0) }, global: global() });
    await flushPromises();
    await chair.find('.settings-form input[value="standard"]').setValue(true);
    await chair.find('.start-bar .primary').trigger('click');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('room:settings', expect.anything());
    expect(send).not.toHaveBeenCalledWith('room:start', expect.anything());
  });

  // The start bar stands above the groups and the desk, for the chair alone: one line for what is
  // still missing, which the desk lists in full, and the one start button of the page.
  test('gives the chair a start bar above it all, which says what is missing', async () => {
    const missing = {
      ...data,
      startProblems: [
        { problem: 'needs_captain', team: 'red' },
        { problem: 'needs_guesser', team: 'blue' },
      ],
    };
    const waiting = { ...view('ann', 0), data: missing } as RoomView;
    const chair = mount(KeywordsLobby, { props: { room: waiting }, global: global() });
    await flushPromises();
    const bar = chair.get('.start-bar');
    expect(bar.get('.readiness').text()).toBe('The Red group needs a PI.');
    expect(bar.get('.readiness').classes()).not.toContain('ready');
    expect(chair.get('.desk .problems').findAll('li')).toHaveLength(2);
    expect(bar.get('.primary').attributes('disabled')).toBeDefined();
    expect(bar.findAll('button').map((button) => button.text())).toEqual(['Shuffle groups', 'Start']);
    const starts = chair.findAll('button').filter((button) => button.text() === 'Start');
    expect(starts).toHaveLength(1);
    // Above the groups and the desk, in the page's order too.
    const html = chair.html();
    expect(html.indexOf('start-bar')).toBeLessThan(html.indexOf('class="groups"'));

    await chair.setProps({ room: view('ann', 0) });
    expect(bar.get('.readiness').text()).toBe('Everyone needed is seated.');
    expect(bar.get('.readiness').classes()).toContain('ready');
    expect(chair.find('.desk .problems').exists()).toBe(false);
    expect(bar.get('.primary').attributes('disabled')).toBeUndefined();

    const player = mount(KeywordsLobby, { props: { room: view('bob', 0) }, global: global() });
    expect(player.find('.start-bar').exists()).toBe(false);
    expect(player.findAll('button').filter((button) => button.text() === 'Start')).toHaveLength(0);
  });

  test('keeps the start bar under the banner while the page reconnects', async () => {
    const chair = mount(KeywordsLobby, { props: { room: view('ann', 0) }, global: global() });
    expect(chair.get('.start-dock').classes()).not.toContain('below-banner');
    page.connection.connected = false;
    await flushPromises();
    expect(chair.get('.start-dock').classes()).toContain('below-banner');
    page.connection.connected = true;
  });
});

// The tag beside the heading says whether the room is public, and the chair switches it there.
describe('KeywordsLobby, public or private', () => {
  beforeEach(() => {
    send.mockReset();
    send.mockImplementation(async (event) =>
      event === 'meta:fields'
        ? { ok: true, fields: [] }
        : event === 'friends:list'
          ? { ok: true, friends: [] }
          : { ok: true },
    );
  });
  afterEach(() => {
    account.summary = null;
  });

  test('lets a chair with an account switch the room from the tag beside the heading', async () => {
    account.summary = { username: 'Ann', avatar: null } as unknown as typeof account.summary;
    const chair = mount(KeywordsLobby, { props: { room: view('ann', 0) }, global: global() });
    const tag = chair.get('.lobby-head button.visibility');
    expect(tag.get('.tag').text()).toBe('Private');
    // The white tag is a sticker that lifts and presses in its larger button (base.css).
    expect(tag.classes()).toContain('press-host');
    expect(tag.get('.tag').classes()).toContain('press-part');
    expect(tag.text()).toContain('Make the room public');
    await tag.trigger('click');
    expect(send).toHaveBeenLastCalledWith('room:public', { public: true });
    await chair.setProps({ room: { ...view('ann', 0), public: true } });
    expect(tag.get('.tag').text()).toBe('Public');
    expect(tag.get('.tag').classes()).toContain('listed');
    // Ink, it is flat, and doesn't move.
    expect(tag.get('.tag').classes()).not.toContain('press-part');
    expect(tag.text()).toContain('Make the room private');
    await tag.trigger('click');
    expect(send).toHaveBeenLastCalledWith('room:public', { public: false });
  });

  test('shows the others the tag of a public room alone, with nothing to tap', async () => {
    const player = mount(KeywordsLobby, { props: { room: view('bob', 0) }, global: global() });
    expect(player.find('.lobby-head .public').exists()).toBe(false);
    expect(player.find('.lobby-head .visibility').exists()).toBe(false);
    await player.setProps({ room: { ...view('bob', 0), public: true } });
    expect(player.get('.lobby-head .public').text()).toBe('Public');
    expect(player.find('.lobby-head button.visibility').exists()).toBe(false);
  });

  test('tells a chair without an account that listing the room takes one, with the way to log in', async () => {
    const chair = mount(KeywordsLobby, { props: { room: view('ann', 0) }, global: global() });
    await flushPromises();
    await chair.get('.lobby-head button.visibility').trigger('click');
    expect(send).not.toHaveBeenCalledWith('room:public', expect.anything());
    const sheet = chair.get('.needs-account');
    expect(sheet.text()).toContain('Log in or register to make the room public.');
    const link = sheet.get('a.button');
    expect(link.text()).toBe('Log in or register');
    expect(decodeURIComponent(link.attributes('href') ?? '')).toBe('/account?next=/room/K7QX');
  });

  // The share row offers a player with an account their friends first, as the room menu does, and
  // the big screen as a button among the others.
  test('offers an account the invitation of friends in the start bar, the chair and the others alike', async () => {
    const bar = (wrapper: ReturnType<typeof mount>) =>
      wrapper.findAll('.start-dock .start-actions .button').map((button) => button.text());
    // A guest who doesn't chair has no bar, and the share row no invitation.
    const guest = mount(KeywordsLobby, { props: { room: view('bob', 0) }, global: global() });
    expect(guest.find('.start-dock').exists()).toBe(false);
    expect(guest.find('.share .invite-friends').exists()).toBe(false);
    const screen = guest.get('.share a.screen');
    expect(screen.classes()).toContain('button');
    expect(screen.attributes('href')).toBe('/room/K7QX/screen');
    expect(screen.attributes('target')).toBe('_blank');
    // A guest who chairs: the shuffle and the start, half the row each.
    expect(bar(mount(KeywordsLobby, { props: { room: view('ann', 0) }, global: global() }))).toEqual([
      'Shuffle groups',
      'Start',
    ]);

    account.summary = { username: 'Bob', avatar: null } as unknown as typeof account.summary;
    const member = mount(KeywordsLobby, { props: { room: view('bob', 0) }, global: global() });
    expect(member.get('.start-bar').classes()).toContain('member');
    expect(member.get('.start-bar .readiness').text()).toBe('Everyone needed is seated.');
    expect(bar(member)).toEqual(['Invite friends']);
    expect(member.find('.share .invite-friends').exists()).toBe(false);
    await member.get('.start-dock .invite-friends').trigger('click');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('friends:list');
    expect(member.get('.invite').text()).toContain('Friends who are online come first.');
    // The chair with an account: the invitation between the shuffle and the start.
    const chair = mount(KeywordsLobby, { props: { room: view('ann', 0) }, global: global() });
    expect(chair.get('.start-bar').classes()).not.toContain('member');
    expect(bar(chair)).toEqual(['Shuffle groups', 'Invite friends', 'Start']);
    expect(chair.find('.invited-friends').exists()).toBe(false);
  });

  test('shows whom the viewer invited beside the line, waited for, and a friend who came in for a moment', async () => {
    vi.useFakeTimers();
    try {
      account.summary = { username: 'Ann', avatar: null } as unknown as typeof account.summary;
      // The viewer gives Gus a name of their own (names.ts).
      knowAliases([{ handle: '6u5000000000', alias: 'Gustav' }]);
      const invited = [
        { handle: 'fa9000000000', username: 'Fay', avatar: null },
        { handle: '6u5000000000', username: 'Gus', avatar: null },
      ];
      const lobby = mount(KeywordsLobby, { props: { room: { ...view('ann', 0), invited } }, global: global() });
      const faces = () =>
        lobby
          .findAll('.invited-friends .face')
          .map((face) => [
            face.get('.avatar .initial').attributes('data-initial'),
            face.find('.wait').exists() ? 'waiting' : face.classes('came') ? 'came' : '?',
          ]);
      expect(faces()).toEqual([
        ['F', 'waiting'],
        ['G', 'waiting'],
      ]);
      expect(lobby.get('.invited-friends').attributes('aria-label')).toBe('Invited: Fay and Gustav');
      // Fay comes in: she shows as there for a moment, and goes, though the room calls her by the
      // viewer's name for her (room.ts). Gus ignores his: he goes at once.
      const room = view('ann', 0);
      const fay = { id: 'fay', name: 'Fay the Great', username: 'Fay', handle: 'fa9000000000', online: true };
      await lobby.setProps({ room: { ...room, players: [...room.players, fay], invited: [invited[1]!] } });
      expect(faces()).toEqual([
        ['F', 'came'],
        ['G', 'waiting'],
      ]);
      await lobby.setProps({ room: { ...room, players: [...room.players, fay], invited: [] } });
      expect(faces()).toEqual([['F', 'came']]);
      // With nobody waited for, the button says what a tap does.
      expect(lobby.get('.invited-friends').attributes('aria-label')).toBe('Invite friends');
      vi.advanceTimersByTime(2000);
      await flushPromises();
      expect(lobby.find('.invited-friends').exists()).toBe(false);
      // A click opens the sheet to invite friends.
      await lobby.setProps({ room: { ...room, invited } });
      await lobby.get('.invited-friends').trigger('click');
      await flushPromises();
      expect(send).toHaveBeenCalledWith('friends:list');
    } finally {
      knowAliases([]);
      vi.useRealTimers();
    }
  });
});

describe('KeywordsLobby in a match', () => {
  const match = (played: number): RoomView['match'] => ({
    id: 'm1',
    rules: { games: 3, options: { teams: 'fixed', grouping: 'random' } },
    played,
    status: 'on',
    game: played + 1,
    standings: [],
  });
  const inMatch = (me: string, room: Partial<KeywordsRoomData>, played = 0): RoomView => ({
    ...view(me, 0),
    match: match(played),
    data: { ...data, ...room },
  });

  beforeEach(() => {
    send.mockReset();
    send.mockImplementation(async (event) => (event === 'meta:fields' ? { ok: true, fields: [] } : { ok: true }));
  });

  test('lists everyone who plays as one, when the groups are drawn as the game starts', async () => {
    const seats = { ann: { team: 'red', role: 'guesser' } } as const;
    const lobby = mount(KeywordsLobby, {
      props: {
        room: inMatch('bob', { lineup: 'draw', seats, startProblems: [{ problem: 'needs_players', missing: 3 }] }),
      },
      global: global(),
    });
    expect(lobby.find('.groups').exists()).toBe(false);
    expect(lobby.get('.pool').text()).toContain('Ann');
    expect(lobby.get('.pool').text()).toContain('drawn at random');
    expect(lobby.get('.match-table').text()).toContain('Game 1 of 3');
    expect(lobby.get('.waiting').text()).toContain('3 more');
    await lobby.get('.pool button').trigger('click');
    expect(send).toHaveBeenCalledWith('keywords:seat', { team: 'blue', role: 'guesser' });
  });

  test('offers the seats of their own group alone, when the groups are fixed', () => {
    const lobby = mount(KeywordsLobby, {
      props: {
        room: inMatch(
          'bob',
          {
            lineup: 'fixed',
            side: 'red',
            seats: {
              ann: { team: 'red', role: 'captain' },
              bob: { team: 'red', role: 'guesser' },
              cat: { team: 'blue', role: 'captain' },
              dan: { team: 'blue', role: 'guesser' },
            },
          },
          1,
        ),
      },
      global: global(),
    });
    const blue = lobby.findAll('.group')[1];
    expect(blue?.text()).not.toContain('Join as a student');
    // Also when the other group has too few players left to play.
    const seats = { ann: { team: 'red', role: 'captain' }, bob: { team: 'red', role: 'guesser' } } as const;
    const short = mount(KeywordsLobby, {
      props: { room: inMatch('bob', { lineup: 'fixed', side: 'red', seats }, 1) },
      global: global(),
    });
    expect(short.findAll('.group')[1]?.findAll('button')).toHaveLength(0);
    expect(lobby.text()).toContain('The groups stay the same for the whole match');
  });

  test('offers a newcomer the seats of the group with fewer players, when the groups are fixed', () => {
    // Eve hasn't played yet, and sits in blue, the smaller group: red is closed to her, and blue's
    // empty PI seat is hers to take.
    const seats = {
      ann: { team: 'red', role: 'captain' },
      bob: { team: 'red', role: 'guesser' },
      cat: { team: 'blue', role: 'guesser' },
      eve: { team: 'blue', role: 'guesser' },
    } as const;
    const uneven = mount(KeywordsLobby, {
      props: { room: inMatch('eve', { lineup: 'fixed', side: null, seats }, 1) },
      global: global(),
    });
    expect(uneven.findAll('.group')[0]?.findAll('button')).toHaveLength(0);
    expect(uneven.findAll('.group')[1]?.text()).toContain('Be the PI');
    // With as many in each group without her, she may join either.
    const even = mount(KeywordsLobby, {
      props: {
        room: inMatch(
          'eve',
          { lineup: 'fixed', side: null, seats: { ...seats, dan: { team: 'blue', role: 'guesser' } } },
          1,
        ),
      },
      global: global(),
    });
    expect(even.findAll('.group')[0]?.text()).toContain('Join as a student');
  });

  test('keeps the word lists and the settings as they are once a game has counted', async () => {
    const chair = mount(KeywordsLobby, { props: { room: inMatch('ann', { lineup: 'fixed' }, 1) }, global: global() });
    await flushPromises();
    expect(chair.find('.settings-form').exists()).toBe(false);
    expect(chair.find('.settings-summary').exists()).toBe(true);
    expect(chair.get('.desk').text()).toContain('stay as they are until the match is over');
    expect(chair.text()).not.toContain('Shuffle groups');
  });
});
