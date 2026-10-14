import { JOIN_ASK_MS } from '@reviewer2/shared';
import { randomId } from './random';
import type { Room } from './room';

// Requests to be let into a friend's room (docs/architecture.md#friends): an account asks a friend
// who is in a room, private or not, to invite it, and learns nothing of the room by asking. A
// request stands for JOIN_ASK_MS, unless the friend leaves the room, the room closes or the two
// part first, and goes when the friend ignores it, or once the account has been invited into the
// room or has come in. However it ends, `ended` hears of it, so that the friend's pages can take it
// down and the account's offer to ask again. It is written down nowhere: it lives in memory, and
// ends with the server.

export interface JoinAsk {
  id: string;
  room: Room;
  // The account that asks, and the friend asked, by account and by the member key they have in the
  // room, where they must still be.
  fromId: number;
  toId: number;
  toKey: string;
  // When it was made, on the room's clock.
  at: number;
}

export class JoinAsks {
  readonly #byId = new Map<string, JoinAsk>();
  readonly #byAccount = new Map<number, Set<JoinAsk>>();

  constructor(
    private readonly now: () => number,
    // Whether a room is still open: the list of rooms knows, the room doesn't.
    private readonly isOpen: (room: Room) => boolean,
    // Whether two accounts are friends: a request lasts no longer than the friendship.
    private readonly areFriends: (a: number, b: number) => boolean,
    // Hears of every request that ends: answered, ignored, or found to have lapsed.
    private readonly ended: (ask: JoinAsk) => void = () => {},
  ) {}

  create(room: Room, fromId: number, toId: number, toKey: string): JoinAsk {
    const ask: JoinAsk = { id: randomId(), room, fromId, toId, toKey, at: this.now() };
    this.#byId.set(ask.id, ask);
    for (const id of [fromId, toId]) this.#byAccount.set(id, (this.#byAccount.get(id) ?? new Set()).add(ask));
    return ask;
  }

  // The request from one account to another that still stands, if any. One that has lapsed is
  // forgotten here, so that whoever asked hears so before asking again.
  between(fromId: number, toId: number): JoinAsk | undefined {
    for (const ask of this.#of(fromId)) {
      if (ask.fromId !== fromId || ask.toId !== toId) continue;
      if (this.stands(ask)) return ask;
      this.#drop(ask);
    }
    return undefined;
  }

  // The requests that still stand for an account to answer, the oldest first, for a connection of
  // theirs that has just come.
  for(toId: number): JoinAsk[] {
    return this.#of(toId).filter((ask) => ask.toId === toId && this.stands(ask));
  }

  // Whether a request still stands: it is young enough, its room is open, the friend asked is still
  // in it, and the two are still friends.
  stands(ask: JoinAsk): boolean {
    return (
      this.remaining(ask) > 0 &&
      this.isOpen(ask.room) &&
      ask.room.memberByKey(ask.toKey) !== undefined &&
      this.areFriends(ask.fromId, ask.toId)
    );
  }

  // How much longer the request stands by its age alone, in milliseconds, at least 0.
  remaining(ask: JoinAsk): number {
    return Math.max(0, ask.at + JOIN_ASK_MS - this.now());
  }

  // The friend asked ignores a request, which then no connection of theirs hears again.
  dismiss(id: string, toId: number): void {
    const ask = this.#byId.get(id);
    if (ask?.toId === toId) this.#drop(ask);
  }

  // The account has been invited into the room, or has come in: whatever it asked to be let into
  // the room is answered, whoever it asked.
  answered(room: Room, fromId: number): void {
    for (const ask of this.#of(fromId)) if (ask.fromId === fromId && ask.room === room) this.#drop(ask);
  }

  // Forgets the requests that no longer stand.
  prune(): void {
    for (const ask of this.#byId.values()) if (!this.stands(ask)) this.#drop(ask);
  }

  get size(): number {
    return this.#byId.size;
  }

  #of(accountId: number): JoinAsk[] {
    return [...(this.#byAccount.get(accountId) ?? [])];
  }

  #drop(ask: JoinAsk): void {
    if (!this.#byId.delete(ask.id)) return;
    for (const id of [ask.fromId, ask.toId]) {
      const own = this.#byAccount.get(id);
      own?.delete(ask);
      if (own?.size === 0) this.#byAccount.delete(id);
    }
    this.ended(ask);
  }
}
