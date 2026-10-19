import type { AgentPersona } from '@reviewer2/shared';
import type { Rooms } from './core/rooms';
import type { ConnectionInfo } from './core/socket';

// Who is connected at this moment, and who is in each room, for /live.json on the status port
// (status.ts, docs/architecture.md#status): what only the running process knows, and as little of
// it as will do. An account is given by its id alone, never by its username, a guest by their
// number in the room, an AI player by its persona. Nothing else of a member is: no name, key,
// browser, group, role or anything of the game; nor of a room: its game, language and settings
// are in the log already. It is worked out when it is asked for, and never logged or kept.

export interface LiveConnection {
  // The account that the connection is logged in to, or null for a guest.
  account: number | null;
  // The code of the room that the connection is in, as a member or a screen, or null for none.
  room: string | null;
  country: string;
  // In milliseconds, as for /status.json (stats.ts), or null while no heartbeat has come back.
  latency: number | null;
}

// A person has an account or a guest's number, and an AI player neither, only its persona.
export interface LiveMember {
  account: number | null;
  guest: number | null;
  agent: AgentPersona | null;
  // A person while they have a connection, an AI player while the agent answers (Room.isOnline).
  online: boolean;
  // When a person went offline, in ISO 8601 and UTC, or null while they are online.
  offlineSince: string | null;
  // Whether an AI plays for them while they are away.
  takenOver: boolean;
}

export interface LiveRoom {
  code: string;
  members: LiveMember[];
  // How many screens show the room.
  screens: number;
}

export interface Live {
  connections: LiveConnection[];
  rooms: LiveRoom[];
}

// The rooms keep the time a member went offline on the server's clock, `now`, which only runs
// forward (server.ts) and says nothing of the date: it is told as so long before the system's time,
// `systemNow`. Both are read once, so that every member is told against the same moment.
export function collectLive(
  rooms: Rooms,
  connections: readonly ConnectionInfo[],
  now: () => number,
  systemNow: () => number = () => Date.now(),
): Live {
  const serverTime = now();
  const systemTime = systemNow();
  const told = (time: number) => new Date(systemTime - (serverTime - time)).toISOString();
  return {
    connections: connections.map(({ account, room, country, latency }) => ({ account, room, country, latency })),
    rooms: rooms.all().map((room) => ({
      code: room.code,
      members: [...room.members.values()].map((member) => ({
        account: member.account?.id ?? null,
        guest: member.guest,
        agent: member.agent,
        online: room.isOnline(member.id),
        offlineSince: member.offlineSince === null ? null : told(member.offlineSince),
        takenOver: member.takenOver,
      })),
      screens: room.screens.size,
    })),
  };
}
