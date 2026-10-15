import type { AgentPersona } from '@reviewer2/shared';
import { i18n } from './i18n';

// What a player is called on the page, in the language of the interface
// (docs/architecture.md#players-and-identity): a guest by their number in the room, an AI player by
// its persona's name, an account that has been deleted since a game as deleted, and an account by
// its username. Every part of the page that names a player gets the name from here, through the
// room's snapshots (room.ts) or a replay's people (games/keywords/replay.ts), so that a guest is
// called the same everywhere, and again in the other language after a switch.
export interface Named {
  name?: string;
  guest?: number;
  agent?: AgentPersona;
  deleted?: true;
}

export function nameOf(who: Named): string {
  const { t } = i18n.global;
  if (who.guest !== undefined) return t('room.guest', { number: who.guest });
  if (who.agent !== undefined) return t(`agents.personas.${who.agent}`);
  if (who.deleted) return t('replay.deleted');
  return who.name ?? '';
}
