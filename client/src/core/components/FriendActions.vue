<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { answerFriend, type Standing } from '../friends';
import { useBusy } from '../useBusy';
import AliasSheet from './AliasSheet.vue';
import BefriendSheet from './BefriendSheet.vue';
import UiButton from './UiButton.vue';
import UnfriendSheet from './UnfriendSheet.vue';

// What an account may do with another by how the two stand (standingOf), the same in a room's
// player panel, in the panel that the search on the account page opens and on a public page
// (docs/architecture.md#friends): ask a stranger to be friends, in a sheet with a line for them
// (BefriendSheet.vue); see that a request went; accept or decline the other's request, with the
// line that came with it; give a friend a name (AliasSheet.vue) or end the friendship, after asking
// first (UnfriendSheet.vue). The account itself is offered nothing here. `name` is the other's
// username, never the name the viewer gives a friend, since it names a stranger, and `who` how a
// request finds them: by username, or by their seat in the room.
//
// Its buttons and the word of a request lie among those of the place that shows it, in its column,
// or, `compact`, as small buttons in its row, as beside the like on a public page, with the word of
// a request across the top of the row and the short names (friends.short), so that a phone's row
// holds them all; its sheets lie over the place, which a cancel leads back to.
// Once something has gone through, the place hears `done`.
const props = defineProps<{
  standing: Standing;
  name: string;
  who: { username: string } | { playerId: string };
  compact?: boolean;
}>();
const emit = defineEmits<{ done: [] }>();
const { t } = useI18n();
const { busy, run } = useBusy();
const befriending = ref(false);
const naming = ref(false);
const removing = ref(false);
const size = computed(() => (props.compact ? 'small' : 'normal'));

async function answer(username: string, reply: 'accept' | 'decline') {
  if (await run(() => answerFriend(username, reply))) emit('done');
}

// A sheet's request, name or parting went through.
function finish() {
  befriending.value = false;
  naming.value = false;
  removing.value = false;
  emit('done');
}
</script>

<template>
  <div class="friend-actions">
    <template v-if="standing.kind === 'incoming'">
      <div class="asked-you" :class="{ across: compact }">
        <p>{{ t('friends.askedYou') }}</p>
        <p v-if="standing.request.note" class="quoted">
          {{ t('friends.noteQuoted', { note: standing.request.note }) }}
        </p>
      </div>
      <UiButton :size="size" variant="primary" :disabled="busy" @click="answer(standing.request.username, 'accept')">
        {{ t('friends.accept') }}
      </UiButton>
      <UiButton :size="size" :disabled="busy" @click="answer(standing.request.username, 'decline')">
        {{ t('friends.decline') }}
      </UiButton>
    </template>
    <UiButton v-else-if="standing.kind === 'stranger'" :size="size" variant="primary" @click="befriending = true">
      {{ t('friends.addFromRoom') }}
    </UiButton>
    <UiButton v-else-if="standing.kind === 'outgoing'" :size="size" disabled>{{
      t('friends.requestPending')
    }}</UiButton>
    <template v-else-if="standing.kind === 'friend'">
      <UiButton :size="size" @click="naming = true">{{
        t(compact ? 'friends.short.alias' : 'friends.aliasEdit')
      }}</UiButton>
      <UiButton :size="size" variant="danger" @click="removing = true">{{
        t(compact ? 'friends.short.remove' : 'friends.removeFriend')
      }}</UiButton>
      <AliasSheet
        :open="naming"
        :username="standing.friend.username"
        :alias="standing.friend.alias ?? null"
        @close="naming = false"
        @saved="finish"
      />
      <UnfriendSheet
        :open="removing"
        :handle="standing.friend.handle"
        :username="standing.friend.username"
        @close="removing = false"
        @removed="finish"
      />
    </template>
    <BefriendSheet :open="befriending" :name="name" :who="who" @close="befriending = false" @sent="finish" />
  </div>
</template>

<style scoped>
/* The buttons are the place's own, in its column. */
.friend-actions {
  display: contents;
}

/* Someone who asked the account, with the line they sent. */
.asked-you {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3);
  border: var(--line-thin) solid var(--ink);
  border-radius: var(--radius-card);
  background: var(--bg);
  font-weight: var(--weight-bold);
}

.asked-you p {
  margin: 0;
}

/* In a row, the word of a request takes the whole of its first line. */
.asked-you.across {
  flex-basis: 100%;
  order: -1;
}

.quoted {
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: normal;
  overflow-wrap: break-word;
}
</style>
