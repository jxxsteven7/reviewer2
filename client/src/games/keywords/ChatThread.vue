<script setup lang="ts">
import { checkChat, MAX_CHAT_INPUT, MAX_CHAT_LENGTH, textLength, type RoomView } from '@reviewer2/shared';
import { computed, nextTick, onBeforeUnmount, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AvatarButton from '../../core/components/AvatarButton.vue';
import UiButton from '../../core/components/UiButton.vue';
import { byTurn } from './chat';
import { useKeywords } from './useKeywords';

// The group's messages by turn, and the line a student writes under them. GroupChat.vue shows
// this beside the board, in a panel that is open all the time, or on a phone in a sheet, which
// throws the thread away as it closes: so the line, `draft`, and the sending are the page's
// (useChatLine.ts), and the thread only shows and edits the one and asks for the other. Students
// write one line at a time; PIs read but can't write. Once the game is over, everyone who played
// for the group, its PI too, may talk it over, until the next game, under a heading of its own
// after the turns; whoever only sat down after the end reads.
const props = defineProps<{ room: RoomView; sending: boolean }>();
const draft = defineModel<string>('draft', { required: true });
const emit = defineEmits<{ send: [] }>();
const { t } = useI18n();
const { data, mySeat, mySide } = useKeywords(toRef(props, 'room'));

const game = computed(() => data.value.game);
const chat = computed(() => game.value?.chat ?? []);
const turns = computed(() => byTurn(chat.value));
const over = computed(() => game.value?.phase === 'over');
const canWrite = computed(() =>
  over.value
    ? (mySeat.value?.team ?? null) !== null && mySeat.value?.team === mySide.value
    : mySeat.value?.role === 'guesser',
);

// The list shows the newest message as the thread comes into view, which is when it is mounted,
// and follows new ones only while it is at its end, so that a player reading older messages
// isn't pulled away from them; the viewer's own message always comes into view.
const NEAR_END = 40;
const list = ref<HTMLElement | null>(null);
watch(
  () => chat.value.at(-1)?.id ?? 0,
  async () => {
    // Measured before the new message is rendered: was the list at its end until now?
    const before = list.value;
    const follow =
      !before ||
      before.scrollHeight - before.scrollTop - before.clientHeight <= NEAR_END ||
      chat.value.at(-1)?.player === props.room.me;
    await nextTick();
    if (follow && list.value) list.value.scrollTop = list.value.scrollHeight;
  },
  { immediate: true },
);

function nameOf(playerId: string): string {
  if (playerId === props.room.me) return t('game.chat.you');
  return props.room.players.find((player) => player.id === playerId)?.name ?? t('game.chat.someone');
}

// The player who wrote a message, for the avatar beside it, or none for someone who has left.
const playerOf = (playerId: string) => props.room.players.find((player) => player.id === playerId);

const input = ref<HTMLInputElement | null>(null);
const check = computed(() => checkChat(draft.value));
const length = computed(() => textLength(check.value.text));
const tooLong = computed(() => check.value.problem === 'chat_too_long');

function send() {
  emit('send');
  // Tapping "Send" moves the focus to the button, which closes a phone's keyboard. The next
  // message is likely to follow, so the input gets the focus back.
  input.value?.focus();
}

// A player who comes to write sees the newest message: once the input has the focus, and again
// once a phone's keyboard has come up and the list has got shorter.
const KEYBOARD_MS = 400;
function toEnd() {
  const scroll = () => {
    if (list.value) list.value.scrollTop = list.value.scrollHeight;
  };
  void nextTick(scroll);
  setTimeout(scroll, KEYBOARD_MS);
}

// A list at its end stays there as it gets shorter or taller, as when a phone's keyboard comes up or
// goes, however long the keyboard takes. Where the player has scrolled up to read, it stays put.
let atEnd = true;
function scrolled() {
  const element = list.value;
  if (element) atEnd = element.scrollHeight - element.scrollTop - element.clientHeight <= NEAR_END;
}
const resized =
  typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
        if (atEnd && list.value) list.value.scrollTop = list.value.scrollHeight;
      })
    : null;
watch(list, (element, old) => {
  if (old) resized?.unobserve(old);
  if (element) resized?.observe(element);
});
onBeforeUnmount(() => resized?.disconnect());
</script>

<template>
  <div class="chat">
    <ol v-if="turns.length" ref="list" class="turns" @scroll.passive="scrolled">
      <li v-for="turn in turns" :key="turn.after ? 'after' : turn.turn" class="turn">
        <h3 class="turn-title">{{ turn.after ? t('game.chat.after') : t('game.turn', { turn: turn.turn }) }}</h3>
        <p
          v-for="message in turn.messages"
          :key="message.id"
          class="message"
          :class="{ own: message.player === room.me }"
        >
          <AvatarButton
            v-if="playerOf(message.player)"
            :player-id="message.player"
            :name="playerOf(message.player)?.name ?? ''"
            :username="playerOf(message.player)?.username"
            :guest="playerOf(message.player)?.guest"
            :avatar="playerOf(message.player)?.avatar"
            :agent="playerOf(message.player)?.agent !== undefined"
          />
          <span class="name">{{ nameOf(message.player) }}</span>
          <span class="text">{{ message.text }}</span>
        </p>
      </li>
    </ol>
    <p v-else class="empty">{{ t('game.chat.empty') }}</p>

    <form v-if="canWrite" class="compose" @submit.prevent="send">
      <label class="label" for="chat-text">{{ t('game.chat.input') }}</label>
      <div class="row">
        <input
          id="chat-text"
          ref="input"
          v-model="draft"
          :maxlength="MAX_CHAT_INPUT"
          autocomplete="off"
          enterkeyhint="send"
          :aria-invalid="tooLong ? 'true' : undefined"
          aria-describedby="chat-hint"
          @focus="toEnd"
        />
        <UiButton variant="primary" type="submit" :disabled="check.problem !== null || sending">
          {{ t('game.chat.send') }}
        </UiButton>
      </div>
      <p id="chat-hint" class="hint num" :class="{ problem: tooLong }">
        {{ tooLong ? t('errors.chat_too_long') : t('game.chat.count', { count: length, max: MAX_CHAT_LENGTH }) }}
      </p>
    </form>
    <p v-if="canWrite && over" class="note">{{ t('game.chat.review') }}</p>
    <p v-else-if="!canWrite" class="note">{{ over ? t('game.chat.over') : t('game.chat.readOnly') }}</p>
  </div>
</template>

<style scoped>
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
  gap: var(--space-2);
}

.turn-title {
  color: var(--ink-2);
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: var(--weight-black);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

/* Each message on a block; the viewer's own take the table's yellow. */
.message {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-card);
  background: var(--paper-2);
  overflow-wrap: anywhere;
}

.message.own {
  background: var(--bg);
}

/* The avatar's middle is level with the middle of the name's first line. */
.message :deep(.avatar-button) {
  margin-right: var(--space-2);
  vertical-align: middle;
}

.name {
  margin-right: var(--space-2);
  font-weight: var(--weight-black);
}

.empty,
.note {
  flex: none;
  color: var(--ink-2);
}

.compose {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: var(--space-1);
  padding-top: var(--space-3);
}

.label {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.row {
  display: flex;
  gap: var(--space-2);
}

input {
  flex: 1;
  min-width: 0;
  min-height: 48px;
  padding: 0 var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--paper);
  color: var(--ink);
  font: inherit;
  font-size: 16px;
  font-weight: var(--weight-bold);
}

input:focus-visible {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

input[aria-invalid='true'] {
  border-color: var(--red-deep);
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-xs);
  text-align: right;
}

.hint.problem {
  color: var(--red-deep);
  font-family: inherit;
  font-weight: var(--weight-bold);
  text-align: left;
}
</style>
