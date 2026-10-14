<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { account } from '../account';
import { standingOf } from '../friends';
import { useFriendsList } from '../useFriendsList';
import FriendActions from './FriendActions.vue';
import ProfileCard from './ProfileCard.vue';
import UiButton from './UiButton.vue';
import UiSheet from './UiSheet.vue';

// The panel of an account outside a room (docs/architecture.md#public-profiles): what a tap on an
// avatar opens on the account page and the home page (AvatarButton.vue), and the search on the
// account page for the account it finds (ProfileFriends.vue), the same as a room's player panel
// (PlayerPanel.vue) without what only a room has, so that nobody leaves the page to look. Its title
// is the username, or the name the viewer gives a friend, with the username after it in small grey
// type. A brief card, and under it what the viewer may do by how the two stand (FriendActions.vue),
// once the viewer's own friends list has come or can't be had, or a word that it is the viewer;
// last, the whole page, which rises as a second sheet of its own height over the panel, scrolls
// inside, and leads back to it. Once something has gone through, the panel says `done`.
const props = defineProps<{ open: boolean; handle: string; username: string }>();
const emit = defineEmits<{ close: []; done: [] }>();
const { t } = useI18n();
const reading = ref(false);
const { view, failed } = useFriendsList(computed(() => props.open && account.summary !== null));
const standing = computed(() =>
  account.summary && (view.value !== null || failed.value !== null)
    ? standingOf(props.handle, account.summary.handle, view.value)
    : null,
);
const friend = computed(() => (standing.value?.kind === 'friend' ? standing.value.friend : null));

// A panel opened anew, or on someone else, starts with the brief card.
watch(
  () => [props.open, props.handle],
  () => (reading.value = false),
);
</script>

<template>
  <UiSheet
    :open="open"
    :title="friend?.alias ?? username"
    :subtitle="friend?.alias ? username : null"
    @close="emit('close')"
  >
    <div class="panel-body">
      <ProfileCard :handle="handle" brief :named="false" />
      <p v-if="standing?.kind === 'self'" class="hint">{{ t('friends.self') }}</p>
      <div class="panel-actions">
        <FriendActions
          v-if="standing && standing.kind !== 'self'"
          :standing="standing"
          :name="username"
          :who="{ username }"
          @done="emit('done')"
        />
        <UiButton @click="reading = true">{{ t('room.panel.fullPage') }}</UiButton>
      </div>
    </div>
  </UiSheet>

  <UiSheet
    :open="open && reading"
    :title="username"
    tall
    :back="t('room.panel.back')"
    @back="reading = false"
    @close="emit('close')"
  >
    <ProfileCard :handle="handle" :named="false" />
  </UiSheet>
</template>

<style scoped>
/* The card, a word when it is the viewer, and the buttons, as close together as in a room's panel. */
.panel-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.panel-actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}
</style>
