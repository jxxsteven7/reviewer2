<script setup lang="ts">
import { checkChat, type RoomView } from '@reviewer2/shared';
import { computed, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from '../../core/components/UiButton.vue';
import UiSheet from '../../core/components/UiSheet.vue';
import { act } from '../../core/socket';
import { markSeen, seenIn, unread } from './chat';
import ChatThread from './ChatThread.vue';
import { useKeywords } from './useKeywords';

// The group chat (docs/games/keywords.md): the group's messages by turn, with the line a student
// writes (ChatThread.vue). Beside the board, as a `panel`, it is open all the time, and every
// message counts as read as it comes. On a phone it is a button with the number of new messages,
// which opens the thread as a sheet. The server sends the chat only to the group's own PI and
// students, so spectators and screens get nothing at all. The line a student is writing, `draft`,
// is the page's where it binds it, so that it outlives the sheet, which throws the thread away as
// it closes, and the panel, which gives way to the button as the page narrows.
const props = withDefaults(defineProps<{ room: RoomView; panel?: boolean }>(), { panel: false });
const draft = defineModel<string>('draft', { default: '' });
const { t } = useI18n();
const { data, mySeat } = useKeywords(toRef(props, 'room'));

const game = computed(() => data.value.game);
const chat = computed(() => game.value?.chat ?? null);
const group = computed(() => (mySeat.value?.team ? t(`lobby.group.${mySeat.value.team}`) : ''));
const title = computed(() => t('game.chat.title', { group: group.value }));

const open = ref(false);
const seen = ref(game.value ? seenIn(game.value.gameId) : 0);
const fresh = computed(() => unread(chat.value ?? [], seen.value, props.room.me));

watch(
  () => game.value?.gameId,
  (gameId) => (seen.value = gameId ? seenIn(gameId) : 0),
);

// Every message counts as read while the viewer sees the thread: always in the panel, and in the
// sheet while it is open.
const showing = computed(() => props.panel || open.value);
watch(
  [showing, () => chat.value?.at(-1)?.id ?? 0],
  ([isShowing, last]) => {
    if (!isShowing || !game.value || last <= seen.value) return;
    seen.value = last;
    markSeen(game.value.gameId, last);
  },
  { immediate: true },
);

// Sends the line, one at a time. The input is cleared before the answer comes, so that the next
// message, which a player on a slow connection may already be typing, isn't wiped out with the
// sent one. A message the server refuses comes back into the input, in front of whatever was
// typed since, whether or not the sheet is still open by then.
const sending = ref(false);
async function say() {
  if (checkChat(draft.value).problem || sending.value || !game.value) return;
  const sent = draft.value;
  draft.value = '';
  sending.value = true;
  const reply = await act('keywords:say', { gameId: game.value.gameId, text: sent });
  sending.value = false;
  if (!reply.ok) draft.value = draft.value ? `${sent} ${draft.value}` : sent;
}
</script>

<template>
  <template v-if="chat">
    <section v-if="panel" class="chat-panel">
      <h2 class="section-title">{{ title }}</h2>
      <ChatThread v-model:draft="draft" :room="room" :sending="sending" @send="say" />
    </section>
    <template v-else>
      <UiButton
        class="open-chat"
        size="small"
        :aria-label="fresh ? t('game.chat.openUnread', { count: fresh }) : t('game.chat.open')"
        @click="open = true"
      >
        {{ t('game.chat.open') }}
        <span v-if="fresh" class="badge num" aria-hidden="true">{{ fresh }}</span>
      </UiButton>
      <UiSheet :open="open" :title="title" @close="open = false">
        <ChatThread v-model:draft="draft" :room="room" :sending="sending" @send="say" />
      </UiSheet>
    </template>
  </template>
</template>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}

/* The messages keep to a height that leaves the line a student writes on the screen of a laptop
   through the whole game; the list scrolls. */
.chat-panel :deep(.turns) {
  max-height: 14rem;
}

.badge {
  min-width: 1.6em;
  padding: 0 var(--space-1);
  border-radius: var(--radius-pill);
  background: var(--ink);
  color: var(--on-ink);
  font-size: var(--text-xs);
  font-weight: var(--weight-display);
  line-height: 1.6;
  text-align: center;
}
</style>
