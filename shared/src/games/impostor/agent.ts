import type { AgentAsked, AgentNote } from '../../agent';
import type { Language } from '../../language';
import type { BallotView, Fate, ImpostorRole, LineView, ReportVerdict } from './types';

// What the game server asks the agent for in a game of the hidden word game, and what it answers
// (../../agent.ts, docs/architecture.md#the-agent): a description of the AI player's word, its
// vote, its verdict on a report, and its guess of the students' word after it was voted out. The
// agent never reports anyone, never talks off the field and never sets the words.

// The AI player's word, as the checks of a description need it (BoardWord in ../../words.ts), or
// null for the PI, who has none.
export interface AgentWord {
  word: string;
  translations?: string[];
  forms?: string[];
  pinyin?: string;
}

// What the agent knows of a game to play a turn in it: the room's language and how long a
// description may be, the AI player's number and word, the round, every seat as everyone sees it,
// and every line, vote and report so far, as everyone sees them.
export interface ImpostorAgentGame {
  game: 'impostor';
  language: Language;
  length: number;
  number: number;
  word: AgentWord | null;
  round: number;
  seats: { number: number; fate: Fate; role: ImpostorRole | null }[];
  lines: LineView[];
  ballots: BallotView[];
  reports: { round: number; by: number; target: number; reason: string; passed: boolean | null }[];
}

export type ImpostorAgentRequest =
  | (AgentAsked & { kind: 'describe'; tie: boolean } & ImpostorAgentGame)
  | (AgentAsked & { kind: 'vote'; candidates: number[] } & ImpostorAgentGame)
  // The report carries the line it points at, if any: the agent may not be told the round it is of.
  | (AgentAsked & {
      kind: 'judge';
      report: { by: number; target: number; text: string | null; reason: string };
    } & ImpostorAgentGame)
  | (AgentAsked & { kind: 'comeback' } & ImpostorAgentGame);

// A line that the agent considered, and what the checks of the room said of it, or null when they
// took it (checkDescription in lines.ts).
export interface ImpostorCandidate {
  text: string;
  problem: string | null;
}

// What a player with a word worked out before its line or its vote (`judges` in the agent's
// impostorPrompts.ts), as its note keeps it for the AI's log alone: the other word closest to its
// own, in the model's own words, and, once there were lines to go by, which of the two the others'
// lines fit: its own, the closest, or neither clearly.
export const FITS = ['mine', 'closest', 'unclear'] as const;
export type ImpostorFit = (typeof FITS)[number];

export interface ImpostorJudgment {
  closest: string;
  fit?: ImpostorFit;
}

export type ImpostorNote = AgentNote<ImpostorCandidate> & { judgment?: ImpostorJudgment };

// The line, the vote, by number or null to abstain, the verdict or the guess, null to make none,
// each with the reason in a sentence. When the agent has no line that the checks take, it answers
// `no_legal_move`.
export type ImpostorAgentReply =
  | { ok: true; kind: 'describe'; text: string; note: ImpostorNote }
  | { ok: true; kind: 'vote'; number: number | null; reason: string; note: ImpostorNote }
  | { ok: true; kind: 'judge'; verdict: ReportVerdict; reason: string; note: ImpostorNote }
  | { ok: true; kind: 'comeback'; word: string | null; note: ImpostorNote };
