<script setup lang="ts">
import type { RoomView } from '@reviewer2/shared';
import { computed, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from '../../core/components/UiButton.vue';
import UiSheet from '../../core/components/UiSheet.vue';
import { markSeen, seenIn, unread } from './chat';
import ChatThread from './ChatThread.vue';
import { useKeywords } from './useKeywords';

// The group chat (docs/games/keywords.md): the group's messages by turn, with the line a student
// writes (ChatThread.vue). Beside the board, as a `panel`, it is open all the time, and every
// message counts as read as it comes. On a phone it is a button with the number of new messages,
// which opens the thread as a sheet: with the keyboard up at once while there is nothing to read
// yet, and without it once there is, since the player may only want to read; the sheet keeps above
// the keyboard once it comes up, with the line at its foot and the messages scrolling above it. The
// server sends the chat only to the group's own PI and students, so spectators and screens get
// nothing at all. The line a student is writing, `draft`, and its sending are the page's
// (useChatLine.ts), so that they outlive the sheet, which throws the thread away as it closes, and
// the panel, which gives way to the button as the page narrows: this component only shows the line
// and asks the page to send it.
const props = withDefaults(defineProps<{ room: RoomView; panel?: boolean; sending: boolean }>(), {
  panel: false,
});
const draft = defineModel<string>('draft', { required: true });
const emit = defineEmits<{ send: [] }>();
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
</script>

<template>
  <template v-if="chat">
    <section v-if="panel" class="chat-panel">
      <h2 class="section-title">{{ title }}</h2>
      <ChatThread v-model:draft="draft" :room="room" :sending="sending" @send="emit('send')" />
    </section>
    <template v-else>
      <UiButton
        class="open-chat"
        size="small"
        :aria-label="fresh ? t('game.chat.openUnread', { count: fresh }) : t('game.chat.open')"
        @click="open = true"
      >
        {{ t('game.buttons.chat') }}
        <span v-if="fresh" class="badge num" aria-hidden="true">{{ fresh }}</span>
      </UiButton>
      <UiSheet :open="open" :title="title" :focus-input="chat.length === 0" fit-screen @close="open = false">
        <ChatThread v-model:draft="draft" class="in-sheet" :room="room" :sending="sending" @send="emit('send')" />
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

/* In the sheet, the thread fills the sheet's column: the messages take what the line at the foot
   leaves, and scroll. */
.in-sheet {
  flex: 1 1 auto;
  min-height: 0;
}

.in-sheet :deep(.turns) {
  flex: 1 1 auto;
  min-height: 0;
  max-height: none;
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
