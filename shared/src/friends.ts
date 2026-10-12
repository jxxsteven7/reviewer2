// Friends and invitations (docs/architecture.md#friends), for accounts alone. Two accounts are
// friends once one has asked and the other has accepted; either may decline or end it. Friends see
// of each other whether they are online and in which public room they are, and may invite each
// other into the room they are in, private rooms included. The server keeps the friendships and the
// limits; the client shows them.

export interface FriendLimits {
  // How many friends an account may have.
  maxFriends: number;
  // How many requests an account may have open at once, and how many may wait for its answer.
  maxOutgoing: number;
  maxIncoming: number;
  // How many requests an account may send a day, counting those that were refused.
  requestsPerDay: number;
  // How long after a request was declined whoever was declined can't ask the same account again.
  declineCooldownMs: number;
}

export const FRIEND_LIMITS: Readonly<FriendLimits> = Object.freeze({
  maxFriends: 100,
  maxOutgoing: 20,
  maxIncoming: 50,
  requestsPerDay: 30,
  declineCooldownMs: 7 * 24 * 60 * 60_000,
});

// How long an invitation to a room stands, unless the room closes or the inviter leaves it first,
// and how long a member waits before inviting the same friend again.
export const INVITATION_MS = 10 * 60_000;
export const INVITE_COOLDOWN_MS = 60_000;

// What the server may answer the friends messages with, besides the codes that every message can
// get. The client shows each one with the text under errors.<code> in the locale files.
export const FRIEND_ERRORS = [
  'no_such_account',
  'self_friend',
  'already_friends',
  'request_pending',
  'request_declined',
  'friend_requests_full',
  'friend_limited',
  'friends_full',
  'no_such_request',
  'not_friends',
  'friend_offline',
  'friend_in_room',
  'friend_removed',
  'invite_cooldown',
  'invitation_expired',
] as const;
export type FriendError = (typeof FRIEND_ERRORS)[number];

// A friend, as the account page lists them: whether they are online, counting every tab and device
// of theirs as one person, and where they are. `room` is null for a friend who is in no room; the
// code of a public room, where the Join button leads; and without the code for a private room,
// which only an invitation leads into.
export interface FriendView {
  username: string;
  avatar: string | null;
  online: boolean;
  room: { code: string | null } | null;
}

// The other side of a request that is still open, in either direction.
export interface FriendRequestView {
  username: string;
  avatar: string | null;
}

// The answer to friends:list.
export interface FriendsView {
  friends: FriendView[];
  incoming: FriendRequestView[];
  outgoing: FriendRequestView[];
}

// An invitation, as the server sends it to every connection of the invited account as
// friends:invited, and again to a connection that comes while it stands. `id` goes with room:join
// in place of the code, or with friends:ignore, and comes back to every connection of the account
// as friends:uninvited, `{ id }`, once the invitation has ended, however it ended. `expiresInMs` is
// how much longer it stands, at most INVITATION_MS.
export interface InvitationView {
  id: string;
  code: string;
  roomId: string;
  from: { username: string; avatar: string | null };
  expiresInMs: number;
}
