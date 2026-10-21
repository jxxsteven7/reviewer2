import type { BoardWord } from '@reviewer2/shared';
import type { ImpostorRoomData, ImpostorSettings } from '@reviewer2/shared/impostor';
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
    // dealt() does: S a student, R a Reviewer 2 and P the PI, with numbers in that order too.
    deal(roles: string) {
      const current = room.data.game as NonNullable<ImpostorData['game']>;
      const named: Record<string, 'student' | 'reviewer2' | 'pi'> = { S: 'student', R: 'reviewer2', P: 'pi' };
      const dealtPlayers = players.slice(0, roles.length).map((id, index) => ({
        id,
        number: index + 1,
        role: named[roles[index] as string] as 'student' | 'reviewer2' | 'pi',
        agent: false,
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
    const room = setterRoom();
    room.send('ann', 'impostor:words', words);
    expect(room.data.setterWords).toEqual({ by: 'ann', a: 'Apple', b: 'pear', field: 'fruit', named: false });
    expect(room.view({ playerId: 'ann' }).setterWords).toEqual({ a: 'Apple', b: 'pear', field: 'fruit', named: false });
    expect(room.view({ playerId: 'bob' }).setterWords).toBeNull();
    // Without a setter, the words go.
    const off = game.configure(room.data, room.ctx, SETTINGS);
    expect(off.ok && off.data.setterWords).toBeNull();
  });

  it('needs the words to start, plays without the setter, and deals the setter’s words', () => {
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
    expect(game.participants?.(room.data, room.ctx)).toContain('key-ann');
    // The setter sees both words, without knowing who has which, and talks off the field.
    const view = room.view({ playerId: 'ann' }).game;
    expect(view).toMatchObject({ you: null, setterWords: ['Apple', 'pear'], words: null, mayTalk: true });
    expect(view?.seats.every((seat) => seat.role === null)).toBe(true);
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
    expect(mine?.you).toEqual({ number: room.number(student as string), role: null, word: started.words.student.word });
    expect(room.view({ playerId: reviewer2 as string }).game?.you?.word).toBe(started.words.reviewer2.word);
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

  it('shows every name in a game that isn’t anonymous', () => {
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
      { number: null, playerId: 'zed', text: 'hello all', after: false },
    ]);
    expect(room.entries.at(-1)).toMatchObject({ by: 'zed', type: 'impostor:say', said: 'hello all' });
    expect(game.mayEmote?.(room.data, 'zed', room.ctx)).toBe(false);
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
    expect(recount).toEqual({ results, scores, outcome: game.outcome?.(room.data) });
    expect(game.rated?.(room.data)).toBe(true);
    expect(game.scoresNothing?.(room.data)).toBe(false);
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
    expect(game.score?.(room.data, room.ctx)).toBeNull();
    expect(game.rated?.(room.data)).toBe(false);
    expect(room.entries.filter((entry) => entry.type === 'impostor:out').map((entry) => entry.data)).toEqual([
      { player: student, fate: 'left', round: 1, role: 'student', removed: true },
      { player: reviewer2, fate: 'left', round: 1, role: 'reviewer2' },
    ]);
    expect(
      game.recount?.({ setup: game.setup?.(room.data), log: room.log(), language: 'en', keyOf: (id) => id }),
    ).toBeNull();
    // Everyone sees every role once it is over.
    expect(room.view({ playerId: 'zed' }).game?.seats.every((seat) => seat.role !== null)).toBe(true);
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
  it('takes the game’s own and nothing else', () => {
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
