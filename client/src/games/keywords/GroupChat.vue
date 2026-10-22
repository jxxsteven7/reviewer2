<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AvatarButton from '../../core/components/AvatarButton.vue';
import ChatThread, { type ChatSection, type ShownMessage } from '../../core/components/ChatThread.vue';
import UiButton from '../../core/components/UiButton.vue';
import UiSheet from '../../core/components/UiSheet.vue';
import type { ShownRoom } from '../../core/room';
import { byTurn, markSeen, seenIn, unread } from './chat';
import { useKeywords } from './useKeywords';

// The group chat (docs/games/keywords.md): the group's messages by turn, with the line a student
// writes (ChatThread.vue). Students write one line at a time; PIs read but can't write. Once the
// game is over, everyone who played for the group, its PI too, may talk it over, until the next
// game, under a heading of its own after the turns; whoever only sat down after the end reads.
// Beside the board, as a `panel`, it is open all the time, and every
// message counts as read as it comes. On a phone it is a button with the number of new messages,
// which opens the thread as a sheet: with the keyboard up at once while there is nothing to read
// yet, and without it once there is, since the player may only want to read; the sheet keeps above
// the keyboard once it comes up, with the line at its foot and the messages scrolling above it. The
// server sends the chat only to the group's own PI and students, so spectators and screens get
// nothing at all. The line a student is writing, `draft`, and its sending are the page's
// (useChatLine.ts), so that they outlive the sheet, which throws the thread away as it closes, and
// the panel, which gives way to the button as the page narrows: this component only shows the line
// and asks the page to send it. In the tutorial (`demo`), the chat is an invented game's, and
// what the viewer read of it isn't kept: the list of the last message read in each game is the
// browser's, for real games, and holds only a few.
const props = withDefaults(defineProps<{ room: ShownRoom; panel?: boolean; sending: boolean; demo?: boolean }>(), {
  panel: false,
  demo: false,
});
const draft = defineModel<string>('draft', { required: true });
const emit = defineEmits<{ send: [] }>();
const { t } = useI18n();
const { data, mySeat, mySide } = useKeywords(toRef(props, 'room'));

const game = computed(() => data.value.game);
const chat = computed(() => game.value?.chat ?? null);
const over = computed(() => game.value?.phase === 'over');
const canWrite = computed(() =>
  over.value
    ? (mySeat.value?.team ?? null) !== null && mySeat.value?.team === mySide.value
    : mySeat.value?.role === 'guesser',
);
const note = computed(() => {
  if (canWrite.value) return over.value ? t('game.chat.review') : null;
  return over.value ? t('game.chat.over') : t('game.chat.readOnly');
});

// The messages by turn, each with its writer, while they are still in the room, for the avatar.
const playerOf = (playerId: string) => props.room.players.find((player) => player.id === playerId);
type Message = ShownMessage & { player: string };
const sections = computed<ChatSection<Message>[]>(() =>
  byTurn(chat.value ?? []).map((turn) => ({
    key: turn.after ? 'after' : turn.turn,
    title: turn.after ? t('game.chat.after') : t('game.turn', { turn: turn.turn }),
    messages: turn.messages.map((message) => ({
      id: message.id,
      own: message.player === props.room.me,
      name:
        message.player === props.room.me
          ? t('game.chat.you')
          : (playerOf(message.player)?.name ?? t('game.chat.someone')),
      text: message.text,
      player: message.player,
    })),
  })),
);
const group = computed(() => (mySeat.value?.team ? t(`games.keywords.groups.${mySeat.value.team}`) : ''));
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
    if (!props.demo) markSeen(game.value.gameId, last);
  },
  { immediate: true },
);
</script>

<template>
  <template v-if="chat">
    <section v-if="panel" class="chat-panel">
      <h2 class="section-title">{{ title }}</h2>
      <ChatThread
        v-model:draft="draft"
        :sections="sections"
        :can-write="canWrite"
        :sending="sending"
        :label="t('game.chat.input')"
        :empty="t('game.chat.empty')"
        :note="note"
        @send="emit('send')"
      >
        <template #avatar="{ message }">
          <AvatarButton
            v-if="playerOf(message.player)"
            :player-id="message.player"
            :name="playerOf(message.player)?.name ?? ''"
            :username="playerOf(message.player)?.username"
            :guest="playerOf(message.player)?.guest"
            :avatar="playerOf(message.player)?.avatar"
            :agent="playerOf(message.player)?.agent !== undefined"
          />
        </template>
      </ChatThread>
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
        <ChatThread
          v-model:draft="draft"
          class="in-sheet"
          :sections="sections"
          :can-write="canWrite"
          :sending="sending"
          :label="t('game.chat.input')"
          :empty="t('game.chat.empty')"
          :note="note"
          @send="emit('send')"
        >
          <template #avatar="{ message }">
            <AvatarButton
              v-if="playerOf(message.player)"
              :player-id="message.player"
              :name="playerOf(message.player)?.name ?? ''"
              :username="playerOf(message.player)?.username"
              :guest="playerOf(message.player)?.guest"
              :avatar="playerOf(message.player)?.avatar"
              :agent="playerOf(message.player)?.agent !== undefined"
            />
          </template>
        </ChatThread>
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
