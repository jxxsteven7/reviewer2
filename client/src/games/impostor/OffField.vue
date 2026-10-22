<script setup lang="ts">
import { checkChat } from '@reviewer2/shared';
import { checkTalk, type ImpostorView, type OffFieldLine } from '@reviewer2/shared/impostor';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AvatarButton from '../../core/components/AvatarButton.vue';
import ChatThread, { type ChatSection, type ShownMessage } from '../../core/components/ChatThread.vue';
import type { ShownRoom } from '../../core/room';
import SeatAvatar from './SeatAvatar.vue';

// The off-field chat of the hidden word game (docs/games/impostor.md#off-field), on the chat that
// every game has (ChatThread.vue): while the game is on, for those who are out, watch or set the
// words, who all read what was said before they came; and after it, for everyone who has seen how it
// ended, under a heading of its own. Whoever played writes by their number, with how their game
// went, until the game is over and the numbers are known; whoever only watched or set the words, by
// name. A line may not name a word that the viewer knows while the game is on: the chat checks it
// against those, as the view carries them with their forms and the server holds the line against
// them (`known`). The line and its sending are the page's.
const props = defineProps<{
  room: ShownRoom;
  game: ImpostorView;
  setterId: string | null;
  sending: boolean;
  open: (number: number) => void;
}>();
const draft = defineModel<string>('draft', { required: true });
const emit = defineEmits<{ send: [] }>();
const { t } = useI18n();

type Message = ShownMessage & { line: OffFieldLine };
const playerOf = (id: string | null) =>
  id === null ? undefined : props.room.players.find((player) => player.id === id);
const seatOf = (number: number | null) => props.game.seats.find((seat) => seat.number === number);
const mine = (line: OffFieldLine) =>
  (line.number !== null && line.number === props.game.you?.number) ||
  (line.number === null && line.playerId === props.room.me);

function nameOf(line: OffFieldLine): string {
  if (mine(line)) return t('game.chat.you');
  const player = playerOf(line.playerId);
  if (line.number === null) {
    const role = line.playerId !== null && line.playerId === props.setterId ? 'setter' : 'spectator';
    return t('games.impostor.offField.named', {
      name: player?.name ?? t('game.chat.someone'),
      role: t(`games.impostor.offField.${role}`),
    });
  }
  const seat = seatOf(line.number);
  const label = t('games.impostor.number', { number: line.number });
  const name = player ? `${label} ${player.name}` : label;
  return seat && seat.fate !== 'alive' && !line.after
    ? t('games.impostor.offField.named', { name, role: t(`games.impostor.seat.states.${seat.fate}`) })
    : name;
}

const sections = computed<ChatSection<Message>[]>(() => {
  const lines = (props.game.offField ?? []).map((line) => ({
    id: line.id,
    own: mine(line),
    name: nameOf(line),
    text: line.text,
    line,
  }));
  const during = lines.filter((message) => !message.line.after);
  const after = lines.filter((message) => message.line.after);
  return [
    ...(during.length > 0 ? [{ key: 'during', title: null, messages: during }] : []),
    ...(after.length > 0 ? [{ key: 'after', title: t('games.impostor.offField.after'), messages: after }] : []),
  ];
});

const over = computed(() => props.game.phase === 'over');
const check = (text: string) => (over.value ? checkChat(text) : checkTalk(text, props.game.known));
const note = computed(() => {
  if (!props.game.mayTalk) return t('games.impostor.offField.readOnly');
  return over.value ? t('games.impostor.offField.afterNote') : t('games.impostor.offField.note');
});
</script>

<template>
  <ChatThread
    v-model:draft="draft"
    :sections="sections"
    :can-write="game.mayTalk"
    :sending="sending"
    :label="t('games.impostor.offField.input')"
    :empty="t('games.impostor.offField.empty')"
    :note="note"
    :check="check"
    @send="emit('send')"
  >
    <template #avatar="{ message }">
      <SeatAvatar
        v-if="message.line.number !== null"
        :number="message.line.number"
        :opens="() => open(message.line.number as number)"
      />
      <AvatarButton
        v-else-if="playerOf(message.line.playerId)"
        :player-id="message.line.playerId"
        :name="playerOf(message.line.playerId)?.name ?? ''"
        :username="playerOf(message.line.playerId)?.username"
        :guest="playerOf(message.line.playerId)?.guest"
        :avatar="playerOf(message.line.playerId)?.avatar"
      />
    </template>
  </ChatThread>
</template>
