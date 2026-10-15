import type { AgentPersona } from '@reviewer2/shared';
import { shallowRef, type Ref } from 'vue';
import { i18n } from './i18n';

// What a player is called on the page, in the language of the interface
// (docs/architecture.md#players-and-identity): a guest by their number in the room, an AI player by
// its persona's name, an account that has been deleted since a game as deleted, a friend by the
// name that the viewer gives them, if any (docs/architecture.md#friends), as a phone's contacts
// do, and any other account by its username. Every part of the page that names a player gets the
// name from here, through the room's snapshots (room.ts) or a replay's people
// (games/keywords/replay.ts), so that a guest is called the same everywhere, and again in the other
// language after a switch, and a friend the same, and again once the viewer renames them. An
// account is known by its `handle`; one that the page knows by its name alone, as someone who has
// left a match, keeps it.
export interface Named {
  name?: string;
  handle?: string;
  guest?: number;
  agent?: AgentPersona;
  deleted?: true;
}

// The names that the viewer gives their friends, by handle, from the account's friends list
// (friends.ts), and none for a guest.
const aliases = shallowRef<ReadonlyMap<string, string>>(new Map());
export const friendAliases: Readonly<Ref<ReadonlyMap<string, string>>> = aliases;

export function knowAliases(friends: readonly { handle: string; alias?: string }[]): void {
  aliases.value = new Map(friends.flatMap(({ handle, alias }) => (alias ? [[handle, alias] as const] : [])));
}

export function aliasOf(handle: string | undefined): string | null {
  return handle === undefined ? null : (aliases.value.get(handle) ?? null);
}

// `aliased` is false where others see the page as well, as on a big screen in a room, which keeps
// to usernames.
export function nameOf(who: Named, aliased = true): string {
  const { t } = i18n.global;
  if (who.guest !== undefined) return t('room.guest', { number: who.guest });
  if (who.agent !== undefined) return t(`agents.personas.${who.agent}`);
  if (who.deleted) return t('replay.deleted');
  return (aliased ? aliasOf(who.handle) : null) ?? who.name ?? '';
}

// The username that follows a friend's name in small grey type, as on the friend's panel, where the
// page asks before it acts on them and on their whole page: a name that the viewer gives may be
// anyone's, and the username says who it is. None where the name is the username.
export function usernameAfter(who: { name: string; username?: string }): string | null {
  return who.username !== undefined && who.username !== who.name ? who.username : null;
}
