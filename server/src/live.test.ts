import { describe, expect, test } from 'vitest';
import type { MemberAccount } from './core/room';
import type { Rooms } from './core/rooms';
import { collectLive } from './live';

// What /live.json is made of, from rooms as the server keeps them. Real rooms over real sockets are
// in test/status.test.ts; here the members are made by hand, for an AI player and a person whom an
// AI plays for, whom the driver of the AI players makes (test/agents.test.ts).

interface FakeMember {
  id: string;
  name: string;
  key: string;
  account: Pick<MemberAccount, 'id' | 'handle'> | null;
  guest: number | null;
  agent: string | null;
  sockets: Set<string>;
  offlineSince: number | null;
  takenOver: boolean;
}

const member = (id: string, changes: Partial<FakeMember>): FakeMember => ({
  id,
  name: `Name of ${id}`,
  key: `key of ${id}`,
  account: null,
  guest: null,
  agent: null,
  sockets: new Set(),
  offlineSince: null,
  takenOver: false,
  ...changes,
});

// A room as far as collectLive() reads it: an AI player is online while the agent answers, as
// Room.isOnline() says.
function room(code: string, members: FakeMember[], screens: number, agentUp = true) {
  return {
    code,
    members: new Map(members.map((one) => [one.id, one])),
    screens: new Map(Array.from({ length: screens }, (_, i) => [`screen ${i}`, `key ${i}`])),
    isOnline: (id: string) => {
      const found = members.find((one) => one.id === id);
      return found?.agent ? agentUp : (found?.sockets.size ?? 0) > 0;
    },
  };
}

const roomsOf = (...all: ReturnType<typeof room>[]) => ({ all: () => all }) as unknown as Rooms;

describe('collectLive', () => {
  test('gives each member by account, guest number or persona, and nothing else of them', () => {
    const rooms = roomsOf(
      room(
        'K7QX',
        [
          member('ann', { account: { id: 12, handle: 'ann' }, sockets: new Set(['a', 'b']) }),
          member('guest', { guest: 3, offlineSince: 1_000, takenOver: true }),
          member('ai', { agent: 'reviewer1' }),
        ],
        2,
      ),
      room('M2PD', [member('bob', { guest: 1, sockets: new Set(['c']) })], 0, false),
    );
    // The server's clock reads 31 seconds, and the system's says 12:00:00 UTC.
    const live = collectLive(
      rooms,
      [],
      () => 31_000,
      () => Date.parse('2026-10-19T12:00:00.000Z'),
    );
    expect(live).toEqual({
      connections: [],
      rooms: [
        {
          code: 'K7QX',
          members: [
            { account: 12, guest: null, agent: null, online: true, offlineSince: null, takenOver: false },
            // Offline at 1 second on the server's clock, which was 30 seconds ago.
            {
              account: null,
              guest: 3,
              agent: null,
              online: false,
              offlineSince: '2026-10-19T11:59:30.000Z',
              takenOver: true,
            },
            { account: null, guest: null, agent: 'reviewer1', online: true, offlineSince: null, takenOver: false },
          ],
          screens: 2,
        },
        {
          code: 'M2PD',
          members: [{ account: null, guest: 1, agent: null, online: true, offlineSince: null, takenOver: false }],
          screens: 0,
        },
      ],
    });
    expect(JSON.stringify(live)).not.toMatch(/Name of|key of|handle|"ann"|screen 0/);
  });

  test('gives each connection as it is, without how it is carried', () => {
    const live = collectLive(
      roomsOf(),
      [
        { transport: 'websocket', country: 'SG', latency: 85, account: 12, room: 'K7QX' },
        { transport: 'polling', country: 'CN', latency: null, account: null, room: null },
      ],
      () => 0,
    );
    expect(live).toEqual({
      connections: [
        { account: 12, room: 'K7QX', country: 'SG', latency: 85 },
        { account: null, room: null, country: 'CN', latency: null },
      ],
      rooms: [],
    });
  });

  test('shows an AI player offline while the agent is down', () => {
    const live = collectLive(roomsOf(room('K7QX', [member('ai', { agent: 'reviewer1' })], 0, false)), [], () => 0);
    expect(live.rooms[0]?.members).toEqual([
      { account: null, guest: null, agent: 'reviewer1', online: false, offlineSince: null, takenOver: false },
    ]);
  });
});
