import { z } from 'zod';
import { MAX_AGENT_REASON } from '../../agent';
import { LANGUAGES } from '../../language';
import { AGENT_ASKED, AGENT_NOTE_FIELDS, gameId, term } from '../../schemaParts';
import { FATES, IMPOSTOR_ROLES, MAX_PLAYERS, VERDICTS } from './types';

// The schemas of the hidden word game's own messages, which the server checks every one of them
// against, and of what the server and the agent say to each other in its games
// (../../schemas.ts). Only the server and the agent import this module, so that the client's
// bundle doesn't need zod.
//
// What a player writes is for the rules to judge (lines.ts): a description that is too long or
// gives the word away gets the game's own answer, and not bad_request from here.

const round = z.number().int().min(1).max(10_000);
const number = z.number().int().min(1).max(MAX_PLAYERS);

export const IMPOSTOR_MESSAGES = {
  // Whoever is in the waiting room plays the next game or watches it.
  'impostor:seat': z.object({ play: z.boolean() }),
  // The setter's two words, the field they are of and whether the setter is named when the pair
  // is adopted (docs/games/impostor.md#the-setter).
  'impostor:words': z.object({ a: z.string(), b: z.string(), field: z.string().max(64), named: z.boolean() }),
  // Each action names the game and, where it matters, the round it was meant for, so that a late
  // one can't land in a later round.
  'impostor:describe': z.object({ gameId, round, text: z.string() }),
  // A vote for a number, or null to abstain.
  'impostor:vote': z.object({ gameId, round, number: number.nullable() }),
  // A report of a number, with one of their lines, by its index among the game's lines, or none.
  'impostor:report': z.object({
    gameId,
    round,
    number,
    line: z.number().int().min(0).max(100_000).nullable(),
    reason: z.string(),
  }),
  'impostor:judge': z.object({ gameId, verdict: z.enum(VERDICTS) }),
  // A guess of the students' word after being voted out, or null to make none.
  'impostor:comeback': z.object({ gameId, word: z.string().nullable() }),
  // A line of the off-field chat, or of the talk after the game.
  'impostor:say': z.object({ gameId, text: z.string() }),
} as const;

export type ImpostorMessage = keyof typeof IMPOSTOR_MESSAGES;

// The settings of a room of the game (settings.ts). The schema only takes their shape: whether the
// numbers are whole and in range is for settingsProblems() to say, which the room setup runs too.
export const IMPOSTOR_SETTINGS = z.object({
  describeTime: z.number(),
  voteTime: z.number(),
  length: z.number(),
  pi: z.boolean(),
  comeback: z.boolean(),
  anonymous: z.boolean(),
  godView: z.boolean(),
  setter: z.boolean(),
});

// What the game server and the agent say to each other in a game of the hidden word game
// (agent.ts), which ../../schemas.ts puts together with every other game's.
const line = z.string().max(500);
const terms = z.array(term).max(50);
const agentGame = {
  game: z.literal('impostor'),
  language: z.enum(LANGUAGES),
  length: z.number().int().min(1).max(500),
  number,
  word: z
    .strictObject({ word: term, translations: terms.optional(), forms: terms.optional(), pinyin: term.optional() })
    .nullable(),
  round,
  seats: z
    .array(z.strictObject({ number, fate: z.enum(FATES), role: z.enum(IMPOSTOR_ROLES).nullable() }))
    .max(MAX_PLAYERS),
  lines: z.array(z.strictObject({ round, number, text: line.nullable(), tie: z.boolean() })).max(2000),
  ballots: z
    .array(
      z.strictObject({
        round,
        ballot: z.enum(['vote', 'revote']),
        votes: z.record(z.string(), z.number().int().min(-1).max(MAX_PLAYERS)),
        out: number.nullable(),
        tied: z.array(number).max(MAX_PLAYERS),
      }),
    )
    .max(1000),
  reports: z
    .array(z.strictObject({ round, by: number, target: number, reason: line, passed: z.boolean().nullable() }))
    .max(1000),
};

export const IMPOSTOR_AGENT_REQUESTS = [
  z.strictObject({ ...AGENT_ASKED, kind: z.literal('describe'), tie: z.boolean(), ...agentGame }),
  z.strictObject({
    ...AGENT_ASKED,
    kind: z.literal('vote'),
    candidates: z.array(number).max(MAX_PLAYERS),
    ...agentGame,
  }),
  z.strictObject({
    ...AGENT_ASKED,
    kind: z.literal('judge'),
    report: z.strictObject({ by: number, target: number, line: z.number().int().min(0).nullable(), reason: line }),
    ...agentGame,
  }),
  z.strictObject({ ...AGENT_ASKED, kind: z.literal('comeback'), ...agentGame }),
] as const;

export const IMPOSTOR_NOTE = z.strictObject({
  ...AGENT_NOTE_FIELDS,
  candidates: z
    .array(z.strictObject({ text: line, problem: z.string().max(64).nullable() }))
    .max(10)
    .optional(),
});

const reason = z.string().max(MAX_AGENT_REASON);

export const IMPOSTOR_AGENT_REPLIES = [
  z.strictObject({ ok: z.literal(true), kind: z.literal('describe'), text: line, note: IMPOSTOR_NOTE }),
  z.strictObject({
    ok: z.literal(true),
    kind: z.literal('vote'),
    number: number.nullable(),
    reason,
    note: IMPOSTOR_NOTE,
  }),
  z.strictObject({
    ok: z.literal(true),
    kind: z.literal('judge'),
    verdict: z.enum(VERDICTS),
    reason,
    note: IMPOSTOR_NOTE,
  }),
  z.strictObject({ ok: z.literal(true), kind: z.literal('comeback'), word: term.nullable(), note: IMPOSTOR_NOTE }),
] as const;
