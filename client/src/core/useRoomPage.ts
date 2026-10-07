import { computed, onBeforeUnmount, watch, type Ref } from 'vue';
import { games } from '../games';
import { browserLanguage, setLanguage, storedLanguage } from './i18n';
import { closeRoomPage, entry, openRoom, room } from './room';

// What the room page and the screen page share. They enter the room when they open and whenever
// the code in the address changes, show the whole page in the room's language for as long as
// they are open, and give the room page up when they close.
export function useRoomPage(code: Ref<string>, { screen = false } = {}) {
  watch(code, (value) => openRoom(value, { screen }), { immediate: true });

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
