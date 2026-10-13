import type { CardColor, CardView, ClueCount, Team } from './games/keywords/types';
import type { KeywordsSettings } from './games/keywords/settings';
import type { Language } from './language';

// What the game server asks the agent for, and what it answers (docs/architecture.md#the-agent).
// The agent is a separate program that plays for the AI players, Reviewer 1 among them: it holds
// the address of the language model and asks it, so that the game server needs no network for it,
// as with the mailer. One request goes on one line of JSON over a Unix socket, and one answer comes
// back on one line.
//
// The agent knows no more than the seat it plays for: the server builds every request from that
// seat's own view of the game (GameModule.views), so that an AI student is never told the colors
// that a student can't see.

// The AI players that the agent can play as. Each has its own way of playing, which the agent
// keeps; the server knows them by these names only, and the interface names them in its locale
// files.
export const AGENT_PERSONAS = ['reviewer1'] as const;
export type AgentPersona = (typeof AGENT_PERSONAS)[number];

// A clue that a group was given earlier in the game, as everyone saw it.
export interface AgentClue {
  team: Team;
  word: string;
  count: ClueCount;
}

// What the agent needs to know of a game of the team word guessing game to play a turn in it: the
// room's language and settings, the group it plays for, the board as its seat sees it, and the
// clues so far, the oldest first, so that it doesn't give one again.
export interface AgentGame {
  game: 'keywords';
  language: Language;
  settings: KeywordsSettings;
  team: Team;
  cards: CardView[];
  clues: AgentClue[];
}

// `waitMs` is how long the server waits for the answer, after which nobody needs it: the agent
// gives up on a request that it hasn't answered by then.
export type AgentRequest =
  | { v: 1; kind: 'ping' }
  | ({ v: 1; kind: 'clue'; persona: AgentPersona; waitMs: number } & AgentGame)
  | ({
      v: 1;
      kind: 'guess';
      persona: AgentPersona;
      waitMs: number;
      // The clue that the group's PI gave, and how many cards the group may still reveal for it, or
      // null when there is no limit.
      clue: { word: string; count: ClueCount };
      guessesLeft: number | null;
    } & AgentGame);

// A request as a game puts it for one of its seats (GameModule.agentTask on the server), which the
// server completes with the version, the persona and the wait.
type Unasked<Request> = Request extends unknown ? Omit<Request, 'v' | 'persona' | 'waitMs'> : never;
export type AgentQuestion = Unasked<Exclude<AgentRequest, { kind: 'ping' }>>;

// One clue that the agent considered, with the cards it was meant for, and what the rules of the
// room said of it (checkClue), or null when they took it. When the agent had the clue guessed
// first, by the model playing a student, the rehearsal says which cards it would have revealed,
// how many of the group's own it found before it stopped, and the color of the card that stopped
// it, or null when it ran out of cards to reveal first.
export interface AgentCandidate {
  word: string;
  count: number;
  targets: number[];
  problem: string | null;
  rehearsal?: { picks: number[]; found: number; stop: CardColor | null };
}

// How the agent came to its answer, which the server keeps with the record of the game
// (docs/architecture.md#game-records) and never shows anyone: the model and the version of the
// prompts that it asked, how long that took, the clues it considered, and the reason it gave in a
// sentence.
export interface AgentNote {
  model: string;
  prompt: string;
  ms: number;
  candidates?: AgentCandidate[];
  reason?: string;
}

export const AGENT_ERRORS = ['bad_request', 'busy', 'model_failed', 'no_answer', 'no_legal_clue'] as const;
export type AgentError = (typeof AGENT_ERRORS)[number];

// The clue to give, with the cards it is meant for; the cards to reveal, the surest first, with
// the reason; or why there is no answer: a request that the agent can't read, too many waiting
// before it, a model whose service can't be reached or refuses, which the server takes as the AI
// players being offline, a model that answered nothing usable in time, which is this request's
// bad luck alone, or no clue that the rules of the room take.
export type AgentReply =
  | { ok: true; kind: 'ping'; model: string }
  | { ok: true; kind: 'clue'; word: string; count: number; targets: number[]; note: AgentNote }
  | { ok: true; kind: 'guess'; picks: number[]; reason: string; note: AgentNote }
  | { ok: false; error: AgentError; note?: AgentNote };

// An answer to a clue or a guess, as a game turns it into its own messages.
export type AgentAnswer = Extract<AgentReply, { ok: true; kind: 'clue' | 'guess' }>;

// The longest request and answer, as a line of JSON in bytes. A request carries the board with
// every term's translations and other forms.
export const MAX_AGENT_REQUEST = 64 * 1024;
export const MAX_AGENT_REPLY = 16 * 1024;
// The longest wait that a request may ask for, and the longest reason, in characters, that an
// answer may give.
export const MAX_AGENT_WAIT_MS = 60_000;
export const MAX_AGENT_REASON = 200;
