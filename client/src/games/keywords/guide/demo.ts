import { type Language } from '@reviewer2/shared';
import {
  defaultSettings,
  type CardColor,
  type ClueRecord,
  type KeywordsRoomData,
  type KeywordsView,
  type Mark,
  type Seat,
  type StartProblem,
  type Team,
} from '@reviewer2/shared/keywords';
import type { SpotTarget } from '../../../core/guide/spot';
import type { ShownPlayer, ShownRoom } from '../../../core/room';
import type { Chooser } from '../useKeywords';

// The invented game that the tutorial's chapters on the first game play through
// (docs/architecture.md#the-tutorial): its board, and what each step of "Playing a student" and
// "Playing the PI" shows of it. The words, the clues and the names are in the locale files, under
// guide.demo. The reader is Mira in the red group, the other seats are Reviewer 1's.
//
// The game, as the student sees it: red's PI gives "Astronomy, 3", and the students reveal Black
// hole, Telescope and Dark matter, an irrelevant paper; blue's "Statistics, 2" finds Variance and
// then Galaxy, a red card; red's "Biology, 3" finds Gene and Cell, and the students end the turn;
// blue's "Crunch, 2" reveals Deadline, Reviewer 2, and red is accepted. The PI sees the same game
// from the other seat.

export type Translate = (key: string) => string;

const R: CardColor = 'red';
const B: CardColor = 'blue';
const N: CardColor = 'neutral';
const X: CardColor = 'reviewer2';
// Whose each card is, by its place on the board: red has 9 and starts, blue has 8.
export const COLORS: readonly CardColor[] = [R, N, R, B, B, R, B, X, R, N, B, N, R, B, N, N, R, B, N, B, N, R, B, R, R];

// The cards that the story turns on, by their place on the board.
export const CARDS = {
  blackHole: 0,
  gene: 2,
  variance: 3,
  telescope: 5,
  deadline: 7,
  cell: 8,
  darkMatter: 11,
  galaxy: 12,
  pValue: 22,
} as const;

// What each turn revealed, in order.
const TURN_1 = [CARDS.blackHole, CARDS.telescope, CARDS.darkMatter];
const TURN_2 = [CARDS.variance, CARDS.galaxy];
const TURN_3 = [CARDS.gene, CARDS.cell];
const TURN_4 = [CARDS.deadline];

// The cards that each clue was meant for.
const ASTRONOMY = [CARDS.blackHole, CARDS.telescope, CARDS.galaxy];
const BIOLOGY = [CARDS.gene, CARDS.cell, 16];

export const cardSpot = (index: number, finger: SpotTarget['finger']): SpotTarget => ({
  selector: `.board > .card:nth-child(${index + 1})`,
  finger,
});

export const ME = 'me';
const RED_PI = 'r1-red-pi';
const RED_STUDENT = 'r1-red-student';

export interface Demo {
  words: string[];
  clue: (key: 'astro' | 'stats' | 'bio' | 'crunch') => string;
  me: string;
  reviewer1: string;
}

export function demoOf(t: Translate): Demo {
  return {
    words: COLORS.map((_, index) => t(`guide.demo.words.${index}`)),
    clue: (key) => t(`guide.demo.clues.${key}`),
    me: t('guide.demo.me'),
    reviewer1: t('agents.personas.reviewer1'),
  };
}

interface Board {
  revealed?: readonly number[];
  // Whether the viewer sees every color, as a PI does.
  captain?: boolean;
}

// A view of the game: its board as the viewer sees it, and how many cards each group still has
// to find, with what else the step gives.
function view(demo: Demo, { revealed = [], captain = false }: Board, rest: Partial<KeywordsView>): KeywordsView {
  const shown = new Set(revealed);
  const left = (team: Team) => COLORS.filter((color, index) => color === team && !shown.has(index)).length;
  return {
    gameId: 'guide',
    turn: 1,
    team: 'red',
    phase: 'guess',
    startingTeam: 'red',
    cards: demo.words.map((word, index) => ({
      word,
      revealed: shown.has(index),
      // Once the game is over, everyone sees every color.
      ...(captain || shown.has(index) || rest.result ? { color: COLORS[index] } : {}),
    })),
    paused: false,
    remaining: { red: left('red'), blue: left('blue') },
    clue: null,
    guessesMade: 0,
    guessesLeft: null,
    clock: null,
    history: [],
    events: [],
    extended: { red: false, blue: false },
    result: null,
    ...rest,
  };
}

function record(
  turn: number,
  team: Team,
  word: string,
  count: number,
  guesses: readonly number[],
  targets: number[],
): ClueRecord {
  const player = team === 'red' ? RED_STUDENT : 'r1-blue-student';
  return {
    turn,
    team,
    word,
    count,
    at: 0,
    captain: team === 'red' ? RED_PI : 'r1-blue-pi',
    targets,
    guesses: guesses.map((card) => ({ card, color: COLORS[card] ?? 'neutral', player, at: 0 })),
  };
}

// The whole game, clue by clue, as the clue log shows it once it is over.
function history(demo: Demo): ClueRecord[] {
  return [
    record(1, 'red', demo.clue('astro'), 3, TURN_1, ASTRONOMY),
    record(2, 'blue', demo.clue('stats'), 2, TURN_2, [CARDS.variance, CARDS.pValue]),
    record(3, 'red', demo.clue('bio'), 3, TURN_3, BIOLOGY),
    record(4, 'blue', demo.clue('crunch'), 2, TURN_4, [4, 13]),
  ];
}

const OVER = { winner: 'red', reason: 'reviewer2' } as const;

// What the play area under the board holds: the guess bar, a line on what the game waits for, the
// line on how to mark cards, the PI's clue or draft of one, or, once the game is over, the clue log
// in place of the board.
export type Panel = 'guess' | 'waiting' | 'marking' | 'clue' | 'draft' | 'log';

export interface PlayStep {
  role: 'captain' | 'guesser';
  view: KeywordsView;
  panel: Panel;
  // The viewer's choice, and the others' choices on each card.
  selected?: number | null;
  choosers?: Chooser[][];
  // The group's marks.
  marks?: ReadonlyMap<number, Mark>;
  // The cards the PI means with the clue they write, and the clue as it stands.
  targets?: number[];
  word?: string;
  // The card that has just been revealed, which turns over.
  turned?: number | null;
  spot: SpotTarget | null;
}

const REVEAL: SpotTarget = { selector: '.guess-bar .button.primary', finger: 'tap' };
const END_TURN: SpotTarget = { selector: '.guess-bar .buttons .button:nth-child(2)', finger: 'tap' };

export function studentStep(demo: Demo, step: number): PlayStep {
  const astro = { word: demo.clue('astro'), count: 3 };
  const theirs = new Map<number, Mark>([[CARDS.pValue, 'theirs']]);
  const base = { role: 'guesser' as const };
  switch (step) {
    case 1:
      return {
        ...base,
        view: view(demo, {}, { phase: 'clue' }),
        panel: 'waiting',
        spot: { selector: '.strip .score.red .pi', finger: 'point' },
      };
    case 2:
      return {
        ...base,
        view: view(demo, {}, { clue: astro }),
        panel: 'guess',
        spot: { selector: '.strip .clue .word', finger: 'point' },
      };
    case 3:
      return { ...base, view: view(demo, {}, { clue: astro }), panel: 'guess', spot: cardSpot(CARDS.blackHole, 'tap') };
    case 4:
      return {
        ...base,
        view: view(demo, {}, { clue: astro }),
        panel: 'guess',
        selected: CARDS.blackHole,
        spot: REVEAL,
      };
    case 5:
      return {
        ...base,
        view: view(demo, { revealed: [CARDS.blackHole] }, { clue: astro, guessesMade: 1 }),
        panel: 'guess',
        turned: CARDS.blackHole,
        spot: cardSpot(CARDS.telescope, 'tap'),
      };
    case 6:
      return {
        ...base,
        view: view(demo, { revealed: [CARDS.blackHole, CARDS.telescope] }, { clue: astro, guessesMade: 2 }),
        panel: 'guess',
        selected: CARDS.darkMatter,
        turned: CARDS.telescope,
        spot: REVEAL,
      };
    case 7:
      return {
        ...base,
        view: view(demo, { revealed: TURN_1 }, { team: 'blue', turn: 2, phase: 'clue' }),
        panel: 'waiting',
        turned: CARDS.darkMatter,
        spot: cardSpot(CARDS.darkMatter, 'point'),
      };
    case 8:
      return {
        ...base,
        view: view(demo, { revealed: TURN_1 }, { team: 'blue', turn: 2, clue: { word: demo.clue('stats'), count: 2 } }),
        panel: 'marking',
        spot: cardSpot(CARDS.pValue, 'hold'),
      };
    case 9:
      return {
        ...base,
        view: view(demo, { revealed: [...TURN_1, ...TURN_2] }, { turn: 3, phase: 'clue' }),
        panel: 'waiting',
        marks: theirs,
        turned: CARDS.galaxy,
        spot: cardSpot(CARDS.galaxy, 'point'),
      };
    case 10:
      return {
        ...base,
        view: view(
          demo,
          { revealed: [...TURN_1, ...TURN_2, ...TURN_3] },
          { turn: 3, clue: { word: demo.clue('bio'), count: 3 }, guessesMade: 2 },
        ),
        panel: 'guess',
        marks: theirs,
        turned: CARDS.cell,
        spot: END_TURN,
      };
    case 11:
      return {
        ...base,
        view: view(
          demo,
          { revealed: [...TURN_1, ...TURN_2, ...TURN_3, ...TURN_4] },
          { team: 'blue', turn: 4, phase: 'over', result: OVER },
        ),
        panel: 'marking',
        marks: theirs,
        turned: CARDS.deadline,
        spot: cardSpot(CARDS.deadline, 'point'),
      };
    default:
      return {
        ...base,
        view: view(
          demo,
          { revealed: [...TURN_1, ...TURN_2, ...TURN_3, ...TURN_4] },
          { team: 'blue', turn: 4, phase: 'over', result: OVER, history: history(demo) },
        ),
        panel: 'log',
        spot: null,
      };
  }
}

export function piStep(demo: Demo, step: number): PlayStep {
  const astro = { word: demo.clue('astro'), count: 3 };
  const base = { role: 'captain' as const };
  const board = { captain: true };
  switch (step) {
    case 1:
      return {
        ...base,
        view: view(demo, board, { phase: 'clue' }),
        panel: 'clue',
        spot: cardSpot(CARDS.deadline, 'point'),
      };
    case 2:
      return {
        ...base,
        view: view(demo, board, { phase: 'clue' }),
        panel: 'clue',
        targets: [CARDS.blackHole, CARDS.telescope],
        spot: cardSpot(CARDS.galaxy, 'tap'),
      };
    case 3:
      return {
        ...base,
        view: view(demo, board, { phase: 'clue' }),
        panel: 'clue',
        targets: ASTRONOMY,
        word: demo.words[CARDS.galaxy],
        spot: { selector: '.clue-panel input.word', finger: 'point' },
      };
    case 4:
      return {
        ...base,
        view: view(demo, board, { phase: 'clue' }),
        panel: 'clue',
        targets: ASTRONOMY,
        word: demo.clue('astro'),
        spot: { selector: '.clue-panel .button.primary', finger: 'tap' },
      };
    case 5:
      return {
        ...base,
        view: view(demo, board, { clue: astro }),
        panel: 'draft',
        choosers: COLORS.map((_, index) =>
          index === CARDS.blackHole ? [{ name: demo.reviewer1, agent: 'reviewer1', online: true }] : [],
        ),
        spot: cardSpot(CARDS.blackHole, 'point'),
      };
    case 6:
      return {
        ...base,
        view: view(
          demo,
          { ...board, revealed: TURN_1 },
          { team: 'blue', turn: 2, clue: { word: demo.clue('stats'), count: 2 } },
        ),
        panel: 'draft',
        targets: BIOLOGY,
        word: demo.clue('bio'),
        spot: { selector: '.clue-panel input.word', finger: 'point' },
      };
    case 7:
      return {
        ...base,
        view: view(
          demo,
          { ...board, revealed: [...TURN_1, ...TURN_2] },
          { turn: 3, phase: 'clue', clock: { left: 71_000, total: 90_000 } },
        ),
        panel: 'clue',
        targets: BIOLOGY,
        word: demo.clue('bio'),
        spot: { selector: '.strip .clock .seconds', finger: 'point' },
      };
    default:
      return {
        ...base,
        view: view(
          demo,
          { ...board, revealed: [...TURN_1, ...TURN_2, ...TURN_3, ...TURN_4] },
          { team: 'blue', turn: 4, phase: 'over', result: OVER, history: history(demo) },
        ),
        panel: 'log',
        spot: null,
      };
  }
}

// The players of the invented rooms: the reader, three friends of theirs, and Reviewer 1.
export function demoPlayers(t: Translate): ShownPlayer[] {
  const friend = (id: 'ava' | 'theo' | 'lin') => ({
    id,
    name: t(`guide.demo.friends.${id}`),
    username: id,
    online: true,
  });
  return [
    { id: ME, name: t('guide.demo.me'), username: 'mira', online: true },
    friend('ava'),
    friend('theo'),
    friend('lin'),
  ];
}

interface RoomOptions {
  seats: Record<string, Seat>;
  game?: KeywordsView | null;
  chairId?: string;
  agents?: boolean;
  startProblems?: StartProblem[];
  players?: ShownPlayer[];
}

// An invented room in the language `language`, for the parts of the tutorial that show the waiting
// room or a game with its group chat. Its code is the one that the tutorial gives as an example.
export function demoRoom(t: Translate, language: Language, options: RoomOptions): ShownRoom {
  const data: KeywordsRoomData = {
    settings: defaultSettings(language),
    seats: options.seats,
    keyViewers: [],
    side: null,
    lineup: 'free',
    joinsNext: false,
    startProblems: options.startProblems ?? [],
    mayEmote: true,
    game: options.game ?? null,
    titles: {},
  };
  return {
    roomId: 'guide',
    code: 'K7QX',
    rev: 1,
    game: 'keywords',
    language,
    fields: ['general'],
    randomFields: false,
    public: false,
    customWordCount: 0,
    phase: options.game ? 'playing' : 'lobby',
    round: options.game ? 1 : 0,
    gameId: options.game ? 'guide' : null,
    chairId: options.chairId ?? ME,
    players: options.players ?? demoPlayers(t),
    agents: options.agents ?? false,
    screens: 0,
    me: ME,
    match: null,
    streaks: [],
    duos: [],
    agentsPlayed: false,
    points: [],
    data,
  };
}
