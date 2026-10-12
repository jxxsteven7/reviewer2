import { INVITATION_MS } from '@reviewer2/shared';
import { randomId } from './random';
import type { Room } from './room';

// Invitations to rooms (docs/architecture.md#friends): a member of a room invites a friend, who
// may then come in with the invitation in place of the code, into a private room too. An invitation
// stands for INVITATION_MS, unless the room closes, the inviter leaves it or the two part first,
// and goes when the friend comes into the room or ignores it. However it ends, `ended` hears of
// it, so that the pages of the invited account can take it down. It is written down nowhere: it
// lives in memory, and ends with the server.

export interface Invitation {
  id: string;
  room: Room;
  // The inviter, by account and by the member key they have in the room, where they must still
  // be, and the account invited.
  inviterId: number;
  inviterKey: string;
  inviteeId: number;
  // When it was made, on the room's clock.
  at: number;
}

export class Invitations {
  readonly #byId = new Map<string, Invitation>();
  readonly #byInvitee = new Map<number, Set<Invitation>>();

  constructor(
    private readonly now: () => number,
    // Whether a room is still open: the list of rooms knows, the room doesn't.
    private readonly isOpen: (room: Room) => boolean,
    // Whether two accounts are friends: an invitation lasts no longer than the friendship.
    private readonly areFriends: (a: number, b: number) => boolean,
    // Hears of every invitation that ends: used up, ignored, or found to have lapsed.
    private readonly ended: (invitation: Invitation) => void = () => {},
  ) {}

  create(room: Room, inviterId: number, inviterKey: string, inviteeId: number): Invitation {
    const invitation: Invitation = { id: randomId(), room, inviterId, inviterKey, inviteeId, at: this.now() };
    this.#byId.set(invitation.id, invitation);
    const own = this.#byInvitee.get(inviteeId) ?? new Set<Invitation>();
    this.#byInvitee.set(inviteeId, own.add(invitation));
    return invitation;
  }

  // The invitation with this ID, if it is for this account and still stands.
  find(id: string, inviteeId: number): Invitation | undefined {
    const invitation = this.#byId.get(id);
    return invitation && invitation.inviteeId === inviteeId && this.stands(invitation) ? invitation : undefined;
  }

  // The invitations that still stand for an account, the oldest first, for a connection of theirs
  // that has just come.
  for(inviteeId: number): Invitation[] {
    return [...(this.#byInvitee.get(inviteeId) ?? [])].filter((invitation) => this.stands(invitation));
  }

  // Whether an invitation still stands: it is young enough, its room is open, the inviter is still
  // in it, and the two are still friends.
  stands(invitation: Invitation): boolean {
    return (
      this.remaining(invitation) > 0 &&
      this.isOpen(invitation.room) &&
      invitation.room.memberByKey(invitation.inviterKey) !== undefined &&
      this.areFriends(invitation.inviterId, invitation.inviteeId)
    );
  }

  // How much longer the invitation stands by its age alone, in milliseconds, at least 0.
  remaining(invitation: Invitation): number {
    return Math.max(0, invitation.at + INVITATION_MS - this.now());
  }

  // The account ignores an invitation of theirs, which then no connection of theirs hears again.
  ignore(id: string, inviteeId: number): void {
    const invitation = this.#byId.get(id);
    if (invitation?.inviteeId === inviteeId) this.#drop(invitation);
  }

  // The account has come into the room, by an invitation or by the code: whatever invitations it
  // had to this room are used up.
  used(room: Room, inviteeId: number): void {
    for (const invitation of this.#byInvitee.get(inviteeId) ?? []) {
      if (invitation.room === room) this.#drop(invitation);
    }
  }

  // Forgets the invitations that no longer stand.
  prune(): void {
    for (const invitation of this.#byId.values()) if (!this.stands(invitation)) this.#drop(invitation);
  }

  get size(): number {
    return this.#byId.size;
  }

  #drop(invitation: Invitation): void {
    this.#byId.delete(invitation.id);
    const own = this.#byInvitee.get(invitation.inviteeId);
    own?.delete(invitation);
    if (own?.size === 0) this.#byInvitee.delete(invitation.inviteeId);
    this.ended(invitation);
  }
}
