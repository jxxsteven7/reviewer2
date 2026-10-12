import type { InvitationView } from '@reviewer2/shared';
import { reactive, ref } from 'vue';
import { account, loadAccount } from './account';
import { send, socket, whenConnected } from './socket';
import { toast, toastError } from './toast';

// What this browser hears of its account's friends (docs/architecture.md#friends): the invitations
// to rooms, which show on whatever page is open until they are followed, ignored or lapse, and the
// word that the friends or the requests changed, on which a page that shows them asks again; and
// the way to ask someone to be friends, from wherever a page offers it.

// Asks an account to be friends, by their username or by their seat in the room, and tells the
// player how it went: friends at once, when the other side had asked already, or a request sent,
// which the other side answers on their account page. The page may have no connection yet, and
// the message goes over one. Says whether the request went through.
export async function requestFriend(who: { username: string } | { playerId: string }): Promise<boolean> {
  if (!(await whenConnected())) {
    toastError('offline');
    return false;
  }
  const reply = await send<{ status: 'pending' | 'accepted' }>('friends:request', who);
  if (!reply.ok) {
    toastError(reply.error);
    return false;
  }
  toast(reply.status === 'accepted' ? 'friends.nowFriends' : 'friends.requestSent');
  return true;
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

// A new connection is whoever the browser is now, who may be someone else, and hears again the
// invitations that stand for them.
socket.on('connect', () => {
  for (const { id } of [...invitations]) forget(id);
});

// Goes up whenever the account's friends or requests change, by this page or by the other side.
// The account's summary, which counts the requests waiting for an answer, is asked for again too.
export const friendsVersion = ref(0);
socket.on('friends:changed', () => {
  friendsVersion.value += 1;
  if (account.summary) void loadAccount();
});
