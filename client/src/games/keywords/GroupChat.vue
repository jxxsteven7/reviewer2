<script setup lang="ts">
import {
  checkChat,
  MAX_CHAT_INPUT,
  MAX_CHAT_LENGTH,
  textLength,
  type ChatMessage,
  type RoomView,
} from '@reviewer2/shared';
import { computed, nextTick, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from '../../core/components/UiButton.vue';
import UiSheet from '../../core/components/UiSheet.vue';
import { act } from '../../core/socket';
import { byTurn, markSeen, seenIn, unread } from './chat';
import { useKeywords } from './useKeywords';

// The group chat (docs/games/keywords.md): a button with the number of new messages, which opens
// the group's messages by turn. Students write one line at a time; PIs read but can't write. The
// server sends the chat only to the group's own PI and students, so spectators and screens get
// no button at all.
const props = defineProps<{ room: RoomView }>();
const { t } = useI18n();
const { data, mySeat } = useKeywords(toRef(props, 'room'));

const game = computed(() => data.value.game);
const chat = computed<ChatMessage[] | null>(() => game.value?.chat ?? null);
const turns = computed(() => byTurn(chat.value ?? []));
const canWrite = computed(() => mySeat.value?.role === 'guesser' && game.value?.phase !== 'over');
const group = computed(() => (mySeat.value?.team ? t(`lobby.group.${mySeat.value.team}`) : ''));

const open = ref(false);
const list = ref<HTMLElement | null>(null);
const seen = ref(game.value ? seenIn(game.value.gameId) : 0);
const fresh = computed(() => unread(chat.value ?? [], seen.value, props.room.me));

watch(
  () => game.value?.gameId,
  (gameId) => (seen.value = gameId ? seenIn(gameId) : 0),
);

// While the chat is open, every message counts as read. The list shows the newest message when
// the chat opens, and follows new ones only while it is at its end, so that a player reading
// older messages isn't pulled away from them; the viewer's own message always comes into view.
const NEAR_END = 40;
watch(
  [open, () => chat.value?.at(-1)?.id ?? 0],
  async ([isOpen, last], [wasOpen]) => {
    if (!isOpen || !game.value) return;
    if (last > seen.value) {
      seen.value = last;
      markSeen(game.value.gameId, last);
    }
    // Measured before the new message is rendered: was the list at its end until now?
    const before = list.value;
    const follow =
      !wasOpen ||
      !before ||
      before.scrollHeight - before.scrollTop - before.clientHeight <= NEAR_END ||
      chat.value?.at(-1)?.player === props.room.me;
    await nextTick();
    if (follow && list.value) list.value.scrollTop = list.value.scrollHeight;
  },
  { immediate: true },
);

function nameOf(playerId: string): string {
  if (playerId === props.room.me) return t('game.chat.you');
  return props.room.players.find((player) => player.id === playerId)?.name ?? t('game.chat.someone');
}

const text = ref('');
const input = ref<HTMLInputElement | null>(null);
const sending = ref(false);
const check = computed(() => checkChat(text.value));
const length = computed(() => textLength(check.value.text));
const tooLong = computed(() => check.value.problem === 'chat_too_long');

async function say() {
  if (check.value.problem || sending.value || !game.value) return;
  // The input is cleared before the answer comes, so that the next message, which a player on
  // a slow connection may already be typing, isn't wiped out with the sent one. A message the
  // server refuses comes back into the input, in front of whatever was typed since.
  const sent = text.value;
  text.value = '';
  sending.value = true;
  const reply = await act('keywords:say', { gameId: game.value.gameId, text: sent });
  sending.value = false;
  if (!reply.ok) text.value = text.value ? `${sent} ${text.value}` : sent;
  // Tapping "Send" moves the focus to the button, which closes a phone's keyboard. The next
  // message is likely to follow, so the input gets the focus back.
  input.value?.focus();
}
</script>

<template>
  <template v-if="chat">
    <UiButton
      size="small"
      :aria-label="fresh ? t('game.chat.openUnread', { count: fresh }) : t('game.chat.open')"
      @click="open = true"
    >
      {{ t('game.chat.open') }}
      <span v-if="fresh" class="badge mono" aria-hidden="true">{{ fresh }}</span>
    </UiButton>

    <UiSheet :open="open" :title="t('game.chat.title', { group })" @close="open = false">
      <div class="chat">
        <ol v-if="turns.length" ref="list" class="turns">
          <li v-for="turn in turns" :key="turn.turn" class="turn">
            <h3 class="turn-title">{{ t('game.turn', { turn: turn.turn }) }}</h3>
            <p
              v-for="message in turn.messages"
              :key="message.id"
              class="message"
              :class="{ own: message.player === room.me }"
            >
              <span class="name">{{ nameOf(message.player) }}</span>
              <span class="text">{{ message.text }}</span>
            </p>
          </li>
        </ol>
        <p v-else class="empty">{{ t('game.chat.empty') }}</p>

        <form v-if="canWrite" class="compose" @submit.prevent="say">
          <label class="label" for="chat-text">{{ t('game.chat.input') }}</label>
          <div class="row">
            <input
              id="chat-text"
              ref="input"
              v-model="text"
              :maxlength="MAX_CHAT_INPUT"
              autocomplete="off"
              enterkeyhint="send"
              :aria-invalid="tooLong ? 'true' : undefined"
              aria-describedby="chat-hint"
            />
            <UiButton variant="primary" type="submit" :disabled="check.problem !== null || sending">
              {{ t('game.chat.send') }}
            </UiButton>
          </div>
          <p id="chat-hint" class="hint mono" :class="{ problem: tooLong }">
            {{ tooLong ? t('errors.chat_too_long') : t('game.chat.count', { count: length, max: MAX_CHAT_LENGTH }) }}
          </p>
        </form>
        <p v-else class="note">{{ game?.phase === 'over' ? t('game.chat.over') : t('game.chat.readOnly') }}</p>
      </div>
    </UiSheet>
  </template>
</template>

<style scoped>
.badge {
  min-width: 1.5em;
  padding: 0 var(--space-1);
  border-radius: var(--radius-card);
  background: var(--ink);
  color: var(--paper);
  font-size: var(--text-xs);
  line-height: 1.5;
  text-align: center;
}

.chat {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.turns {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-height: min(50vh, 24rem);
  max-height: min(50dvh, 24rem);
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  overscroll-behavior: contain;
}

.turn {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.turn-title {
  color: var(--ink-3);
  font-size: var(--text-xs);
  font-variant-caps: all-small-caps;
  font-weight: 400;
  letter-spacing: 0.06em;
}

.message {
  overflow-wrap: anywhere;
}

.name {
  margin-right: var(--space-2);
  font-weight: 600;
}

.own .name {
  color: var(--ink-2);
}

.empty,
.note {
  color: var(--ink-2);
}

.compose {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding-top: var(--space-3);
  border-top: 1px solid var(--rule);
}

.label {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.row {
  display: flex;
  gap: var(--space-2);
}

input {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  padding: 0 var(--space-3);
  border: 1px solid var(--ink-3);
  border-radius: var(--radius-control);
  background: var(--paper);
  color: var(--ink);
  font: inherit;
  font-size: 16px;
}

input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

input[aria-invalid='true'] {
  border-color: var(--red);
}

.hint {
  color: var(--ink-3);
  font-size: var(--text-xs);
  text-align: right;
}

.hint.problem {
  color: var(--red);
  font-family: inherit;
  text-align: left;
}
</style>
