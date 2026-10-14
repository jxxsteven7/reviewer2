import type { DuoView } from './duos';
import { checkChat } from './games/keywords/chat';
import { dropHidden, showsSomething, textLength, trimMarks, trimStrays } from './text';

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
  'friend_note_too_long',
  'friend_alias_invalid',
  'friend_alias_too_long',
] as const;
export type FriendError = (typeof FRIEND_ERRORS)[number];

// The line that may come with a request (docs/architecture.md#friends), for the other side alone to
// read on their account page: one line of at most FRIEND_NOTE_LENGTH characters, cleaned as a line
// of a group's chat is, with hidden characters dropped and line breaks as spaces, and nothing else
// taken out. A note that shows nothing is none. It goes once the request is answered, withdrawn or
// gone, and nobody reads it again.
export const FRIEND_NOTE_LENGTH = 50;
// The longest text that is looked at at all, in UTF-16 units as it arrives.
export const MAX_FRIEND_NOTE_INPUT = 400;

export function checkFriendNote(text: string | undefined): {
  note: string | null;
  problem: 'friend_note_too_long' | null;
} {
  if (typeof text !== 'string') return { note: null, problem: null };
  if (text.length > MAX_FRIEND_NOTE_INPUT) return { note: null, problem: 'friend_note_too_long' };
  const checked = checkChat(text);
  if (checked.problem === 'chat_empty') return { note: null, problem: null };
  if (textLength(checked.text) > FRIEND_NOTE_LENGTH) return { note: checked.text, problem: 'friend_note_too_long' };
  return { note: checked.text, problem: null };
}

// A friend, as the account page lists them: the handle of their public profile (accounts.ts),
// whether they are online, counting every tab and device of theirs as one person, and where they
// are. `room` is null for a friend who is in no room; the code of a public room, where the Join
// button leads; and without the code for a private room, which only an invitation leads into.
// `duo` is what the account has played with the friend and the titles the friend holds among its
// friends (duos.ts), or null when the two share no game. `alias` is the name the account gives the
// friend, if any (checkAlias()).
export interface FriendView {
  handle: string;
  username: string;
  alias?: string;
  avatar: string | null;
  online: boolean;
  room: { code: string | null } | null;
  duo: DuoView | null;
}

// The name that an account gives a friend (docs/architecture.md#friends), for itself alone, as a
// phone's contacts have: the friend doesn't learn of it, and nobody else sees it. It shows beside
// the username on the account's page, in the panel of the friend in a room and where the account
// invites friends, never in a game itself, where everyone goes by their username. One line of at
// most FRIEND_ALIAS_LENGTH characters, cleaned as a nickname is (names.ts): full-width forms folded,
// spaces collapsed, and refused with something in it that a reader can't see. An empty alias is
// none, which takes the old one away.
export const FRIEND_ALIAS_LENGTH = 20;
export const MAX_FRIEND_ALIAS_INPUT = 200;

export function checkAlias(raw: string): {
  alias: string | null;
  problem: 'friend_alias_invalid' | 'friend_alias_too_long' | null;
} {
  if (typeof raw !== 'string') return { alias: null, problem: 'friend_alias_invalid' };
  if (raw.length > MAX_FRIEND_ALIAS_INPUT) return { alias: null, problem: 'friend_alias_too_long' };
  const alias = raw.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (alias === '') return { alias: null, problem: null };
  const hidden = dropHidden(alias) !== alias || trimMarks(alias) !== alias || trimStrays(alias) !== alias;
  if (hidden || !showsSomething(alias)) return { alias: null, problem: 'friend_alias_invalid' };
  if (textLength(alias) > FRIEND_ALIAS_LENGTH) return { alias, problem: 'friend_alias_too_long' };
  return { alias, problem: null };
}

// The other side of a request that is still open, in either direction, with the note that came
// with a request to the account, if any: its sender doesn't see it again.
export interface FriendRequestView {
  handle: string;
  username: string;
  avatar: string | null;
  note?: string;
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
// how much longer it stands, at most INVITATION_MS. The inviter comes with the name that the
// account gives them, if any.
export interface InvitationView {
  id: string;
  code: string;
  roomId: string;
  from: { username: string; alias?: string; avatar: string | null };
  expiresInMs: number;
}
