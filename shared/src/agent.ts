import type { KeywordsAgentReply, KeywordsAgentRequest } from './games/keywords/agent';

// What the game server asks the agent for, and what it answers (docs/architecture.md#the-agent).
// The agent is a separate program that plays for the AI players, Reviewer 1 among them: it holds
// the address of the language model and asks it, so that the game server needs no network for it,
// as with the mailer. One request goes on one line of JSON over a Unix socket, and one answer comes
// back on one line.
//
// The agent knows no more than the seat it plays for: the server builds every request from that
// seat's own view of the game (GameModule.views), so that an AI student is never told the colors
// that a student can't see. Each game has requests and answers of its own, in its folder (for the
// team word guessing game, games/keywords/agent.ts), each of a kind that no other game's has, and
// the agent answers each with the game's own code.

// The AI players that the agent can play as. Each has its own way of playing, which the agent
// keeps; the server knows them by these names only, and the interface names them in its locale
// files.
export const AGENT_PERSONAS = ['reviewer1'] as const;
export type AgentPersona = (typeof AGENT_PERSONAS)[number];

// The page of an AI player (docs/architecture.md#ai-players), which anyone may open from a room:
// player number 0, how many of it are in the rooms right now, as AI players and playing for
// someone offline, and what it has done in the games of each game that finished, by the game's ID,
// as counts only.
export interface AgentProfileView {
  persona: AgentPersona;
  number: 0;
  live: { players: number; rooms: number };
  games: Record<string, AgentGameCounts>;
}

// What an AI player has done in the games of one game that finished. `games` counts each game once;
// `seats` and `wins` count the seats it took in them and those it won in, since it may sit in two
// groups of one game, as it does in a practice room, where counting the game as won whenever one of
// its seats won would make it win every one; `roles` counts the same in each of the game's roles, by
// the role's ID. `takeovers` is how many games it played in for someone offline. `feats` is what the
// game counts of its seats, added up as the game adds them up (for the team word guessing game,
// KeywordsAgentFeats). `you` is what the viewer has played with it, for an account alone: the games
// in which it was on the viewer's side and they won or lost together, those in which it was on
// another and the viewer finished in a better place or a worse one, and how often it played for
// the viewer while they were offline.
export interface AgentGameCounts {
  games: number;
  seats: number;
  wins: number;
  roles: Record<string, { seats: number; wins: number }>;
  takeovers: number;
  feats: unknown;
  you: { wonTogether: number; lostTogether: number; beat: number; beaten: number; takenOver: number } | null;
}

// What an AI player has done in a game it has played none of, with what the viewer has played with
// it, if the viewer is an account.
export const emptyAgentCounts = (you: AgentGameCounts['you'] = null): AgentGameCounts => ({
  games: 0,
  seats: 0,
  wins: 0,
  roles: {},
  takeovers: 0,
  feats: null,
  you,
});

// What every request but a ping says besides the game's own: the persona that is to play, and
// `waitMs`, how long the server waits for the answer, after which nobody needs it: the agent gives
// up on a request that it hasn't answered by then.
export interface AgentAsked {
  v: 1;
  persona: AgentPersona;
  waitMs: number;
}

export type AgentRequest = { v: 1; kind: 'ping' } | KeywordsAgentRequest;

// A request as a game puts it for one of its seats (GameModule.agentTask on the server), which the
// server completes with the version, the persona and the wait.
type Unasked<Request> = Request extends unknown ? Omit<Request, keyof AgentAsked> : never;
export type AgentQuestion = Unasked<Exclude<AgentRequest, { kind: 'ping' }>>;

// How the agent came to its answer, which the server keeps with the record of the game
// (docs/architecture.md#game-records) and never shows anyone: the model and the version of the
// prompts that it asked, how long that took, what it considered, in the game's own shape, such as
// the clues of the team word guessing game (AgentCandidate), and the reason it gave in a sentence.
export interface AgentNote<Candidate = unknown> {
  model: string;
  prompt: string;
  ms: number;
  candidates?: Candidate[];
  reason?: string;
}

// The errors that any request may get, for the server to read alike: a request that the agent
// can't read, too many waiting before it, a model whose service can't be reached or refuses, which
// the server takes as the AI players being offline, a model that answered nothing usable in time,
// which is this request's bad luck alone, or no move that the rules of the room take
// (`no_legal_move`; the team word guessing game said `no_legal_clue` before there was a second
// game, and the AI's logs of its games still say so).
export const AGENT_ERRORS = [
  'bad_request',
  'busy',
  'model_failed',
  'no_answer',
  'no_legal_clue',
  'no_legal_move',
] as const;
export type AgentError = (typeof AGENT_ERRORS)[number];

// The answer to a request, in the game's own shape, or why there is none.
export type AgentReply =
  { ok: true; kind: 'ping'; model: string } | KeywordsAgentReply | { ok: false; error: AgentError; note?: AgentNote };

// An answer to one of a game's requests, as the game turns it into its own messages.
export type AgentAnswer = Exclude<Extract<AgentReply, { ok: true }>, { kind: 'ping' }>;

// The longest request and answer, as a line of JSON in bytes. A request carries the board with
// every term's translations and other forms.
export const MAX_AGENT_REQUEST = 64 * 1024;
export const MAX_AGENT_REPLY = 16 * 1024;
// The longest wait that a request may ask for, and the longest reason, in characters, that an
// answer may give.
export const MAX_AGENT_WAIT_MS = 60_000;
export const MAX_AGENT_REASON = 200;
