import type { FriendsView } from '@reviewer2/shared';
import { onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { friendsVersion, listFriends } from './friends';
import { connect, socket } from './socket';

// The account's friends and requests, for the parts of a page that show them (ProfileFriends,
// InviteFriends; docs/architecture.md#friends). The list is asked for when the part is shown, on
// every connection after that, since one that comes after a break may have missed a change and who
// is online changes all the time, whenever the server says that the friends or the requests
// changed, and on request; parts that ask at the same moment share one answer (listFriends).
// `shown` says whether the part is on the screen; nothing is asked while it isn't.
export function useFriendsList(shown: Ref<boolean> = ref(true)) {
  const view = ref<FriendsView | null>(null);
  // Why the last answer didn't come, if it didn't.
  const failed = ref<string | null>(null);
  let asked = 0;

  async function load() {
    const turn = (asked += 1);
    failed.value = null;
    const reply = await listFriends();
    if (turn !== asked) return; // asked again meanwhile, and that answer counts
    if (reply.ok) view.value = { friends: reply.friends, incoming: reply.incoming, outgoing: reply.outgoing };
    else {
      failed.value = reply.error;
      // The next connection asks again, and is asked for.
      if (reply.error === 'offline') connect();
    }
  }

  const refresh = () => {
    if (shown.value) void load();
  };

  // A part shown with no connection yet waits for one, which is asked for; the connection then
  // loads the list, as every one after it does.
  watch(
    shown,
    (on) => {
      if (!on) return;
      view.value = null;
      failed.value = null;
      if (socket.connected) void load();
      else connect();
    },
    { immediate: true },
  );
  socket.on('connect', refresh);
  watch(friendsVersion, refresh);
  onBeforeUnmount(() => socket.off('connect', refresh));

  return { view, failed, load };
}
