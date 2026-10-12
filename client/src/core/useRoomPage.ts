import { computed, onBeforeUnmount, watch, type Ref } from 'vue';
import { games } from '../games';
import { browserLanguage, setLanguage, storedLanguage } from './i18n';
import { closeRoomPage, entry, openRoom, room } from './room';

// What the room page and the screen page share. They enter the room when they open, whenever the
// code in the address changes, and whenever the address brings an invitation, which stands in for
// the code (docs/architecture.md#friends), show the whole page in the room's language for as long
// as they are open, and give the room page up when they close.
export function useRoomPage(
  code: Ref<string>,
  { screen = false, invitation }: { screen?: boolean; invitation?: Ref<string | undefined> } = {},
) {
  watch(
    [code, () => invitation?.value],
    ([value, invite], [before]) => {
      // The invitation leaving the address, once the page is in the room (RoomPage), is no reason
      // to enter again.
      if (value === before && invite === undefined) return;
      openRoom(value, { screen, ...(invite === undefined ? {} : { invitation: invite }) });
    },
    { immediate: true },
  );

  watch(
    () => room.value?.language ?? entry.language,
    (language) => {
      if (language) setLanguage(language, { remember: false });
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    closeRoomPage();
    setLanguage(storedLanguage() ?? browserLanguage(), { remember: false });
  });

  // The screens of the room's game, once the room is known.
  const screens = computed(() => (room.value ? games[room.value.game] : undefined));

  return { room, entry, screens };
}
