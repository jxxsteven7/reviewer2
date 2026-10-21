import { MAX_AGENT_REASON, type AgentNote, type AgentReply, type AgentRequest } from '@reviewer2/shared';
import {
  checkClue,
  cleanClue,
  clueCounts,
  clueOptions,
  normalizeClue,
  type AgentCandidate,
  type AgentGame,
  type CardColor,
  type ClueCount,
  type ClueMatch,
} from '@reviewer2/shared/keywords';
import { ModelError, type Model } from './model';
import type { Persona } from './personas';
import { CLUE_SCHEMA, clueSystem, clueUser, GUESS_SCHEMA, guessSystem, guessUser, PROMPT_VERSION } from './prompts';

// How the agent plays a turn of the team word guessing game (docs/games/keywords.md): a clue as a
// group's PI, or the cards to reveal as one of its students. The model only proposes; the agent
// holds every clue against the rules of the room, with the same check that the game server runs
// (checkClue), and every card against the board, so that what it answers is something the server
// takes. The server checks it all again anyway.

export type ClueRequest = Extract<AgentRequest, { kind: 'clue' }>;
export type GuessRequest = Extract<AgentRequest, { kind: 'guess' }>;

// What a turn needs besides the request: the model, the persona that plays, the signal that ends
// the wait, and the clock that the note's time is read from.
export interface Turn {
  model: Model;
  persona: Persona;
  signal: AbortSignal;
  now: () => number;
}

// How many clues the model is asked for at a time, and how many times: twice more, with the clues
// that the rules refused, when none so far would do.
const CANDIDATES = 3;
const TRIES = 3;
// The most cards that a student lists for a clue of 0 or "unlimited", which says nothing of how
// many cards it links.
const OPEN_LIMIT = 3;

// The longest clue that a note keeps of what the model wrote (AGENT_REPLY).
const MAX_NOTED = 200;

const ownLeft = (game: AgentGame) => game.cards.filter((card) => card.color === game.team && !card.revealed).length;

// The cards of the group's own that a clue may be meant for: each of them once, and still to be
// found. The model's numbers are whatever it wrote, so anything else is left out.
function ownTargets(game: AgentGame, targets: unknown): number[] {
  if (!Array.isArray(targets)) return [];
  const own = targets.filter(
    (card): card is number =>
      Number.isInteger(card) && game.cards[card]?.color === game.team && !game.cards[card]?.revealed,
  );
  return [...new Set(own)];
}

// One clue that the model proposed, judged: `clean` when it breaks no rule even under the strict
// clue rule and brings up no warning, `legal` when the rules of the room take it, which under the
// loose rule may come with a warning. A clue that was given before in the game, that aims at none
// of the group's cards, or at more than the persona does (`max`), is neither: a model told that a
// clue may link more cards once in a while names nearly all of them, which no clue can carry, and
// the targets it named stay in the note as they were. `conflict` is the card that a clue on the
// board runs into.
interface Judged {
  candidate: AgentCandidate;
  clean: boolean;
  legal: boolean;
  conflict: ClueMatch | null;
}

function judge(game: AgentGame, proposed: unknown, max: number): Judged | null {
  if (typeof proposed !== 'object' || proposed === null) return null;
  const { clue, targets: wanted } = proposed as { clue?: unknown; targets?: unknown };
  if (typeof clue !== 'string') return null;
  const word = cleanClue(clue);
  const targets = ownTargets(game, wanted);
  // The number goes with the cards that the clue is really meant for, within what the room allows:
  // under the free rule, no more than the cards the group has left.
  const allowed = clueCounts(game.settings.guessRule, ownLeft(game)).filter((n): n is number => n !== 'unlimited');
  const count = Math.min(targets.length, Math.max(0, ...allowed));
  const options = clueOptions(game.settings, game.language);
  const room = checkClue(word, game.cards, options);
  const strict = options.strict ? room : checkClue(word, game.cards, { ...options, strict: true });
  const given = game.clues.some((earlier) => normalizeClue(earlier.word) === normalizeClue(word));
  let problem: string | null = room.problem;
  if (problem === null && given) problem = 'clue_given';
  if (problem === null && count === 0) problem = 'no_targets';
  if (problem === null && targets.length > max) problem = 'too_many_targets';
  const legal = problem === null;
  const clean = legal && strict.problem === null && strict.similar.length === 0;
  if (legal && !clean) problem = 'clue_similar';
  return {
    candidate: { word: word.slice(0, MAX_NOTED), count, targets, problem },
    clean,
    legal,
    conflict: room.problem === 'clue_on_board' ? room.conflict : null,
  };
}

// Why a clue was refused, as the model is told when it is asked again.
const WHY: Record<string, string> = {
  clue_empty: 'it is empty',
  clue_not_one_word: 'it is not one word',
  clue_too_many_words: 'it has too many words',
  clue_too_long: 'it is too long',
  clue_on_board: 'it is on the board, or too close to a word on it',
  clue_given: 'it was given before',
  no_targets: "it aims at none of our group's cards that are still to be found",
};

// How a clue on the board runs into the card, so that the model is told which card to keep clear
// of: in a Chinese room, mostly a character that the clue shares with a word on the board.
const RUNS_INTO: Record<ClueMatch['kind'], string> = {
  same: 'repeats',
  form: 'is a form of',
  character: 'shares or names a character of',
  similar: 'is too close to',
  inside: 'contains',
  prefix: 'starts like',
  letters: 'spells part of',
};

function why({ candidate, conflict }: Judged, max: number): string {
  if (conflict) return `it ${RUNS_INTO[conflict.kind]} card ${conflict.card} (${conflict.text})`;
  if (candidate.problem === 'too_many_targets') {
    return `it aims at ${candidate.targets.length} cards, more than the ${max} that your students can follow`;
  }
  return WHY[candidate.problem as string] ?? 'the rules refused it';
}

// The cards that a student would reveal for a clue, in the order given: each of them once, still
// covered, and no more than `limit`.
function covered(game: AgentGame, picks: unknown, limit: number): number[] {
  if (!Array.isArray(picks)) return [];
  const open = picks.filter(
    (card): card is number => Number.isInteger(card) && game.cards[card] !== undefined && !game.cards[card].revealed,
  );
  return [...new Set(open)].slice(0, limit);
}

// The one sentence of a reason, in one line and no longer than an answer may carry.
function sentence(reason: unknown): string {
  if (typeof reason !== 'string') return '';
  return [...reason.replace(/\s+/g, ' ').trim()].slice(0, MAX_AGENT_REASON).join('');
}

// How many cards a student lists for a clue: as many as its number, and never the one guess more
// that the standard rule allows, which a steady player leaves alone; no more than the guesses the
// group has left, if they are limited; and a few for a number that says nothing.
function limitFor(clue: { count: ClueCount }, guessesLeft: number | null): number {
  const count = clue.count === 'unlimited' || clue.count === 0 ? OPEN_LIMIT : clue.count;
  return Math.max(1, Math.min(count, guessesLeft ?? count));
}

// Why a turn came to nothing: the model's service is gone (`model_failed`), or the model gave
// nothing usable in the time there was (`no_answer`).
const failed = (note: AgentNote, error: 'model_failed' | 'no_answer'): AgentReply => ({ ok: false, error, note });

// What a failure of the model makes of the turn. The wait running out comes first: the service's
// own error then says only that the request was cut short.
function failure(error: unknown, note: AgentNote, signal: AbortSignal): AgentReply {
  if (signal.aborted) return failed(note, 'no_answer');
  if (error instanceof ModelError) return failed(note, error.service ? 'model_failed' : 'no_answer');
  throw error;
}

// The cards that a student would reveal: the model's picks, of which there is at least one, since a
// group that has revealed no card yet can't pass; and the reason, in a sentence.
async function picksFor(
  game: AgentGame,
  clue: { word: string; count: ClueCount },
  limit: number,
  turn: Turn,
): Promise<{ picks: number[]; reason: string } | null> {
  const answer = await turn.model.ask(
    {
      system: guessSystem(game, turn.persona, limit),
      user: guessUser(game, clue),
      name: 'guess',
      schema: GUESS_SCHEMA,
      temperature: turn.persona.temperature,
    },
    turn.signal,
  );
  const picks = covered(game, answer.picks, limit);
  return picks.length > 0 ? { picks, reason: sentence(answer.reason) } : null;
}

export async function guess(request: GuessRequest, turn: Turn): Promise<AgentReply> {
  const started = turn.now();
  const note = (): AgentNote<AgentCandidate> => ({
    model: turn.model.name,
    prompt: PROMPT_VERSION,
    ms: Math.round(turn.now() - started),
  });
  try {
    const found = await picksFor(request, request.clue, limitFor(request.clue, request.guessesLeft), turn);
    // A model that named no card that is still covered gave no answer to go by.
    if (!found) return failed(note(), 'no_answer');
    return {
      ok: true,
      kind: 'guess',
      picks: found.picks,
      reason: found.reason,
      note: { ...note(), reason: found.reason },
    };
  } catch (error) {
    return failure(error, note(), turn.signal);
  }
}

// How the guesses of a rehearsal go: the student reveals its picks in order, as many as the clue's
// number, and stops at the first card that isn't the group's own.
function rehearse(game: AgentGame, picks: number[], count: number): NonNullable<AgentCandidate['rehearsal']> {
  let found = 0;
  let stop: CardColor | null = null;
  for (const card of picks.slice(0, count)) {
    const color = game.cards[card]?.color ?? null;
    if (color !== game.team) {
      stop = color;
      break;
    }
    found += 1;
  }
  return { picks, found, stop };
}

// How a rehearsal ranks: one that stops by itself or at a neutral card is safe; one that runs into
// the other group's card is worse, and Reviewer 2 worst of all. Among equals, the more of the
// group's cards found the better.
function danger(stop: CardColor | null, team: string): number {
  if (stop === 'reviewer2') return 2;
  return stop !== null && stop !== 'neutral' && stop !== team ? 1 : 0;
}

export async function giveClue(request: ClueRequest, turn: Turn): Promise<AgentReply> {
  const started = turn.now();
  const considered: AgentCandidate[] = [];
  const note = (): AgentNote<AgentCandidate> => ({
    model: turn.model.name,
    prompt: PROMPT_VERSION,
    ms: Math.round(turn.now() - started),
    candidates: considered,
  });
  // The clues that the rules refused, with what was wrong and why, which the model is told when it
  // is asked again.
  const refused: { word: string; problem: string; why: string }[] = [];
  const { max } = turn.persona.targets;
  try {
    let chosen: Judged[] = [];
    for (let attempt = 0; attempt < TRIES && chosen.length === 0; attempt += 1) {
      const answer = await turn.model.ask(
        {
          system: clueSystem(request, turn.persona),
          user: clueUser(request, refused),
          name: 'clue',
          schema: CLUE_SCHEMA,
          temperature: turn.persona.temperature,
        },
        turn.signal,
      );
      const proposed = Array.isArray(answer.candidates) ? answer.candidates.slice(0, CANDIDATES) : [];
      const judged = proposed.map((candidate) => judge(request, candidate, max)).filter((found) => found !== null);
      considered.push(...judged.map(({ candidate }) => candidate));
      for (const found of judged) {
        const { problem, word } = found.candidate;
        if (problem !== null && problem !== 'clue_similar') refused.push({ word, problem, why: why(found, max) });
      }
      // The clean clues if there are any, else those that the room's rules take with a warning.
      const clean = judged.filter(({ clean }) => clean);
      chosen = clean.length > 0 ? clean : judged.filter(({ legal }) => legal);
    }
    if (chosen.length === 0) return { ok: false, error: 'no_legal_clue', note: note() };
    const best = turn.persona.rehearse ? await rehearsed(request, chosen, turn) : chosen[0];
    const { word, count, targets } = (best ?? (chosen[0] as Judged)).candidate;
    return { ok: true, kind: 'clue', word, count, targets, note: note() };
  } catch (error) {
    return failure(error, note(), turn.signal);
  }
}

// Has each clue guessed first, by the model playing a student who sees what the group's students
// see, and gives back the one whose guesses go best (danger()), the earlier among equals. A
// rehearsal that the model can't answer ends the rehearsals, and the first clue is given as it
// would have been without them, unless the time is up.
async function rehearsed(request: ClueRequest, chosen: Judged[], turn: Turn): Promise<Judged | undefined> {
  const students = {
    ...request,
    cards: request.cards.map(({ color, ...card }) => (card.revealed ? { ...card, color } : card)),
  };
  const tried: Judged[] = [];
  for (const judged of chosen) {
    const { candidate } = judged;
    let found: { picks: number[] } | null;
    try {
      found = await picksFor(students, { word: candidate.word, count: candidate.count }, candidate.count, turn);
    } catch (error) {
      if (turn.signal.aborted || !(error instanceof ModelError)) throw error;
      return chosen[0];
    }
    candidate.rehearsal = rehearse(request, found?.picks ?? [], candidate.count);
    tried.push(judged);
  }
  const rank = ({ candidate }: Judged) => {
    const { found, stop } = candidate.rehearsal ?? { found: 0, stop: null };
    return danger(stop, request.team) * 100 - found;
  };
  return tried.reduce((best, next) => (rank(next) < rank(best) ? next : best), tried[0] as Judged);
}
