import type { AgentAsked, AgentNote } from '../../agent';
import type { Language } from '../../language';
import type { KeywordsSettings } from './settings';
import type { CardColor, CardView, ClueCount, Team } from './types';

// What the game server asks the agent for in a game of the team word guessing game, and what it
// answers (../../agent.ts, docs/architecture.md#the-agent): a clue for the group's PI to give, or
// the cards for its students to reveal.

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

export type KeywordsAgentRequest =
  | (AgentAsked & { kind: 'clue' } & AgentGame)
  | (AgentAsked & {
      kind: 'guess';
      // The clue that the group's PI gave, and how many cards the group may still reveal for it, or
      // null when there is no limit.
      clue: { word: string; count: ClueCount };
      guessesLeft: number | null;
    } & AgentGame);

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

// The clue to give, with the cards it is meant for, or the cards to reveal, the surest first, with
// the reason. When the agent has no clue that the rules of the room take, it answers
// `no_legal_clue`.
export type KeywordsAgentReply =
  | { ok: true; kind: 'clue'; word: string; count: number; targets: number[]; note: AgentNote<AgentCandidate> }
  | { ok: true; kind: 'guess'; picks: number[]; reason: string; note: AgentNote<AgentCandidate> };
