import type { BoardWord } from '@reviewer2/shared';
import { MAX_LINE_INPUT, type ImpostorRoomData, type ImpostorSettings } from '@reviewer2/shared/impostor';
import { describe, expect, it } from 'vitest';
import type { GameContext, Viewer } from '../../core/game';
import type { GameLogData, GameLogEntry } from '../../core/gameLog';
import { seededRng } from '../../core/random';
import { impostorGame as game } from './index';
import { LINES, SETTINGS } from './testing';
import type { ImpostorData } from './state';

// The module as a room drives it: the waiting room, the settings, the setter, what each viewer
// sees, and what the log keeps, from which a kept game counts again as it did at its end.

const WORDS: BoardWord[] = [
  { word: 'apple', term: { id: 'apple', field: 'fruit' } },
  { word: 'pear', term: { id: 'pear', field: 'fruit' } },
];

const PEOPLE = ['ann', 'bob', 'cat', 'dan', 'eve', 'fay'];

// A room of the game, with the people of `players` in it, in that order, Ann chairing it, and a log
// that keeps what the room's log would: each message as the module notes it, and the module's own
// entries of every change.
function table(
  options: {
    players?: string[];
    settings?: Partial<ImpostorSettings>;
    public?: boolean;
    accounts?: string[];
    agents?: string[];
    offline?: string[];
  } = {},
) {
  const players = options.players ?? PEOPLE;
  const clock = { now: 0 };
  const ctx: GameContext = {
    phase: 'lobby',
    language: 'en',
    rng: seededRng(3),
    chairId: players[0] ?? null,
    public: options.public ?? false,
    now: () => clock.now,
    keyOf: (id) => `key-${id}`,
    isOnline: (id) => !(options.offline ?? []).includes(id),
    agentOf: (id) => ((options.agents ?? []).includes(id) ? 'reviewer1' : null),
    playerIds: () => players,
    hasAccount: (id) => (options.accounts ?? []).includes(id),
    hasField: (field) => field === 'fruit',
    customAuthor: () => null,
    titleCount: () => null,
    awardsTitles: () => false,
  };
  let data = game.create('en');
  const configured = game.configure(data, ctx, { ...SETTINGS, ...options.settings });
  if (!configured.ok) throw new Error(configured.error);
  data = configured.data;
  for (const id of players) data = game.join(data, ctx, id, true);
  const entries: GameLogEntry[] = [];
  const room = {
    data,
    ctx,
    clock,
    entries,
    // A message from a player, as Room.act takes it, which throws on a refusal.
    send(id: string, type: string, payload: unknown): ImpostorData {
      const result = room.try(id, type, payload);
      if (!result.ok) throw new Error(`refused: ${result.error}`);
      return result.data;
    },
    try(id: string, type: string, payload: unknown) {
      const before = room.data;
      const result = game.handle(before, room.ctx, id, type, payload);
      if (!result.ok) return result;
      const note = game.logged?.(type, payload);
      if (note && before.game) {
        entries.push({
          t: clock.now,
          by: id,
          type,
          ...(note.data === undefined ? {} : { data: note.data }),
          ...(note.said === undefined ? {} : { said: note.said }),
        });
      }
      room.changed(before, result.data);
      return result;
    },
    changed(before: ImpostorData, after: ImpostorData) {
      for (const change of game.logChanges?.(before, after) ?? []) {
        entries.push({
          t: clock.now,
          by: null,
          type: change.type,
          ...(change.data === undefined ? {} : { data: change.data }),
        });
      }
      room.data = after;
    },
    start() {
      room.ctx = { ...room.ctx, phase: 'playing' };
      room.data = game.start(room.data, room.ctx, WORDS, 'g1');
      return room.data.game as NonNullable<ImpostorData['game']>;
    },
    tick(ms: number) {
      clock.now += ms;
      room.changed(room.data, game.tick(room.data, room.ctx));
    },
    leave(id: string, removed = false) {
      room.changed(room.data, game.leave(room.data, room.ctx, id, removed));
    },
    view(viewer: Viewer): ImpostorRoomData {
      return game.views(room.data, room.ctx)(viewer);
    },
    // Deals the roles by hand, one letter per player in the order of `players`, as testing.ts's
    // dealt() does: S a student, R a Reviewer 2 and P the PI, with numbers in that order too. The
    // AI players stay as the game began with them.
    deal(roles: string) {
      const current = room.data.game as NonNullable<ImpostorData['game']>;
      const named: Record<string, 'student' | 'reviewer2' | 'pi'> = { S: 'student', R: 'reviewer2', P: 'pi' };
      const dealtPlayers = players.slice(0, roles.length).map((id, index) => ({
        id,
        number: index + 1,
        role: named[roles[index] as string] as 'student' | 'reviewer2' | 'pi',
        agent: current.players.some((player) => player.id === id && player.agent),
        fate: 'alive' as const,
        out: null,
      }));
      room.data = { ...room.data, game: { ...current, players: dealtPlayers, speaker: players[0] as string } };
    },
    // The players with a role, by player ID, in the order of their numbers.
    who(role: string): string[] {
      return (room.data.game?.players ?? []).filter((player) => player.role === role).map((player) => player.id);
    },
    number(id: string): number {
      return room.data.game?.players.find((player) => player.id === id)?.number ?? 0;
    },
    at() {
      const current = room.data.game as NonNullable<ImpostorData['game']>;
      return { gameId: current.gameId, round: current.round };
    },
    // Everyone who is to describe does, in turn.
    describeAll() {
      for (let current = room.data.game; current?.speaker && !current.report; current = room.data.game) {
        if (current.phase !== 'describe' && current.phase !== 'tie') break;
        const text = LINES[current.lines.length % LINES.length] as string;
        room.send(current.speaker, 'impostor:describe', { ...room.at(), text });
      }
    },
    // Everyone still in the game votes for `target`, who votes for `own`.
    voteFor(target: string, own: string | null) {
      const current = room.data.game as NonNullable<ImpostorData['game']>;
      const ballots = current.ballots.length;
      for (const player of current.players.filter((one) => one.fate === 'alive')) {
        if ((room.data.game?.ballots.length ?? 0) > ballots) break;
        if (Object.hasOwn(room.data.game?.pending ?? {}, player.id)) continue;
        const number = player.id === target ? (own === null ? null : room.number(own)) : room.number(target);
        room.send(player.id, 'impostor:vote', { ...room.at(), number });
      }
    },
    log(): GameLogData {
      return {
        v: 2,
        game: 'impostor',
        gameId: 'g1',
        start: null,
        entries: [...entries, { t: clock.now, by: null, type: 'end' }],
      };
    },
  };
  return room;
}

describe('the waiting room', () => {
  it('seats whoever comes to play, up to twelve, and lets them watch instead', () => {
    const players = Array.from({ length: 13 }, (_, index) => `p${index}`);
    const room = table({ players });
    expect(room.data.seats).toEqual(players.slice(0, 12));
    expect(room.try('p12', 'impostor:seat', { play: true })).toEqual({ ok: false, error: 'table_full' });
    room.send('p3', 'impostor:seat', { play: false });
    expect(room.data.seats).not.toContain('p3');
    room.send('p12', 'impostor:seat', { play: true });
    expect(room.data.seats.at(-1)).toBe('p12');
    expect(room.try('p0', 'impostor:seat', { play: 'yes' })).toEqual({ ok: false, error: 'bad_request' });
  });

  it('keeps a place for twelve players besides the setter, who watches', () => {
    const players = Array.from({ length: 13 }, (_, index) => `p${index}`);
    const room = table({ players, settings: { setter: true }, accounts: ['p0'] });
    // The chair, who sets the words, keeps the place they took, and the thirteenth plays.
    expect(room.data.seats).toEqual(players);
    expect(game.join(room.data, room.ctx, 'p13', true).seats).toEqual(players);
    room.send('p3', 'impostor:seat', { play: false });
    room.send('p13', 'impostor:seat', { play: true });
    expect(room.try('p3', 'impostor:seat', { play: true })).toEqual({ ok: false, error: 'table_full' });
    expect(game.seatAgent?.(room.data, room.ctx, 'ai-1', null)).toEqual({ ok: false, error: 'table_full' });
    expect(game.players?.(room.data, room.ctx)).toEqual([...players.slice(1, 3), ...players.slice(4), 'p13']);
  });

  it('takes the settings whole, and the god view and the setter in a private room alone', () => {
    const room = table();
    expect(game.configure(room.data, room.ctx, { ...SETTINGS, length: 0 })).toEqual({
      ok: false,
      error: 'bad_settings',
    });
    expect(game.configure(room.data, room.ctx, { describeTime: 60 })).toEqual({ ok: false, error: 'bad_settings' });
    const shown = { ...room.ctx, public: true };
    expect(game.configure(room.data, shown, { ...SETTINGS, godView: true })).toEqual({
      ok: false,
      error: 'private_only',
    });
    expect(game.configure(room.data, shown, { ...SETTINGS, setter: true })).toEqual({
      ok: false,
      error: 'private_only',
    });
    const setter = game.configure(room.data, room.ctx, { ...SETTINGS, setter: true });
    expect(setter.ok && game.mayBePublic?.(setter.data)).toBe(false);
    expect(game.mayBePublic?.(room.data)).toBe(true);
  });

  it('says what keeps a game from starting', () => {
    const problems = (room: ReturnType<typeof table>) => room.view({ playerId: 'ann' }).startProblems;
    expect(problems(table({ players: ['ann', 'bob', 'cat'] }))).toEqual([{ problem: 'needs_players', count: 1 }]);
    expect(problems(table({ offline: ['dan', 'eve', 'fay'] }))).toEqual([{ problem: 'needs_players', count: 1 }]);
    expect(problems(table())).toEqual([]);
    expect(game.canStart(table().data, table().ctx)).toBe(true);
    const agents = table({ agents: ['eve', 'fay'], settings: { voteTime: 0, describeTime: 30 } });
    expect(problems(agents)).toEqual([{ problem: 'needs_timers' }]);
    const all = table({
      players: ['ann', 'bob', 'cat', 'dan'],
      agents: ['ann', 'bob', 'cat', 'dan'],
      settings: { voteTime: 30, describeTime: 30 },
    });
    expect(problems(all)).toEqual([{ problem: 'needs_human' }]);
  });

  it('deals the pair that the room drew, and keeps where it came from', () => {
    const room = table();
    expect(game.drawsWords?.(room.data)).toBe(true);
    const started = room.start();
    expect(started.players).toHaveLength(6);
    expect(new Set(started.players.map((player) => player.role))).toEqual(new Set(['student', 'reviewer2', 'pi']));
    expect(started.source).toEqual({
      kind: 'library',
      field: 'fruit',
      pair: 'fruit:apple+pear',
      terms: { student: started.words.student.word, reviewer2: started.words.reviewer2.word },
    });
    expect(game.setup?.(room.data)).toMatchObject({ words: { student: started.words.student.word } });
    expect(game.shapes?.setup(game.setup?.(room.data))).toBe(true);
    expect(game.participants?.(room.data, room.ctx)?.sort()).toEqual(PEOPLE.map((id) => `key-${id}`));
    expect(game.seated?.(room.data, 'ann')).toBe('player');
    expect(game.seated?.(room.data, 'zed')).toBe('watcher');
    expect(room.view({ playerId: 'zed' }).game?.setter).toBeNull();
    // A player at the table who was offline as the game began watches it.
    const offline = table({ players: [...PEOPLE, 'gus'], offline: ['gus'] });
    offline.start();
    expect(game.seated?.(offline.data, 'gus')).toBe('watcher');
  });
});

describe('a match', () => {
  const hooks = game.match as NonNullable<typeof game.match>;
  const words = { a: 'Apple', b: 'pear', field: 'fruit', named: true };

  it('remembers the pair of every game it starts, drawn or set, and has none of them again', () => {
    const room = table({ settings: { setter: true }, accounts: ['ann'] });
    expect(room.data.matchPairs).toBeNull();
    room.data = hooks.setup(room.data, room.ctx, { games: 3 });
    expect(room.data.matchPairs).toEqual([]);
    room.send('ann', 'impostor:words', words);
    const started = room.start();
    // The setter plays in no game of the match, and the players are in it in the order they came to
    // the table, not by their numbers, which the table of an anonymous game would give away.
    expect(hooks.lineup(room.data)).toEqual(room.data.seats.filter((id) => id !== 'ann'));
    expect(hooks.lineup(room.data)).not.toEqual(started.players.map((player) => player.id));
    expect(hooks.lineup(room.data)).not.toContain('ann');
    expect(room.data.matchPairs).toEqual([['Apple', 'pear']]);
    room.data = game.again(room.data, room.ctx);
    expect(room.try('ann', 'impostor:words', { ...words, a: 'PEARS', b: 'apple' })).toEqual({
      ok: false,
      error: 'words_played',
    });
    expect(hooks.fresh?.(room.data, WORDS)).toBe(false);
    expect(hooks.fresh?.(room.data, [{ word: 'plum' }, { word: 'pear' }])).toBe(true);
    // A room that is no longer a match forgets them.
    room.data = hooks.setup(room.data, room.ctx, null);
    expect(room.data.matchPairs).toBeNull();
    expect(hooks.fresh?.(room.data, WORDS)).toBe(true);
    expect(room.try('ann', 'impostor:words', words)).toMatchObject({ ok: true });
  });

  it('takes 3, 5 or 7 games, awards no title, shows no points of a game in progress, and stands with a setter', () => {
    expect(hooks).toMatchObject({ games: [3, 5, 7], titles: false, live: false });
    expect(hooks.chairBound?.(table().data)).toBe(false);
    expect(hooks.chairBound?.(table({ settings: { setter: true } }).data)).toBe(true);
  });
});

describe('the setter', () => {
  const setterRoom = (accounts = ['ann']) =>
    table({ players: ['ann', ...PEOPLE.slice(1), 'gus'], settings: { setter: true }, accounts });
  const words = { a: ' Apple ', b: 'pear', field: 'fruit', named: false };

  it('takes the words from the chair alone, with an account and a field of the library', () => {
    expect(setterRoom().try('bob', 'impostor:words', words)).toEqual({ ok: false, error: 'not_setter' });
    expect(setterRoom([]).try('ann', 'impostor:words', words)).toEqual({ ok: false, error: 'account_required' });
    expect(setterRoom().try('ann', 'impostor:words', { ...words, field: 'stars' })).toEqual({
      ok: false,
      error: 'bad_field',
    });
    expect(setterRoom().try('ann', 'impostor:words', { ...words, b: 'apples' })).toEqual({
      ok: false,
      error: 'words_same',
    });
    expect(setterRoom().try('ann', 'impostor:words', { ...words, b: ' ' })).toEqual({
      ok: false,
      error: 'words_missing',
    });
    // A word is checked whole, as it is kept: a long one doesn't pass as the word it begins with.
    const long = `pear ${' '.repeat(500)}${'and a sentence after it '.repeat(10)}`;
    expect(setterRoom().try('ann', 'impostor:words', { ...words, b: long })).toEqual({
      ok: false,
      error: 'words_too_long',
    });
    expect(setterRoom().try('ann', 'impostor:words', { ...words, b: `pear${' '.repeat(MAX_LINE_INPUT)}` })).toEqual({
      ok: false,
      error: 'bad_request',
    });
    const room = setterRoom();
    room.send('ann', 'impostor:words', words);
    expect(room.data.setterWords).toEqual({ by: 'ann', a: 'Apple', b: 'pear', field: 'fruit', named: false });
    expect(room.view({ playerId: 'ann' }).setterWords).toEqual({ a: 'Apple', b: 'pear', field: 'fruit', named: false });
    expect(room.view({ playerId: 'bob' }).setterWords).toBeNull();
    // Without a setter, the words go.
    const off = game.configure(room.data, room.ctx, SETTINGS);
    expect(off.ok && off.data.setterWords).toBeNull();
  });

  it("needs the words to start, plays without the setter, and deals the setter's words", () => {
    const room = setterRoom();
    expect(room.view({ playerId: 'ann' }).startProblems).toEqual([{ problem: 'needs_words' }]);
    room.send('ann', 'impostor:words', words);
    expect(room.view({ playerId: 'ann' }).startProblems).toEqual([]);
    expect(game.drawsWords?.(room.data)).toBe(false);
    room.ctx = { ...room.ctx, phase: 'playing' };
    room.data = game.start(room.data, room.ctx, [], 'g1');
    const started = room.data.game as NonNullable<ImpostorData['game']>;
    expect(started.players.map((player) => player.id).sort()).toEqual([...PEOPLE.slice(1), 'gus'].sort());
    expect(started.source).toEqual({ kind: 'setter', setter: 'ann', field: 'fruit', named: false });
    expect([started.words.student.word, started.words.reviewer2.word].sort()).toEqual(['Apple', 'pear']);
    // The setter took part without playing, and gave a pair of words to the library.
    expect(game.participants?.(room.data, room.ctx)).not.toContain('key-ann');
    expect(game.contributors?.(room.data, room.ctx)).toEqual(['key-ann']);
    expect(game.content?.(game.setup?.(room.data))).toEqual({
      kind: 'pair',
      content: { words: [started.words.student.word, started.words.reviewer2.word], field: 'fruit' },
      author: 'ann',
      named: false,
    });
    // The setter sees both words, without knowing who has which, and talks off the field.
    const view = room.view({ playerId: 'ann' }).game;
    expect(view).toMatchObject({ you: null, setterWords: ['Apple', 'pear'], words: null, mayTalk: true });
    expect(view?.known.map((word) => word.word).sort()).toEqual(['Apple', 'pear']);
    expect(view?.seats.every((seat) => seat.role === null)).toBe(true);
    // Everyone knows who set the words, and the log says so of the setter, who reacts freely, as
    // someone who watches does.
    expect(game.seated?.(room.data, 'ann')).toBe('setter');
    expect(game.seated?.(room.data, 'bob')).toBe('player');
    expect(game.seated?.(room.data, 'zed')).toBe('watcher');
    expect(game.mayEmote?.(room.data, 'ann', room.ctx)).toBe(true);
    expect(room.view({ playerId: 'ann' }).mayEmote).toBe(true);
    expect(room.view({ playerId: 'bob' }).mayEmote).toBe(false);
    room.ctx = { ...room.ctx, chairId: 'bob' };
    for (const viewer of ['ann', 'bob', 'zed']) expect(room.view({ playerId: viewer }).game?.setter).toBe('ann');
  });

  it('sets the words of the next game anew', () => {
    const room = setterRoom();
    room.send('ann', 'impostor:words', words);
    room.start();
    room.data = game.again(room.data, { ...room.ctx, phase: 'lobby' });
    room.ctx = { ...room.ctx, phase: 'lobby' };
    expect(room.data).toMatchObject({ game: null, setterWords: null });
    expect(room.view({ playerId: 'ann' }).startProblems).toEqual([{ problem: 'needs_words' }]);
  });

  it('loses the words when the chair passes to someone else', () => {
    const room = setterRoom(['ann', 'bob']);
    room.send('ann', 'impostor:words', words);
    room.ctx = { ...room.ctx, chairId: 'bob' };
    expect(room.view({ playerId: 'bob' }).setterWords).toBeNull();
    expect(room.view({ playerId: 'bob' }).startProblems).toEqual([{ problem: 'needs_words' }]);
  });
});

describe('what each viewer sees', () => {
  it('gives a player their number and word, and nobody the roles while the game is on', () => {
    const room = table();
    const started = room.start();
    const [reviewer2] = room.who('reviewer2');
    const [pi] = room.who('pi');
    const [student] = room.who('student');
    const mine = room.view({ playerId: student as string }).game;
    expect(mine?.you).toEqual({
      number: room.number(student as string),
      role: null,
      word: { word: started.words.student.word },
    });
    expect(room.view({ playerId: reviewer2 as string }).game?.you?.word).toEqual({
      word: started.words.reviewer2.word,
    });
    expect(room.view({ playerId: pi as string }).game?.you?.word).toBeNull();
    for (const viewer of [student, 'zed'] as string[]) {
      const seen = room.view({ playerId: viewer }).game;
      expect(seen?.seats.every((seat) => seat.role === null && seat.agent === null)).toBe(true);
      expect(seen?.seats.filter((seat) => seat.playerId !== null).map((seat) => seat.playerId)).toEqual(
        viewer === student ? [student] : [],
      );
      expect(seen?.words).toBeNull();
    }
    expect(room.view({ screen: true }).game?.mayTalk).toBe(false);
  });

  it("shows every name in a game that isn't anonymous", () => {
    const room = table({ settings: { anonymous: false } });
    room.start();
    expect(
      room
        .view({ playerId: 'zed' })
        .game?.seats.map((seat) => seat.playerId)
        .sort(),
    ).toEqual([...PEOPLE].sort());
  });

  it('gives the god view to those who only watch', () => {
    const room = table({ settings: { godView: true } });
    const started = room.start();
    const watcher = room.view({ playerId: 'zed' }).game;
    expect(watcher?.seats.map((seat) => seat.role)).toEqual(started.players.map((player) => player.role));
    expect(watcher?.words).toEqual({ student: started.words.student.word, reviewer2: started.words.reviewer2.word });
    expect(room.view({ playerId: 'ann' }).game?.words).toBeNull();
    expect(room.view({ screen: true }).game?.words).toBeNull();
    // Off the field, a line is held against the words the writer knows: both with the god view,
    // one's own for a player who is out, none for a spectator without it. The view says which,
    // with their forms, so that the page holds the line against the same.
    const { student, reviewer2 } = started.words;
    expect(watcher?.known).toEqual([{ word: student.word }, { word: reviewer2.word }]);
    const current = room.data.game as NonNullable<ImpostorData['game']>;
    room.data = {
      ...room.data,
      game: { ...current, words: { student: { ...student, forms: ['apples'] }, reviewer2 } },
    };
    expect(room.view({ playerId: 'zed' }).game?.known[0]).toEqual({ word: student.word, forms: ['apples'] });
    for (const word of [student.word, reviewer2.word]) {
      expect(room.try('zed', 'impostor:say', { gameId: 'g1', text: `is it ${word}?` })).toEqual({
        ok: false,
        error: 'chat_has_word',
      });
    }
    // With the god view, the lines of players off the field are named, as the seats are.
    room.deal('SSSSSR');
    room.describeAll();
    room.voteFor('ann', 'bob');
    expect(room.try('ann', 'impostor:say', { gameId: 'g1', text: 'out already' }).ok).toBe(true);
    expect(room.view({ playerId: 'zed' }).game?.offField?.at(-1)).toMatchObject({ number: 1, playerId: 'ann' });
    expect(room.view({ playerId: 'ann' }).game?.offField?.at(-1)).toMatchObject({ number: 1, playerId: null });
    const plain = table({ players: PEOPLE.slice(0, 5) });
    const dealt = plain.start();
    expect(plain.view({ playerId: 'zed' }).game?.known).toEqual([]);
    for (const word of [dealt.words.student.word, dealt.words.reviewer2.word]) {
      expect(plain.try('zed', 'impostor:say', { gameId: 'g1', text: `is it ${word}?` }).ok).toBe(true);
    }
    plain.deal('SSSSR');
    plain.describeAll();
    plain.voteFor('ann', 'bob');
    expect(plain.data.game?.players[0]?.fate).toBe('voted_out');
    expect(plain.view({ playerId: 'ann' }).game?.known).toEqual([plain.view({ playerId: 'ann' }).game?.you?.word]);
    expect(plain.try('ann', 'impostor:say', { gameId: 'g1', text: `not ${dealt.words.reviewer2.word}` }).ok).toBe(true);
    expect(plain.try('ann', 'impostor:say', { gameId: 'g1', text: `not ${dealt.words.student.word}` })).toEqual({
      ok: false,
      error: 'chat_has_word',
    });
  });

  it('keeps the votes hidden until they are revealed, and shows the role of whoever goes out', () => {
    const room = table();
    room.start();
    room.describeAll();
    const [first, second] = room.who('student') as [string, string];
    room.send(first, 'impostor:vote', { ...room.at(), number: room.number(second) });
    const seen = room.view({ playerId: second }).game;
    expect(seen).toMatchObject({ phase: 'vote', voted: [room.number(first)], ballots: [], myVote: undefined });
    expect(room.view({ playerId: first }).game?.myVote).toBe(room.number(second));
    room.voteFor(second, first);
    const after = room.view({ playerId: first }).game;
    expect(after?.ballots[0]?.out).toBe(room.number(second));
    expect(after?.seats.find((seat) => seat.number === room.number(second))).toMatchObject({
      fate: 'voted_out',
      role: 'student',
    });
    expect(room.view({ playerId: second }).game?.you?.role).toBe('student');
  });

  it('keeps the off-field chat from the players in the game', () => {
    const room = table();
    room.start();
    expect(room.try('zed', 'impostor:say', { gameId: 'g1', text: 'hello all' }).ok).toBe(true);
    expect(room.try('ann', 'impostor:say', { gameId: 'g1', text: 'hi' })).toEqual({ ok: false, error: 'cannot_talk' });
    expect(room.view({ playerId: 'ann' }).game).toMatchObject({ offField: null, mayTalk: false });
    expect(room.view({ playerId: 'zed' }).game?.offField).toEqual([
      { id: 1, number: null, playerId: 'zed', text: 'hello all', after: false },
    ]);
    expect(room.entries.at(-1)).toMatchObject({ by: 'zed', type: 'impostor:say', said: 'hello all' });
  });

  it('lets those who are out, watch or set the words react while the game is on, and everyone after it', () => {
    const room = table({ players: PEOPLE.slice(0, 5), settings: { anonymous: false } });
    expect(game.mayEmote?.(room.data, 'ann', room.ctx)).toBe(true);
    room.start();
    room.deal('SSSSR');
    const reacts = (id: string) => [game.mayEmote?.(room.data, id, room.ctx), room.view({ playerId: id }).mayEmote];
    expect(reacts('ann')).toEqual([false, false]);
    expect(reacts('zed')).toEqual([true, true]);
    room.describeAll();
    room.voteFor('bob', 'ann');
    expect(room.data.game?.players[1]?.fate).toBe('voted_out');
    expect(reacts('bob')).toEqual([true, true]);
    expect(reacts('ann')).toEqual([false, false]);
    room.describeAll();
    room.voteFor('eve', 'ann');
    expect(room.data.game?.result?.winner).toBe('student');
    for (const id of ['ann', 'bob', 'eve', 'zed']) expect(reacts(id)).toEqual([true, true]);
  });

  it('keeps those out of an anonymous game from reacting until it is over, since a reaction names them', () => {
    const room = table({ players: PEOPLE.slice(0, 5) });
    room.start();
    room.deal('SSSSR');
    const reacts = (id: string) => [game.mayEmote?.(room.data, id, room.ctx), room.view({ playerId: id }).mayEmote];
    room.describeAll();
    room.voteFor('bob', 'ann');
    expect(room.data.game?.players[1]?.fate).toBe('voted_out');
    expect(reacts('bob')).toEqual([false, false]);
    expect(reacts('zed')).toEqual([true, true]);
    room.describeAll();
    room.voteFor('eve', 'ann');
    expect(reacts('bob')).toEqual([true, true]);
  });

  it('has a player after an anonymous game with AI players guess them before talking', () => {
    const room = table({ agents: ['fay'], settings: { describeTime: 60, voteTime: 30 } });
    room.start();
    room.deal('SSSSRP');
    room.describeAll();
    room.voteFor('eve', 'ann');
    expect(room.data.game?.result).toEqual({ winner: 'pi', reason: 'pi_survived' });
    expect(room.view({ playerId: 'ann' }).game).toMatchObject({ mayTalk: false, offField: null, guess: { agents: 1 } });
    expect(room.try('ann', 'impostor:say', { gameId: 'g1', text: 'well played' })).toEqual({
      ok: false,
      error: 'guess_first',
    });
    // The replay waits for the guess too (Room.guessing).
    expect(game.guessing?.(room.data, 'ann')).toBe(true);
    expect(game.guessing?.(room.data, 'fay')).toBe(false);
    expect(game.guessing?.(room.data, 'zed')).toBe(false);
    const guessed = game.guessAgents?.(room.data, room.ctx, 'ann', null);
    if (!guessed?.ok) throw new Error('refused');
    room.data = guessed.data;
    expect(game.guessing?.(room.data, 'ann')).toBe(false);
    expect(room.view({ playerId: 'ann' }).game?.mayTalk).toBe(true);
    expect(room.try('ann', 'impostor:say', { gameId: 'g1', text: 'well played' }).ok).toBe(true);
    // Nobody won a point with an AI player in the game, whose version is not certified.
    expect(room.view({ playerId: 'ann' }).game?.points).toBeNull();
  });

  it('has no guess of the AI players in a game that the chair withdrew', () => {
    const room = table({ agents: ['fay'], settings: { describeTime: 60, voteTime: 30 } });
    room.start();
    const withdrawn = game.withdraw(room.data, 'g1');
    if (!withdrawn.ok) throw new Error(withdrawn.error);
    room.data = withdrawn.data;
    expect(room.view({ playerId: 'ann' }).game).toMatchObject({ phase: 'over', guess: null, mayTalk: true });
    expect(game.guessAgents?.(room.data, room.ctx, 'ann', null)).toEqual({ ok: false, error: 'cannot_guess' });
  });

  it("takes a guess of the students' word no longer than any line", () => {
    const room = table();
    room.start();
    const guess = (word: string) => room.try('ann', 'impostor:comeback', { gameId: 'g1', word });
    expect(guess('x'.repeat(MAX_LINE_INPUT + 1))).toEqual({ ok: false, error: 'bad_request' });
    expect(guess('x'.repeat(MAX_LINE_INPUT))).toEqual({ ok: false, error: 'no_comeback' });
  });

  it('shows a report to everyone, and its votes once it is settled', () => {
    const room = table();
    room.start();
    const [reporter, target, judge] = room.who('student') as [string, string, string];
    room.send(reporter, 'impostor:report', {
      ...room.at(),
      number: room.number(target),
      line: null,
      reason: 'too plain',
    });
    expect(game.due?.(room.data)).toEqual(room.data.game?.report?.eligible);
    room.send(judge, 'impostor:judge', { gameId: 'g1', verdict: 'agree' });
    const open = room.view({ playerId: judge }).game?.report;
    expect(open).toMatchObject({
      by: room.number(reporter),
      target: room.number(target),
      judged: 1,
      eligible: 5,
      mine: 'agree',
      mayJudge: false,
      verdicts: null,
    });
    expect(room.view({ playerId: reporter }).game?.report?.mayJudge).toBe(true);
    expect(room.view({ playerId: target }).game?.report?.mayJudge).toBe(false);
    room.tick(20_000);
    const settled = room.view({ playerId: 'zed' }).game;
    expect(settled?.report).toBeNull();
    expect(settled?.reports[0]).toMatchObject({ passed: false, verdicts: { [room.number(judge)]: 'agree' } });
    expect(room.view({ playerId: reporter }).game?.reported).toBe(true);
  });

  it('counts the judges of a report who are still in the game, and a report dropped as made', () => {
    const room = table();
    room.start();
    room.deal('SSSSRP');
    room.send('ann', 'impostor:report', { ...room.at(), number: 2, line: null, reason: 'too plain' });
    room.send('cat', 'impostor:judge', { gameId: 'g1', verdict: 'agree' });
    expect(room.view({ playerId: 'dan' }).game?.report).toMatchObject({ judged: 1, eligible: 5 });
    room.leave('cat');
    expect(room.view({ playerId: 'dan' }).game?.report).toMatchObject({ judged: 0, eligible: 4 });
    // Bob, whom Ann reported, leaves: the report goes, and Ann has made hers of the round.
    room.leave('bob');
    expect(room.view({ playerId: 'ann' }).game).toMatchObject({ report: null, reports: [], reported: true });
    expect(room.try('ann', 'impostor:report', { ...room.at(), number: 4, line: null, reason: 'too plain' })).toEqual({
      ok: false,
      error: 'reported_already',
    });
  });
});

describe('the log and the records', () => {
  // A game of six, Ann, Bob, Cat and Dan the students, numbers 1 to 4, Eve the Reviewer 2 and Fay
  // the PI: Ann's report of Bob fails and her time runs out; a tie of Ann and Bob, and Fay's vote
  // whose time ran out; Bob voted out in the revote; and Eve voted out, after which Fay wins.
  function played() {
    const room = table({ settings: { describeTime: 60, voteTime: 30 }, accounts: PEOPLE });
    room.start();
    room.deal('SSSSRP');
    room.send('ann', 'impostor:report', { ...room.at(), number: 2, line: null, reason: 'odd one' });
    room.tick(20_000);
    room.tick(60_000);
    room.describeAll();
    const ballot: [string, number][] = [
      ['ann', 2],
      ['bob', 1],
      ['cat', 2],
      ['dan', 1],
      ['eve', 3],
    ];
    for (const [by, number] of ballot) room.send(by, 'impostor:vote', { ...room.at(), number });
    room.tick(30_000);
    expect(room.data.game).toMatchObject({ phase: 'tie', tied: ['ann', 'bob'] });
    room.describeAll();
    for (const by of ['cat', 'dan', 'eve', 'fay']) room.send(by, 'impostor:vote', { ...room.at(), number: 2 });
    expect(room.data.game?.players[1]?.fate).toBe('voted_out');
    room.describeAll();
    room.voteFor('eve', 'ann');
    room.send('ann', 'impostor:say', { gameId: 'g1', text: 'good game' });
    return room;
  }

  it('counts a kept game again just as it counted at its end', () => {
    const room = played();
    const ended = room.data.game as NonNullable<ImpostorData['game']>;
    expect(ended.result).toEqual({ winner: 'pi', reason: 'pi_survived' });
    const results = game.results?.(room.data, room.ctx);
    const scores = game.score?.(room.data, room.ctx);
    const resultOf = (id: string) => results?.find((result) => result.playerId === id);
    const pointsOf = (id: string) => scores?.find((score) => score.key === `key-${id}`)?.points;
    expect(resultOf('fay')).toMatchObject({ result: 'won', place: 1, side: 'pi', role: 'pi', verdict: 'alive' });
    expect(resultOf('bob')).toMatchObject({ result: 'lost', place: 2, side: 'student', verdict: 'voted_out' });
    expect(resultOf('eve')).toMatchObject({ result: 'lost', place: 2, side: 'reviewer2', verdict: 'voted_out' });
    // Fay: 6 for the win and 1 for lasting, a vote for Eve, a vote that put Bob out, and a vote
    // whose time ran out.
    expect(resultOf('fay')?.detail).toEqual({
      out: null,
      rounds: 2,
      votes: 2,
      hits: 1,
      wrong: 1,
      abstained: 0,
      missedVotes: 1,
      missedLines: 0,
      reported: 0,
      reports: 0,
      failedReports: 0,
      comeback: null,
    });
    expect(pointsOf('fay')).toBe(6 + 1 + 1 - 1 - 1);
    // Ann: a vote for Eve, a report that failed and a line whose time ran out.
    expect(resultOf('ann')?.detail).toMatchObject({ votes: 2, hits: 1, reports: 1, failedReports: 1, missedLines: 1 });
    expect(pointsOf('ann')).toBe(1 - 1 - 3);
    // Bob: reported once, and a student voted out.
    expect(resultOf('bob')?.detail).toMatchObject({ reported: 1, out: 1, rounds: 1 });
    expect(pointsOf('bob')).toBe(-1);
    // Eve: voted out in the second round, and one of the votes that put Bob out.
    expect(pointsOf('eve')).toBe(-1);
    for (const result of results ?? []) expect(game.shapes?.detail(result.detail)).toBe(true);
    const recount = game.recount?.({
      setup: game.setup?.(room.data),
      log: room.log(),
      language: 'en',
      keyOf: (id) => `key-${id}`,
    });
    expect(recount).toEqual({ results, scores, outcome: game.outcome?.(room.data), scoresNothing: false });
    expect(game.rated?.(room.data)).toBe(true);
    expect(game.scoresNothing?.(room.data)).toBe(false);
    expect(room.view({ playerId: 'zed' }).game?.points).toEqual(
      scores?.map((score) => ({ number: room.number(score.key.slice('key-'.length)), points: score.points })),
    );
  });

  it('keeps every line, vote, report and the talk, as the replay shows them', () => {
    const room = played();
    const log = room.log();
    const types = log.entries.map((entry) => entry.type);
    expect(types.filter((type) => type === 'impostor:votes')).toHaveLength(3);
    expect(types.filter((type) => type === 'impostor:missed')).toHaveLength(1);
    expect(types.filter((type) => type === 'impostor:judged')).toHaveLength(1);
    expect(types.filter((type) => type === 'impostor:out')).toHaveLength(2);
    expect(types.at(-2)).toBe('impostor:say');
    expect(log.entries.find((entry) => entry.type === 'impostor:votes')?.data).toMatchObject({
      ballot: 'vote',
      out: null,
    });
    const replay = game.showReplay?.({
      setup: game.setup?.(room.data),
      log,
      language: 'en',
      accounts: new Map([['ann', { username: 'Ann', avatar: null, handle: 'ann1' }]]),
      viewer: new Set(['ann']),
    });
    const ended = room.data.game as NonNullable<ImpostorData['game']>;
    expect(replay).toMatchObject({ gameId: 'g1', me: 'ann', setter: null, result: ended.result });
    expect((replay as { lines: unknown[] }).lines).toEqual(
      ended.lines.map((line) => ({ round: line.round, number: room.number(line.by), text: line.text, tie: line.tie })),
    );
    expect((replay as { ballots: unknown[] }).ballots).toEqual(room.view({ playerId: 'zed' }).game?.ballots);
    expect((replay as { people: Record<string, unknown> }).people.ann).toEqual({ name: 'Ann', handle: 'ann1' });
    expect((replay as { points: unknown }).points).toEqual(room.view({ playerId: 'zed' }).game?.points);
  });

  it('counts no record for a game that a Reviewer 2 left, and no points for one with a removal', () => {
    const room = table();
    room.start();
    const [reviewer2] = room.who('reviewer2') as [string];
    const [student] = room.who('student') as [string];
    room.leave(student, true);
    expect(game.scoresNothing?.(room.data)).toBe(true);
    room.leave(reviewer2);
    expect(room.data.game?.result).toEqual({ winner: null, reason: 'reviewer2_left' });
    expect(game.results?.(room.data, room.ctx)).toBeNull();
    expect(game.rated?.(room.data)).toBe(false);
    const outcome = { winner: null, reason: 'reviewer2_left' };
    expect(game.outcome?.(room.data)).toEqual(outcome);
    expect(room.entries.filter((entry) => entry.type === 'impostor:out').map((entry) => entry.data)).toEqual([
      { player: student, fate: 'left', round: 1, role: 'student' },
      { player: reviewer2, fate: 'left', round: 1, role: 'reviewer2' },
    ]);
    expect(room.entries.filter((entry) => entry.type === 'impostor:removed').map((entry) => entry.data)).toEqual([
      { player: student, round: 1 },
    ]);
    // Counted again, it has no records, as it had none, and comes out as it did.
    const kept = { setup: game.setup?.(room.data), log: room.log(), language: 'en' as const };
    expect(game.recount?.({ ...kept, keyOf: (id) => id })).toEqual({
      results: [],
      scores: [],
      outcome,
      scoresNothing: true,
    });
    // It has a replay, with its result and no points.
    const replay = game.showReplay?.({ ...kept, accounts: new Map(), viewer: new Set([student]) });
    expect(replay).toMatchObject({ gameId: 'g1', me: student, result: outcome, points: [] });
    // Everyone sees every role once it is over, and no points.
    expect(room.view({ playerId: 'zed' }).game?.seats.every((seat) => seat.role !== null)).toBe(true);
    expect(room.view({ playerId: 'zed' }).game?.points).toBeNull();
  });

  it('counts no points for a game in which the chair removed a player, in it or out, live as again', () => {
    const room = table({ players: PEOPLE.slice(0, 5), accounts: PEOPLE });
    room.start();
    room.deal('SSSSR');
    room.describeAll();
    room.voteFor('bob', 'ann');
    expect(room.data.game?.players[1]?.fate).toBe('voted_out');
    expect(game.scoresNothing?.(room.data)).toBe(false);
    room.leave('bob', true);
    expect(game.scoresNothing?.(room.data)).toBe(true);
    expect(room.entries.filter((entry) => entry.type === 'impostor:removed').map((entry) => entry.data)).toEqual([
      { player: 'bob', round: 2 },
    ]);
    room.describeAll();
    room.voteFor('eve', 'ann');
    expect(room.data.game?.result).toEqual({ winner: 'student', reason: 'caught' });
    const results = game.results?.(room.data, room.ctx);
    const scores = game.score?.(room.data, room.ctx);
    expect(results?.length).toBeGreaterThan(0);
    expect(room.view({ playerId: 'ann' }).game?.points).toBeNull();
    const kept = { setup: game.setup?.(room.data), log: room.log(), language: 'en' as const };
    expect(game.recount?.({ ...kept, keyOf: (id) => `key-${id}` })).toEqual({
      results,
      scores,
      outcome: { winner: 'student', reason: 'caught' },
      scoresNothing: true,
    });
    const replay = game.showReplay?.({ ...kept, accounts: new Map(), viewer: new Set(['ann']) });
    expect(replay).toMatchObject({ result: { winner: 'student' }, points: [] });
  });

  it('counts no record for a player who left a game that a side won', () => {
    const room = table({ players: PEOPLE.slice(0, 5) });
    room.start();
    room.deal('SSSSR');
    room.leave('dan');
    room.describeAll();
    room.voteFor('eve', 'ann');
    expect(room.data.game?.result).toEqual({ winner: 'student', reason: 'caught' });
    const results = game.results?.(room.data, room.ctx);
    expect(results?.map((result) => [result.playerId, result.result])).toEqual([
      ['ann', 'won'],
      ['bob', 'won'],
      ['cat', 'won'],
      ['eve', 'lost'],
    ]);
    expect(game.participants?.(room.data, room.ctx)).toContain('key-dan');
    expect(game.contributors?.(room.data, room.ctx)).toEqual([]);
    expect(game.content?.(game.setup?.(room.data))).toBeNull();
    const recount = game.recount?.({
      setup: game.setup?.(room.data),
      log: room.log(),
      language: 'en',
      keyOf: (id) => `key-${id}`,
    });
    expect(recount?.results).toEqual(results);
  });

  it('keeps what each message carried, as the game keeps it', () => {
    const logged = (type: string, payload: unknown) => game.logged?.(type, payload);
    expect(logged('impostor:describe', { gameId: 'g1', round: 2, text: '  a fruit\u200b ' })).toEqual({
      data: { round: 2, text: 'a fruit' },
    });
    expect(logged('impostor:vote', { gameId: 'g1', round: 2, number: null })).toEqual({
      data: { round: 2, number: null },
    });
    expect(logged('impostor:report', { gameId: 'g1', round: 1, number: 3, line: null, reason: ' odd ' })).toEqual({
      data: { round: 1, number: 3, line: null, reason: 'odd' },
    });
    expect(logged('impostor:judge', { gameId: 'g1', verdict: 'abstain' })).toEqual({ data: { verdict: 'abstain' } });
    expect(logged('impostor:comeback', { gameId: 'g1', word: ' pear ' })).toEqual({ data: { word: 'pear' } });
    expect(logged('impostor:say', { gameId: 'g1', text: ' hi ' })).toEqual({ said: 'hi' });
    expect(logged('impostor:seat', { play: true })).toBeNull();
    expect(logged('impostor:words', { a: 'a', b: 'b', field: 'fruit', named: true })).toBeNull();
    expect(logged('impostor:vote', { gameId: 'g1' })).toBeNull();
  });
});

describe('the shapes of the data', () => {
  it("takes the game's own and nothing else", () => {
    const room = table();
    room.start();
    const setup = game.setup?.(room.data) as Record<string, unknown>;
    const shapes = game.shapes!;
    expect(shapes.setup(setup)).toBe(true);
    expect(shapes.setup({ ...setup, extra: 1 })).toBe(false);
    expect(shapes.setup({ ...setup, players: [] })).toBe(false);
    expect(shapes.setup({ ...setup, source: { kind: 'setter', setter: 'ann', field: 'fruit', named: true } })).toBe(
      true,
    );
    expect(shapes.setup({ ...setup, source: { kind: 'setter', setter: 'ann', field: 'fruit' } })).toBe(false);
    expect(shapes.settings(SETTINGS)).toBe(true);
    expect(shapes.settings({ ...SETTINGS, extra: true })).toBe(false);
    expect(shapes.role('pi')).toBe(true);
    expect(shapes.role('captain')).toBe(false);
    expect(shapes.guess?.(null)).toBe(true);
    expect(shapes.guess?.([2, 5])).toBe(true);
    expect(shapes.guess?.([5, 2])).toBe(false);
    expect(shapes.guess?.([])).toBe(false);
    expect(shapes.detail({ out: null })).toBe(false);
  });
});
