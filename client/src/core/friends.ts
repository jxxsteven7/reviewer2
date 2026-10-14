import type { FriendRequestView, FriendsView, FriendView, InvitationView, JoinAskView } from '@reviewer2/shared';
import { reactive, ref } from 'vue';
import { account, loadAccount } from './account';
import { send, socket, whenConnected } from './socket';
import { toast, toastError } from './toast';

// What this browser hears of its account's friends (docs/architecture.md#friends): the invitations
// to rooms, which show on whatever page is open until they are followed, ignored or lapse; the
// requests of friends to be let into the room the account is in, which show on the room's page
// until they are answered, ignored or lapse; and the word that the friends or the requests changed,
// on which a page that shows them asks again. Also the ways to ask someone to be friends, to answer
// them, to part, and to ask a friend to be let into their room, from wherever a page offers them,
// and how the account stands with someone, which says which of these a page offers.

// Asks an account to be friends, by their username or by their seat in the room, with a line for
// them if the player wrote one, and tells the player how it went: friends at once, when the other
// side had asked already, or a request sent, which the other side answers on their account page.
// The page may have no connection yet, and the message goes over one. Says whether the request
// went through.
export async function requestFriend(
  who: { username: string } | { playerId: string },
  note: string | null = null,
): Promise<boolean> {
  if (!(await whenConnected())) {
    toastError('offline');
    return false;
  }
  const reply = await send<{ status: 'pending' | 'accepted' }>('friends:request', {
    ...who,
    ...(note === null ? {} : { note }),
  });
  if (!reply.ok) {
    toastError(reply.error);
    return false;
  }
  toast(reply.status === 'accepted' ? 'friends.nowFriends' : 'friends.requestSent');
  return true;
}

// Answers the request of the account with this username, or ends the friendship with it, from a
// panel or a page (FriendActions.vue), and tells the player when the two have become friends or
// why it didn't go through; after a refusal, every list of friends on the page is asked for again,
// since the one that offered this may have been out of date. Says whether it went through.
export async function answerFriend(username: string, answer: 'accept' | 'decline' | 'remove'): Promise<boolean> {
  if (!(await whenConnected())) {
    toastError('offline');
    return false;
  }
  const reply = await send(`friends:${answer}`, { username });
  if (!reply.ok) {
    toastError(reply.error);
    friendsVersion.value += 1;
    return false;
  }
  if (answer === 'accept') toast('friends.nowFriends');
  return true;
}

// How the account stands with another, by the other's handle and as the account's own friends list
// has it (useFriendsList): the account itself, a friend, someone who has asked it, someone it has
// asked, or a stranger. Whatever offers to ask someone to be friends, a room's player panel, the
// search on the account page and a public page, asks this, so that all of them offer the same. A
// list that can't be had leaves a stranger, since the server judges a request anyway.
export type Standing =
  | { kind: 'self' }
  | { kind: 'friend'; friend: FriendView }
  | { kind: 'incoming'; request: FriendRequestView }
  | { kind: 'outgoing' }
  | { kind: 'stranger' };

export function standingOf(handle: string, own: string | null, view: FriendsView | null): Standing {
  if (handle === own) return { kind: 'self' };
  const friend = view?.friends.find((other) => other.handle === handle);
  if (friend) return { kind: 'friend', friend };
  const request = view?.incoming.find((other) => other.handle === handle);
  if (request) return { kind: 'incoming', request };
  if (view?.outgoing.some((other) => other.handle === handle)) return { kind: 'outgoing' };
  return { kind: 'stranger' };
}

export const invitations = reactive<InvitationView[]>([]);
const timers = new Map<string, ReturnType<typeof setTimeout>>();
// How many invitations show at once. The oldest goes when one more comes.
const MOST_SHOWN = 5;

// Takes an invitation off the page.
export function forget(id: string): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const index = invitations.findIndex((invitation) => invitation.id === id);
  if (index !== -1) invitations.splice(index, 1);
}

// The player ignores an invitation: it goes off the page, and the server forgets it, so that no
// connection of theirs hears it again.
export function ignore(id: string): void {
  forget(id);
  void send('friends:ignore', { id });
}

// Every connection of the account hears an invitation, and one that comes while it stands hears it
// again: the same one shows once, for as long as it stands.
socket.on('friends:invited', (invitation: InvitationView) => {
  forget(invitation.id);
  invitations.push(invitation);
  while (invitations.length > MOST_SHOWN) forget((invitations[0] as InvitationView).id);
  timers.set(
    invitation.id,
    setTimeout(() => forget(invitation.id), invitation.expiresInMs),
  );
});

// An invitation has ended, however it ended: followed or ignored from another page of the
// account's, or lapsed. One this page doesn't show is nothing to it.
socket.on('friends:uninvited', ({ id }: { id: string }) => forget(id));

// Asks a friend who is in a room to be let in, and tells the player how it went: the friend may
// invite them, which comes as an invitation. Says whether the request went through.
export async function askToJoin(username: string): Promise<boolean> {
  if (!(await whenConnected())) {
    toastError('offline');
    return false;
  }
  const reply = await send('friends:ask', { username });
  if (!reply.ok) {
    toastError(reply.error);
    return false;
  }
  toast('friends.askSent');
  return true;
}

export const asks = reactive<JoinAskView[]>([]);
const askTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Takes a request to be let in off the page.
export function forgetAsk(id: string): void {
  clearTimeout(askTimers.get(id));
  askTimers.delete(id);
  const index = asks.findIndex((ask) => ask.id === id);
  if (index !== -1) asks.splice(index, 1);
}

// The player ignores a request to be let in: it goes off the page, and the server forgets it, so
// that no connection of theirs hears it again, and whoever asked may ask again.
export function dismissAsk(id: string): void {
  forgetAsk(id);
  void send('friends:dismiss', { id });
}

// As with invitations, every connection of the account hears a request, and one that comes while it
// stands hears it again: the same one shows once, for as long as it stands.
socket.on('friends:asked', (ask: JoinAskView) => {
  forgetAsk(ask.id);
  asks.push(ask);
  while (asks.length > MOST_SHOWN) forgetAsk((asks[0] as JoinAskView).id);
  askTimers.set(
    ask.id,
    setTimeout(() => forgetAsk(ask.id), ask.expiresInMs),
  );
});

// A request has ended, however it ended: answered or ignored from another page of the account's,
// or lapsed. One this page doesn't show is nothing to it.
socket.on('friends:unasked', ({ id }: { id: string }) => forgetAsk(id));

// A new connection is whoever the browser is now, who may be someone else, and hears again the
// invitations and the requests that stand for them.
socket.on('connect', () => {
  for (const { id } of [...invitations]) forget(id);
  for (const { id } of [...asks]) forgetAsk(id);
});

// Goes up whenever the account's friends or requests change, by this page or by the other side.
// The account's summary, which counts the requests waiting for an answer, is asked for again too.
export const friendsVersion = ref(0);
socket.on('friends:changed', () => {
  friendsVersion.value += 1;
  if (account.summary) void loadAccount();
});
