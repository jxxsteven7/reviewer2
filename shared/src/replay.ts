import type { AgentPersona } from './agent';

// Someone in a replay of any game as it is shown (docs/architecture.md#replays): an account by its
// username, avatar and handle as they are now, or else as deleted; a guest by their number; an AI
// player by its persona.
export interface ReplayPerson {
  name?: string;
  avatar?: string;
  handle?: string;
  deleted?: true;
  guest?: number;
  agent?: AgentPersona;
}
