import { defaultSettings, type AgentReply, type CardColor, type CardView } from '@reviewer2/shared';
import { AGENT_REPLY } from '@reviewer2/shared/schemas';
import { expect } from 'vitest';
import type { ClueRequest, GuessRequest } from './keywords';
import { ModelError, type Model, type Question } from './model';

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

// A model that answers each question with the next answer scripted for its kind, `clue` or
// `guess`: an object, which it gives back, an error, which it throws, or a promise, which it waits
// for. It keeps the questions it was asked.
export class ScriptedModel implements Model {
  readonly asked: Question[] = [];
  readonly answers: Record<string, unknown[]>;
  known = true;

  constructor(
    answers: { clue?: unknown[]; guess?: unknown[] } = {},
    readonly name = 'scripted',
  ) {
    this.answers = { clue: [...(answers.clue ?? [])], guess: [...(answers.guess ?? [])] };
  }

  async ask(question: Question, signal: AbortSignal): Promise<Record<string, unknown>> {
    this.asked.push(question);
    const next = this.answers[question.name]?.shift();
    if (next === undefined) throw new ModelError(`no answer left for ${question.name}`);
    if (next instanceof Error) throw next;
    if (next instanceof Promise) {
      const aborted = new Promise<never>((_, reject) =>
        signal.addEventListener('abort', () => reject(new ModelError('aborted')), { once: true }),
      );
      return (await Promise.race([next, aborted])) as Record<string, unknown>;
    }
    return next as Record<string, unknown>;
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
