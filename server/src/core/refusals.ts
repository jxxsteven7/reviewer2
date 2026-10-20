// What the limits turned away, summed up a minute at a time
// (docs/architecture.md#limits-and-housekeeping). Each limit that turned anything away in the
// minute gets one `limited` line: which limit, how often, and from how many addresses; a minute in
// which none did gets nothing. A flood of requests makes one line a minute rather than one a
// request, and the line has `level: "warn"`, so that whatever watches the log can raise an alert on
// it. No line names an address, a name or an account: the addresses are counted, by the key that
// the limits count them under (clientIp.ts), and forgotten with the minute.

type Log = (event: string, fields?: Record<string, unknown>) => void;

// The limits, by what they count: the messages of one connection; per address, rooms created,
// codes that belong to no room, feedback, requests to the account API, accounts created, wrong
// passwords, mails and open connections; per account, reports, searches for a friend by username,
// friend requests, requests to be let into a friend's room, avatars and likes; per member of a
// room, what they add to the log of its game (MAX_LOGGED_PER_MEMBER in room.ts); and what the
// server turns away while it is busy (load.ts), new connections and new rooms. The cooldowns
// between two reactions and between two invitations to the same friend are no limit against
// abuse, and count for nothing here.
export type Limit =
  | 'messages'
  | 'game_log'
  | 'rooms'
  | 'codes'
  | 'feedback'
  | 'requests'
  | 'registrations'
  | 'passwords'
  | 'mails'
  | 'connections_per_address'
  | 'reports'
  | 'friend_searches'
  | 'friend_requests'
  | 'join_asks'
  | 'avatars'
  | 'likes'
  | 'busy_connections'
  | 'busy_rooms';

// The most addresses that are told apart for one limit in one minute, so that a flood from many
// addresses can't fill the memory with them. Past it, the line says this many, which means at
// least.
export const MAX_COUNTED_ADDRESSES = 10_000;

export class Refusals {
  readonly #minute = new Map<Limit, { count: number; addresses: Set<string> }>();

  constructor(private readonly log: Log) {}

  // One refusal by the limit, of the address as the limits count it.
  add(limit: Limit, address: string): void {
    let entry = this.#minute.get(limit);
    if (!entry) {
      entry = { count: 0, addresses: new Set() };
      this.#minute.set(limit, entry);
    }
    entry.count += 1;
    if (entry.addresses.size < MAX_COUNTED_ADDRESSES) entry.addresses.add(address);
  }

  // Writes the lines of the minute, and starts the next one.
  flush(): void {
    for (const [limit, { count, addresses }] of this.#minute) {
      this.log('limited', { level: 'warn', limit, count, addresses: addresses.size });
    }
    this.#minute.clear();
  }
}
