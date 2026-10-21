import { cleanLine, RATINGS, type BoardWord } from '@reviewer2/shared';
import {
  checkSetterWords,
  defaultSettings,
  IMPOSTOR_ROLES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  mayBePublic,
  PRIVATE_SETTINGS,
  sameSettings,
  settingsProblems,
  type ImpostorRoomData,
  type ImpostorStartProblem,
} from '@reviewer2/shared/impostor';
import { IMPOSTOR_MESSAGES, IMPOSTOR_SETTINGS, type ImpostorMessage } from '@reviewer2/shared/impostor/schemas';
import type { z } from 'zod';
import { fail } from '../../core/answers';
import type { GameContext, GameLogNote, GameModule, GameShapes, GameUpdate, LogNote } from '../../core/game';
import { pinyinOf } from '../../core/pinyin';
import { pairKey } from '../../core/words';
import { agentMove, agentProblems, agentTask, practiceSeats } from './agents';
import { recountOf, shownReplay } from './replay';
import { factsOf, LOGGED, resultsFrom, scoresFrom, setupOf, type ImpostorSetup } from './results';
import {
  describe,
  expire,
  deadlineOf,
  guess,
  guessAgents,
  judge,
  leave,
  newGame,
  report,
  talk,
  vote,
  type Outcome,
} from './rules';
import type { ImpostorData, ImpostorGame, SetterWords } from './state';
import { offField, viewOf, watcherOf } from './view';

// The hidden word game as a GameModule: the rules in rules.ts, connected to a room.
// docs/games/impostor.md describes the game.

// The version of the rules and the scoring (GameModule.rulesVersion). Raise it by one with every
// change to either; the records of every kept game are then counted again under the new version
// (store/recount.ts).
export const RULES_VERSION = 1;

// How much a game may log (GameModule.logLimits): every player writes a line a round, and a game of
// twelve may last many rounds, each with its votes, so a game takes more than the first game's.
export const LOG_LIMITS = { bytes: 512 * 1024, crowded: 256 * 1024, said: 128 * 1024, perMember: 600 };

// The setter is whoever chairs the room, while the room has a setter (docs/games/impostor.md#the-setter).
const setterOf = (data: ImpostorData, ctx: Pick<GameContext, 'chairId'>): string | null =>
  data.settings.setter ? ctx.chairId : null;

// The setter's words, if the one who chairs the room set them.
const wordsOf = (data: ImpostorData, ctx: Pick<GameContext, 'chairId'>): SetterWords | null => {
  const setter = setterOf(data, ctx);
  return setter !== null && data.setterWords?.by === setter ? data.setterWords : null;
};

// Who plays the next game: everyone who came to play and is online, in the order they came, but
// the setter.
const playersOf = (data: ImpostorData, ctx: GameContext): string[] => {
  const setter = setterOf(data, ctx);
  return data.seats.filter((id) => id !== setter && ctx.isOnline(id));
};

function problemsOf(data: ImpostorData, ctx: GameContext): ImpostorStartProblem[] {
  const players = playersOf(data, ctx);
  const problems: ImpostorStartProblem[] = [];
  if (players.length < MIN_PLAYERS) problems.push({ problem: 'needs_players', count: MIN_PLAYERS - players.length });
  if (players.length > MAX_PLAYERS) problems.push({ problem: 'too_many_players', count: players.length - MAX_PLAYERS });
  if (data.settings.setter && !wordsOf(data, ctx)) problems.push({ problem: 'needs_words' });
  return [...problems, ...agentProblems(data, players, ctx)];
}

const fromOutcome = (data: ImpostorData, outcome: Outcome): GameUpdate<ImpostorData> => {
  if (!outcome.ok) return outcome;
  return { ok: true, data: outcome.game === data.game ? data : { ...data, game: outcome.game } };
};

// An action on the game. Once a game has ended, its actions still reach the rules, which answer
// stale or game_over; in the waiting room there is no game, so an action there is stale.
const act = (data: ImpostorData, rule: (game: ImpostorGame) => Outcome) =>
  data.game ? fromOutcome(data, rule(data.game)) : fail('stale');

// The setter's word as the game deals it: as the word library would, with the pinyin of a Chinese
// word, which the description check holds lines against.
function setterWord(word: string): BoardWord {
  const pinyin = pinyinOf(word);
  return { word, ...(pinyin === null ? {} : { pinyin }) };
}

type Payload<M extends ImpostorMessage> = z.infer<(typeof IMPOSTOR_MESSAGES)[M]>;
type Action<M extends ImpostorMessage> = (
  data: ImpostorData,
  ctx: GameContext,
  playerId: string,
  payload: Payload<M>,
) => GameUpdate<ImpostorData>;

const actions: { [M in ImpostorMessage]: Action<M> } = {
  // In the waiting room, whoever is there plays the next game or watches it; 12 play at most.
  'impostor:seat': (data, _ctx, playerId, { play }) => {
    if (data.game && data.game.phase !== 'over') return fail('wrong_phase');
    const seated = data.seats.includes(playerId);
    if (play === seated) return { ok: true, data };
    if (play && data.seats.length >= MAX_PLAYERS) return { ok: false, error: 'table_full' };
    return {
      ok: true,
      data: { ...data, seats: play ? [...data.seats, playerId] : data.seats.filter((id) => id !== playerId) },
    };
  },
  // The setter gives the two words, the field they are of and whether to be named when the pair is
  // adopted, in the waiting room. The setter needs an account, which a pair adopted is credited to.
  'impostor:words': (data, ctx, playerId, { a, b, field, named }) => {
    if (data.game && data.game.phase !== 'over') return fail('wrong_phase');
    if (setterOf(data, ctx) !== playerId) return { ok: false, error: 'not_setter' };
    if (!ctx.hasAccount(playerId)) return fail('account_required');
    if (!ctx.hasField(field)) return { ok: false, error: 'bad_field' };
    const problem = checkSetterWords(a, b);
    if (problem) return { ok: false, error: problem };
    const words = { by: playerId, a: cleanLine(a), b: cleanLine(b), field, named };
    return { ok: true, data: { ...data, setterWords: words } };
  },
  'impostor:describe': (data, ctx, playerId, message) =>
    act(data, (game) => describe(game, playerId, message, ctx.now())),
  'impostor:vote': (data, ctx, playerId, message) => act(data, (game) => vote(game, playerId, message, ctx.now())),
  'impostor:report': (data, ctx, playerId, message) => act(data, (game) => report(game, playerId, message, ctx.now())),
  'impostor:judge': (data, ctx, playerId, message) => act(data, (game) => judge(game, playerId, message, ctx.now())),
  'impostor:comeback': (data, ctx, playerId, message) => act(data, (game) => guess(game, playerId, message, ctx.now())),
  'impostor:say': (data, ctx, playerId, message) =>
    act(data, (game) =>
      talk(game, playerId, message, offField(game, watcherOf({ playerId }, setterOf(data, ctx), false, game))),
    ),
};

// What the log keeps of each message (docs/architecture.md#game-records): what it carried, as its
// schema reads it, without the game's ID, which is the log's own, with what the player wrote as the
// game keeps it (cleanLine). The off-field chat and the talk after the game are what the players
// said, which the log keeps apart. A vote and a verdict are kept as they were cast, and again with
// everyone's once revealed (logChanges); taking a seat or setting the words happens in the waiting
// room, which the log doesn't keep.
function logNote(type: string, payload: unknown): LogNote | null {
  if (!Object.hasOwn(IMPOSTOR_MESSAGES, type) || type === 'impostor:seat' || type === 'impostor:words') return null;
  const parsed = IMPOSTOR_MESSAGES[type as ImpostorMessage].safeParse(payload ?? {});
  if (!parsed.success) return null;
  const data: Record<string, unknown> = { ...parsed.data };
  delete data.gameId;
  if (type === 'impostor:say') return { said: cleanLine(data.text as string) };
  if (type === 'impostor:describe') data.text = cleanLine(data.text as string);
  if (type === 'impostor:report') data.reason = cleanLine(data.reason as string);
  if (type === 'impostor:comeback' && typeof data.word === 'string') data.word = cleanLine(data.word);
  return { data };
}

// What happened in a change of the game, besides the message that brought it, for the log
// (results.ts, LOGGED): the votes once revealed, the lines whose time ran out, the reports settled,
// the players who went out, the guesses of the students' word, and the end.
function changeNotes(before: ImpostorData, after: ImpostorData): GameLogNote[] {
  const was = before.game;
  const now = after.game;
  if (!was || !now || was.gameId !== now.gameId || was === now) return [];
  const notes: GameLogNote[] = [];
  for (const { round, ballot, votes, out, tied } of now.ballots.slice(was.ballots.length)) {
    notes.push({ type: LOGGED.votes, data: { round, ballot, votes: { ...votes }, out, tied: [...tied] } });
  }
  for (const line of now.lines.slice(was.lines.length)) {
    if (line.text === null) {
      notes.push({ type: LOGGED.missed, data: { player: line.by, round: line.round, tie: line.tie } });
    }
  }
  for (const settled of now.reports.slice(was.reports.length)) {
    notes.push({
      type: LOGGED.judged,
      data: {
        round: settled.round,
        by: settled.by,
        target: settled.target,
        line: settled.line,
        reason: settled.reason,
        verdicts: { ...settled.verdicts },
        passed: settled.passed === true,
      },
    });
  }
  for (const player of now.players) {
    const earlier = was.players.find((other) => other.id === player.id);
    if (earlier?.fate === 'alive' && player.fate !== 'alive') {
      const removed = player.fate === 'left' && now.removed && !was.removed;
      notes.push({
        type: LOGGED.out,
        data: {
          player: player.id,
          fate: player.fate,
          round: player.out,
          role: player.role,
          ...(removed ? { removed } : {}),
        },
      });
    }
  }
  for (const made of now.guesses.slice(was.guesses.length)) {
    notes.push({ type: LOGGED.guessed, data: { player: made.by, word: made.word, correct: made.correct } });
  }
  if (!was.result && now.result) {
    notes.push({ type: LOGGED.over, data: { winner: now.result.winner, reason: now.result.reason, round: now.round } });
  }
  return notes;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isWhole = (value: unknown, min = 0) => Number.isInteger(value) && (value as number) >= min;

// The shapes of the game's own in its data, for the check of the data (GameModule.shapes).
const shapes: GameShapes = {
  setup: (value) => {
    if (!isObject(value) || Object.keys(value).length !== 4) return false;
    const { settings, players, words, source } = value;
    if (!IMPOSTOR_SETTINGS.strict().safeParse(settings).success) return false;
    if (!Array.isArray(players) || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) return false;
    const numbers = new Set<number>();
    for (const player of players) {
      if (!isObject(player) || Object.keys(player).length !== 3 || typeof player.id !== 'string') return false;
      if (!isWhole(player.number, 1) || (player.number as number) > players.length) return false;
      if (!IMPOSTOR_ROLES.includes(player.role as (typeof IMPOSTOR_ROLES)[number])) return false;
      numbers.add(player.number as number);
    }
    if (numbers.size !== players.length) return false;
    if (!isObject(words) || typeof words.student !== 'string' || typeof words.reviewer2 !== 'string') return false;
    if (Object.keys(words).length !== 2 || !isObject(source) || typeof source.field !== 'string') return false;
    if (source.kind === 'library') {
      return (
        Object.keys(source).length === 4 &&
        typeof source.pair === 'string' &&
        isObject(source.terms) &&
        typeof source.terms.student === 'string' &&
        typeof source.terms.reviewer2 === 'string' &&
        Object.keys(source.terms).length === 2
      );
    }
    return (
      source.kind === 'setter' &&
      Object.keys(source).length === 4 &&
      typeof source.setter === 'string' &&
      typeof source.named === 'boolean'
    );
  },
  settings: (value) => IMPOSTOR_SETTINGS.strict().safeParse(value).success,
  role: (role) => IMPOSTOR_ROLES.includes(role as (typeof IMPOSTOR_ROLES)[number]),
  detail: (value) =>
    isObject(value) &&
    Object.keys(value).length === 12 &&
    (value.out === null || isWhole(value.out, 1)) &&
    [
      'rounds',
      'votes',
      'hits',
      'wrong',
      'abstained',
      'missedVotes',
      'missedLines',
      'reported',
      'reports',
      'failedReports',
    ].every((count) => isWhole(value[count])) &&
    (value.comeback === null || value.comeback === 'right' || value.comeback === 'wrong'),
  guess: (value) =>
    value === null ||
    (Array.isArray(value) &&
      value.length >= 1 &&
      value.length <= MAX_PLAYERS &&
      value.every((number, index) => isWhole(number, 1) && (index === 0 || number > (value[index - 1] as number)))),
};

export const impostorGame: GameModule<ImpostorData, ImpostorRoomData> = {
  id: 'impostor',
  rulesVersion: RULES_VERSION,
  // A pair of related terms, of which the students get one and the Reviewer 2s the other; or the
  // setter's two words, when the room has a setter.
  words: { pair: true },
  drawsWords: (data) => !data.settings.setter,
  logLimits: LOG_LIMITS,
  ratings: RATINGS,

  create: (language) => ({ settings: defaultSettings(language), seats: [], setterWords: null, game: null }),

  // The settings come whole and must suit the room's language; the god view and the setter are for a
  // private room only.
  configure(data, ctx, settings) {
    const parsed = IMPOSTOR_SETTINGS.safeParse(settings);
    if (!parsed.success || Object.keys(settingsProblems(parsed.data, ctx.language)).length > 0) {
      return fail('bad_settings');
    }
    if (ctx.public && PRIVATE_SETTINGS.some((key) => parsed.data[key])) return fail('private_only');
    if (sameSettings(parsed.data, data.settings)) return { ok: true, data };
    return {
      ok: true,
      data: { ...data, settings: parsed.data, setterWords: parsed.data.setter ? data.setterWords : null },
    };
  },

  settingsOf: (data) => data.settings,
  mayBePublic: (data) => mayBePublic(data.settings),

  // A newcomer who has come to play takes a place at the table for the next game, if there is one.
  join: (data, _ctx, playerId, play) =>
    play && !data.seats.includes(playerId) && data.seats.length < MAX_PLAYERS
      ? { ...data, seats: [...data.seats, playerId] }
      : data,

  // Whoever leaves gives up their place, and goes out of the game being played (rules.ts).
  leave(data, ctx, playerId, removed = false) {
    const seats = data.seats.filter((id) => id !== playerId);
    const game = data.game && leave(data.game, playerId, removed, ctx.now());
    return { ...data, seats, game };
  },

  // The chair moves a player to watch the next game; in a game, nobody is taken out but by leaving.
  bench: (data, _ctx, playerId) =>
    data.seats.includes(playerId) && (!data.game || data.game.phase === 'over')
      ? { ...data, seats: data.seats.filter((id) => id !== playerId) }
      : data,

  shuffle: (data) => data,
  canStart: (data, ctx) => problemsOf(data, ctx).length === 0,

  // The numbers and the roles are dealt at random; the words are the pair that the room drew, or the
  // setter's.
  start(data, ctx, words, gameId) {
    const players = playersOf(data, ctx).map((id) => ({ id, agent: ctx.agentOf(id) !== null }));
    const setter = wordsOf(data, ctx);
    const pair: readonly [BoardWord, BoardWord] = setter
      ? [setterWord(setter.a), setterWord(setter.b)]
      : [words[0] as BoardWord, words[1] as BoardWord];
    const game = newGame(
      {
        gameId,
        settings: data.settings,
        players,
        words: pair,
        source: (student, reviewer2) =>
          setter
            ? { kind: 'setter', setter: setter.by, field: setter.field, named: setter.named }
            : {
                kind: 'library',
                field: student.term?.field ?? '',
                pair: pairKey(pair[0].term?.field ?? '', pair[0].term?.id ?? '', pair[1].term?.id ?? ''),
                terms: { student: student.term?.id ?? '', reviewer2: reviewer2.term?.id ?? '' },
              },
      },
      ctx.rng,
      ctx.now(),
    );
    return { ...data, game };
  },

  deadline: (data) => deadlineOf(data.game),

  tick(data, ctx) {
    if (!data.game) return data;
    const game = expire(data.game, ctx.now());
    return game === data.game ? data : { ...data, game };
  },

  isOver: (data) => data.game?.phase === 'over',

  withdraw(data, gameId) {
    const game = data.game;
    if (!game || game.gameId !== gameId) return fail('stale');
    if (game.phase === 'over') return { ok: false, error: 'game_over' };
    return { ok: true, data: { ...data, game: { ...game, phase: 'over', clock: null, report: null, speaker: null } } };
  },

  // Back to the waiting room, with everyone at the table as they were.
  again: (data) => ({ ...data, game: null }),

  handle(data, ctx, playerId, type, payload) {
    if (!Object.hasOwn(IMPOSTOR_MESSAGES, type)) return fail('bad_request');
    const message = type as ImpostorMessage;
    const parsed = IMPOSTOR_MESSAGES[message].safeParse(payload ?? {});
    if (!parsed.success) return fail('bad_request');
    return (actions[message] as Action<ImpostorMessage>)(data, ctx, playerId, parsed.data);
  },

  // A game that a side won counts for everyone's record; one that was withdrawn, or that a Reviewer
  // 2 left, for none (results.ts).
  results: (data) => (data.game?.result?.winner ? resultsFrom(factsOf(data.game)) : null),
  outcome: (data) => {
    const result = data.game?.result;
    return result?.winner ? { winner: result.winner, reason: result.reason } : null;
  },
  score: (data, ctx) => (data.game ? scoresFrom(factsOf(data.game), ctx.keyOf) : null),
  // A game in which the chair removed a player counts for no points (docs/games/impostor.md#leaving).
  scoresNothing: (data) => data.game?.removed === true,
  // A game that a side won may be rated (docs/architecture.md#ratings).
  rated: (data) => data.game?.result?.winner !== undefined && data.game.result.winner !== null,

  guessAgents(data, _ctx, playerId, value) {
    if (!data.game) return fail('cannot_guess');
    const made = guessAgents(data.game, playerId, value);
    if (!made.ok) return made;
    return { ok: true, data: { ...data, game: made.game }, guess: made.guess ?? null };
  },

  showReplay: shownReplay,
  recount: recountOf,
  shapes,

  seated: (data, playerId) => (data.seats.includes(playerId) ? 'player' : 'watcher'),
  setup: (data) => (data.game ? setupOf(data.game) : null),
  logged: logNote,
  logChanges: changeNotes,

  // Nobody sends a quick reaction while a game is on: a reaction could tell the others who
  // someone is (docs/games/impostor.md#quick-reactions).
  mayEmote: (data) => !data.game || data.game.phase === 'over',

  // Whom the game is waiting for: the player describing, those who haven't voted or judged, and
  // the player guessing the students' word.
  due(data) {
    const game = data.game;
    if (!game || game.phase === 'over') return [];
    if (game.report) return game.report.eligible.filter((id) => !Object.hasOwn(game.report?.verdicts ?? {}, id));
    if (game.phase === 'comeback') return game.comeback === null ? [] : [game.comeback];
    if (game.phase === 'vote' || game.phase === 'revote') {
      return game.players
        .filter((player) => player.fate === 'alive' && !Object.hasOwn(game.pending, player.id))
        .filter((player) => game.phase !== 'revote' || !game.tied.includes(player.id))
        .map((player) => player.id);
    }
    return game.speaker === null ? [] : [game.speaker];
  },

  // Everyone who played in the game, those who left included (docs/architecture.md#replays), and
  // the setter, who took part in it without playing.
  participants: (data, ctx) => (data.game ? data.game.players.map((player) => ctx.keyOf(player.id)) : []),
  contributors: (data, ctx) => (data.game?.source.kind === 'setter' ? [ctx.keyOf(data.game.source.setter)] : []),
  // The words a setter gave, for the word library (docs/architecture.md#content-contributions).
  content(setup) {
    const { source, words } = setup as ImpostorSetup;
    if (source.kind !== 'setter') return null;
    return {
      kind: 'pair',
      content: { words: [words.student, words.reviewer2], field: source.field },
      author: source.setter,
      named: source.named,
    };
  },
  setupPaths: { pair: '$.source.pair', setter: '$.source.setter' },

  // An AI player takes a place at the table in the waiting room, once a person has.
  seatAgent(data, ctx, playerId) {
    if (data.game && data.game.phase !== 'over') return fail('wrong_phase');
    if (!data.seats.some((id) => ctx.agentOf(id) === null)) return { ok: false, error: 'needs_human' };
    if (data.seats.length >= MAX_PLAYERS) return { ok: false, error: 'table_full' };
    return { ok: true, data: { ...data, seats: [...data.seats, playerId] } };
  },

  practice: practiceSeats,
  agentTask,
  agentMove: (data, _ctx, _playerId, task, answer, made) => agentMove(data, task, answer, made),

  views(data, ctx) {
    const at = ctx.now();
    const setter = setterOf(data, ctx);
    const shared = {
      settings: { ...data.settings },
      seats: [...data.seats],
      startProblems: ctx.phase === 'lobby' ? problemsOf(data, ctx) : [],
      mayEmote: !data.game || data.game.phase === 'over',
    };
    return (viewer) => {
      const own = 'playerId' in viewer && viewer.playerId === setter ? wordsOf(data, ctx) : null;
      const game = data.game;
      return {
        ...shared,
        setterWords: own && { a: own.a, b: own.b, field: own.field, named: own.named },
        game:
          game &&
          viewOf(
            game,
            watcherOf(viewer, game.source.kind === 'setter' ? game.source.setter : null, game.settings.godView, game),
            at,
          ),
      };
    };
  },
};
