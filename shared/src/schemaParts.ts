import { z } from 'zod';
import { AGENT_PERSONAS, MAX_AGENT_REASON, MAX_AGENT_WAIT_MS } from './agent';

// The parts that the schemas of the shared layer (schemas.ts) and those of each game (as
// games/keywords/schemas.ts) are built of. Only the server and the agent import this module, as
// they do the schemas, so that the client's bundle doesn't need zod.

// A code as someone typed it, with whatever they put around and between its characters.
export const code = z.string().max(32);
export const playerId = z.string().max(32);
export const gameId = z.string().max(64);
export const roomId = z.string().max(64);
// A term of the word library, or a word or a line that a game sends the agent.
export const term = z.string().max(200);

// What every request to the agent but a ping says besides the game's own (AgentAsked in agent.ts).
export const AGENT_ASKED = {
  v: z.literal(1),
  persona: z.enum(AGENT_PERSONAS),
  waitMs: z.number().int().min(1).max(MAX_AGENT_WAIT_MS),
};

// How the agent came to its answer (AgentNote in agent.ts), without what it considered, which is
// in each game's own shape: a game adds `candidates` to these fields, or takes them as they are.
export const AGENT_NOTE_FIELDS = {
  model: z.string().max(200),
  prompt: z.string().max(64),
  ms: z.number().min(0),
  reason: z.string().max(MAX_AGENT_REASON).optional(),
};
export const AGENT_NOTE = z.strictObject(AGENT_NOTE_FIELDS);
