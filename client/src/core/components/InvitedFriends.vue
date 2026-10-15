<script setup lang="ts">
import type { RoomView } from '@reviewer2/shared';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatList } from '../i18n';
import PlayerAvatar from './PlayerAvatar.vue';

// The friends whom the viewer has invited into the room and who haven't come, in the start bar
// (docs/architecture.md#friends), as the room's view says (RoomView.invited): their avatars, the
// first invited on top, each overlapping the next, as someone the room waits for (PlayerAvatar.vue).
// A friend who comes in turns to their own colors for a moment, the dots stilled, and fades away:
// the list of who is in the room has them from then on. One whose
// invitation ends otherwise, ignored or lapsed, goes at once. The page tells the two apart by
// whether the name came into the room as it went from the invitations. A tap opens the sheet to
// invite friends. Four show, and "+n" counts the rest.
const props = defineProps<{ room: RoomView }>();
const emit = defineEmits<{ open: [] }>();
const { t, locale } = useI18n();

interface Entry {
  username: string;
  avatar: string | null;
  came: boolean;
  leaving: boolean;
}

const SHOWN = 4;
// How long a friend who came shows, and how long the fade at its end takes.
const CAME_MS = 1600;
const FADE_MS = 400;

const entries = ref<Entry[]>([]);
const timers = new Set<ReturnType<typeof setTimeout>>();
const later = (ms: number, run: () => void) => {
  const timer = setTimeout(() => {
    timers.delete(timer);
    run();
  }, ms);
  timers.add(timer);
};
onBeforeUnmount(() => {
  for (const timer of timers) clearTimeout(timer);
});

watch(
  () => [props.room.invited ?? [], props.room.players] as const,
  ([invited, players]) => {
    const standing = new Map(invited.map((friend) => [friend.username, friend]));
    const here = new Set(players.map(({ name }) => name));
    const next: Entry[] = [];
    for (const entry of entries.value) {
      if (standing.has(entry.username)) next.push({ ...entry, came: false, leaving: false });
      else if (entry.came) next.push(entry);
      else if (here.has(entry.username)) {
        const username = entry.username;
        next.push({ ...entry, came: true });
        later(CAME_MS - FADE_MS, () => {
          entries.value = entries.value.map((other) =>
            other.username === username && other.came ? { ...other, leaving: true } : other,
          );
        });
        later(CAME_MS, () => {
          entries.value = entries.value.filter((other) => !(other.username === username && other.came));
        });
      }
    }
    for (const friend of invited) {
      if (!next.some((entry) => entry.username === friend.username)) {
        next.push({ username: friend.username, avatar: friend.avatar, came: false, leaving: false });
      }
    }
    entries.value = next;
  },
  { immediate: true },
);

// The button names those still waited for; while there are none, only one who has just come, it
// names what a tap does.
const waiting = computed(() => entries.value.filter((entry) => !entry.came));
const label = computed(() =>
  waiting.value.length > 0
    ? t('friends.invitedList', {
        names: formatList(
          locale.value,
          waiting.value.map(({ username }) => username),
        ),
      })
    : t('friends.invite'),
);
</script>

<template>
  <button v-if="entries.length" type="button" class="invited-friends" :aria-label="label" @click="emit('open')">
    <span
      v-for="(entry, index) in entries.slice(0, SHOWN)"
      :key="entry.username"
      class="face"
      :class="{ came: entry.came, leaving: entry.leaving }"
      :style="{ zIndex: SHOWN - index }"
    >
      <PlayerAvatar :name="entry.username" :avatar="entry.avatar" :waiting="!entry.came" />
    </span>
    <span v-if="entries.length > SHOWN" class="more num" aria-hidden="true">+{{ entries.length - SHOWN }}</span>
  </button>
</template>

<style scoped>
.invited-friends {
  display: inline-flex;
  flex: none;
  align-items: center;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--ink);
  font: inherit;
  cursor: pointer;
}

.face {
  position: relative;
  display: inline-flex;
  flex: none;
  transition: opacity 400ms;
}

.face + .face {
  margin-left: -6px;
}

.face.leaving {
  opacity: 0;
}

.more {
  margin-left: var(--space-1);
  font-size: var(--text-xs);
  font-weight: var(--weight-black);
}
</style>
