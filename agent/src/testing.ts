import { type AgentReply, type ReasoningLevel } from '@reviewer2/shared';
import type { ImpostorAgentGame } from '@reviewer2/shared/impostor';
import { defaultSettings, type CardColor, type CardView } from '@reviewer2/shared/keywords';
import { AGENT_REPLY } from '@reviewer2/shared/schemas';
import { expect } from 'vitest';
import type { ImpostorRequest } from './impostor';
import type { ClueRequest, GuessRequest } from './keywords';
import { ModelError, type Answer, type Model, type Question } from './model';

// What the agent's tests share: a board, requests on it, and a model that answers from a script.

// The red group's cards are 0 to 8, the blue group's 9 to 16, the neutral ones 17 to 23, and
// Reviewer 2 is 24.
export const WORDS = [
  'Gradient',
  'Tensor',
  'Kernel',
  'Matrix',
  'Vector',
  'Neuron',
  'Protein',
  'Enzyme',
  'Genome',
  'Photon',
  'Quark',
  'Plasma',
  'Orbit',
  'Comet',
  'Galaxy',
  'Nebula',
  'Pulsar',
  'Thesis',
  'Seminar',
  'Grant',
  'Tenure',
  'Lecture',
  'Syllabus',
  'Campus',
  'Rejection',
];

export function colorOf(card: number): CardColor {
  if (card < 9) return 'red';
  if (card < 17) return 'blue';
  return card < 24 ? 'neutral' : 'reviewer2';
}

// The board as a PI sees it, with every color, and as a student sees it, with the colors of the
// revealed cards only.
export function captainCards(revealed: readonly number[] = []): CardView[] {
  return WORDS.map((word, card) => ({ word, revealed: revealed.includes(card), color: colorOf(card) }));
}

export function studentCards(revealed: readonly number[] = []): CardView[] {
  return WORDS.map((word, card) =>
    revealed.includes(card) ? { word, revealed: true, color: colorOf(card) } : { word, revealed: false },
  );
}

export const clueRequest = (changes: Partial<ClueRequest> = {}): ClueRequest => ({
  v: 1,
  kind: 'clue',
  persona: 'reviewer1',
  waitMs: 10_000,
  game: 'keywords',
  language: 'en',
  settings: defaultSettings('en'),
  team: 'red',
  cards: captainCards(),
  clues: [],
  ...changes,
});

export const guessRequest = (changes: Partial<GuessRequest> = {}): GuessRequest => ({
  v: 1,
  kind: 'guess',
  persona: 'reviewer1',
  waitMs: 10_000,
  game: 'keywords',
  language: 'en',
  settings: defaultSettings('en'),
  team: 'red',
  cards: studentCards(),
  clues: [{ team: 'red', word: 'Biology', count: 2 }],
  clue: { word: 'Biology', count: 2 },
  guessesLeft: null,
  ...changes,
});

// A game of the hidden word game of five, as player 2 sees it in the second round: its word is the
// apple; player 4 was voted out in the first round, a student; player 1's line ran out of time.
export function impostorRequest<Kind extends ImpostorRequest['kind']>(
  kind: Kind,
  changes: Partial<Extract<ImpostorRequest, { kind: Kind }>> = {},
): Extract<ImpostorRequest, { kind: Kind }> {
  const game: ImpostorAgentGame = {
    game: 'impostor',
    language: 'en',
    length: 60,
    number: 2,
    word: { word: 'apple', forms: ['apples'], translations: ['\u82f9\u679c'] },
    round: 2,
    seats: [1, 2, 3, 4, 5].map((number) => ({
      number,
      fate: number === 4 ? 'voted_out' : 'alive',
      role: number === 4 ? 'student' : null,
    })),
    lines: [
      { round: 1, number: 1, text: null, tie: false },
      { round: 1, number: 2, text: 'grows on a tree', tie: false },
      { round: 1, number: 3, text: 'sweet and crisp', tie: false },
      { round: 1, number: 5, text: 'often eaten raw', tie: false },
    ],
    ballots: [{ round: 1, ballot: 'vote', votes: { 1: 4, 2: 4, 3: 0, 5: -1 }, out: 4, tied: [] }],
    reports: [],
  };
  const asked = {
    describe: { tie: false },
    vote: { candidates: [1, 3, 5] },
    judge: { report: { by: 3, target: 5, text: 'often eaten raw', reason: 'It names the word' } },
    comeback: {},
  }[kind];
  const request = { v: 1, kind, persona: 'reviewer1', waitMs: 10_000, ...game, ...asked, ...changes };
  // TypeScript can't tell that the parts asked for go with the kind.
  return request as unknown as Extract<ImpostorRequest, { kind: Kind }>;
}

// What a scripted model thinks before it answers a question that lets it.
export const THOUGHT = 'Cards 6 and 7 are both about biology, and nothing else on the board is.';

// A model that answers each question with the next answer scripted for its kind, such as `clue` or
// `guess` (Question.name): an object, which it gives back, an error, which it throws, or a promise,
// which it waits for. It thinks at its level when a question lets it, and its answer then comes
// with THOUGHT. It keeps the questions it was asked.
export class ScriptedModel implements Model {
  readonly asked: Question[] = [];
  readonly answers: Record<string, unknown[]>;
  known = true;

  constructor(
    answers: Partial<Record<string, unknown[]>> = {},
    readonly name = 'scripted',
    readonly reasoning: ReasoningLevel = 'off',
  ) {
    this.answers = Object.fromEntries(Object.entries(answers).map(([kind, list]) => [kind, [...(list ?? [])]]));
  }

  async ask(question: Question, signal: AbortSignal): Promise<Answer> {
    this.asked.push(question);
    const thinking = question.think === true && this.reasoning !== 'off' ? THOUGHT : null;
    const next = this.answers[question.name]?.shift();
    if (next === undefined) throw new ModelError(`no answer left for ${question.name}`);
    if (next instanceof Error) throw next;
    if (next instanceof Promise) {
      const aborted = new Promise<never>((_, reject) =>
        signal.addEventListener('abort', () => reject(new ModelError('aborted', true)), { once: true }),
      );
      return { value: (await Promise.race([next, aborted])) as Record<string, unknown>, thinking };
    }
    return { value: next as Record<string, unknown>, thinking };
  }

  async ping(): Promise<boolean> {
    return this.known;
  }
}

// Every answer the agent gives must be one that the protocol allows, which the server reads with
// the same schema.
export function allowed(reply: AgentReply): AgentReply {
  expect(AGENT_REPLY.safeParse(reply).success, JSON.stringify(reply)).toBe(true);
  return reply;
}
