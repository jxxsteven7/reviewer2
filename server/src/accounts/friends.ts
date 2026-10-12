import { FRIEND_LIMITS, type FriendError, type FriendLimits } from '@reviewer2/shared';
import type { DatabaseSync } from 'node:sqlite';
import { WindowCounter } from '../core/rateLimit';
import { FriendStore, type FriendRow } from '../store/friends';

// The rules of friendship (docs/architecture.md#friends): who may ask whom, what an answer does,
// and the limits that keep anyone from flooding others with requests or trying name after name to
// learn which are accounts. The socket layer finds the accounts and tells the connections; this
// only decides, and writes.

export type FriendResult<Data extends object = object> = ({ ok: true } & Data) | { ok: false; error: FriendError };

const refuse = (error: FriendError): { ok: false; error: FriendError } => ({ ok: false, error });

const DAY_MS = 24 * 60 * 60_000;

export class Friendships {
  readonly store: FriendStore;
  readonly limits: FriendLimits;
  // Per account and day: requests, counting those that came to nothing.
  readonly #requests: WindowCounter;

  constructor(
    db: DatabaseSync,
    // The system's clock, for what is kept, and the server's, which only runs forward, for the limit.
    private readonly clock: () => number,
    now: () => number,
    limits: Partial<FriendLimits> = {},
  ) {
    this.limits = { ...FRIEND_LIMITS, ...limits };
    this.store = new FriendStore(db, clock);
    this.#requests = new WindowCounter(this.limits.requestsPerDay, DAY_MS, now);
  }

  // Counts a request against the account's day, before anything is looked up for it, so that a
  // name that finds no account costs the same as one that does. False when the day is used up.
  take(accountId: number): boolean {
    return this.#requests.take(String(accountId));
  }

  // Gives back one of the day's requests, for one that came to nothing and told nothing new.
  refund(accountId: number): void {
    this.#requests.refund(String(accountId));
  }

  // One account asks another to be friends. A request to someone who has asked already accepts
  // theirs: the two want the same thing. Whoever was declined waits before asking again; whoever
  // declined may ask at any time. Says whether the request is open or the two are friends.
  request(from: number, to: number): FriendResult<{ status: 'pending' | 'accepted' }> {
    if (from === to) return refuse('self_friend');
    const found = this.store.between(from, to);
    if (found?.status === 'accepted') return refuse('already_friends');
    const mine = this.store.counts(from);
    const theirs = this.store.counts(to);
    const full = mine.friends >= this.limits.maxFriends || theirs.friends >= this.limits.maxFriends;
    if (found?.status === 'pending') {
      if (found.requesterId === from) return refuse('request_pending');
      if (full) return refuse('friends_full');
      this.store.accept(found.id);
      return { ok: true, status: 'accepted' };
    }
    if (found && found.requesterId === from && this.#declinedRecently(found.answeredAt)) {
      return refuse('request_declined');
    }
    if (full) return refuse('friends_full');
    if (mine.outgoing >= this.limits.maxOutgoing || theirs.incoming >= this.limits.maxIncoming) {
      return refuse('friend_requests_full');
    }
    if (found) this.store.renew(found.id, from, to);
    else this.store.request(from, to);
    return { ok: true, status: 'pending' };
  }

  // The account accepts the request that `other` sent it.
  accept(accountId: number, other: number): FriendResult {
    const found = this.#openRequestTo(accountId, other);
    if (!found) return refuse('no_such_request');
    const full = [accountId, other].some((id) => this.store.counts(id).friends >= this.limits.maxFriends);
    if (full) return refuse('friends_full');
    this.store.accept(found.id);
    return { ok: true };
  }

  // The account declines the request that `other` sent it. The row stays, declined, for as long as
  // the two may not ask each other again.
  decline(accountId: number, other: number): FriendResult {
    const found = this.#openRequestTo(accountId, other);
    if (!found) return refuse('no_such_request');
    this.store.decline(found.id);
    return { ok: true };
  }

  // The account ends its friendship with `other`, or takes back the request it sent them.
  remove(accountId: number, other: number): FriendResult {
    const found = this.store.between(accountId, other);
    const mine = found?.status === 'accepted' || (found?.status === 'pending' && found.requesterId === accountId);
    if (!found || !mine) return refuse('no_such_request');
    this.store.delete(found.id);
    return { ok: true };
  }

  areFriends(a: number, b: number): boolean {
    return this.store.between(a, b)?.status === 'accepted';
  }

  friendsOf(accountId: number): FriendRow[] {
    return this.store.friendsOf(accountId);
  }

  requests(accountId: number): { incoming: FriendRow[]; outgoing: FriendRow[] } {
    return { incoming: this.store.incoming(accountId), outgoing: this.store.outgoing(accountId) };
  }

  // The accounts whose pages show this one: its friends, and the other side of its open requests.
  others(accountId: number): number[] {
    return this.store.others(accountId);
  }

  // Deletes the declined requests whose wait is over, and forgets the counts of days gone by. Says
  // how many requests went.
  prune(): number {
    this.#requests.prune();
    return this.store.pruneDeclined(new Date(this.clock() - this.limits.declineCooldownMs).toISOString());
  }

  #openRequestTo(accountId: number, other: number) {
    const found = this.store.between(accountId, other);
    return found?.status === 'pending' && found.addresseeId === accountId ? found : undefined;
  }

  // Whether a declined request was answered less than the cooldown ago. A clock that was set back
  // counts as a wait that is over.
  #declinedRecently(answeredAt: string | null): boolean {
    if (answeredAt === null) return false;
    const since = this.clock() - Date.parse(answeredAt);
    return since >= 0 && since < this.limits.declineCooldownMs;
  }
}
