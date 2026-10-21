<script setup lang="ts">
import type { SeatView } from '@reviewer2/shared/impostor';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import SeatAvatar from './SeatAvatar.vue';
import type { SeatState } from './seats';

// A seat of the hidden word game on the board (docs/rules/display.md#the-second-game): a card for
// each number, the same in every phase, with the number's avatar, which opens the seat's panel
// (SeatPanel.vue), how the seat stands, as a tag, the name of whoever sits there, where the viewer
// may know it, and the line the number wrote this round. The tag of the one writing now, the
// viewer's own and that of a seat out of the game are ink pills; the others, "said" and "waiting",
// grey words. A seat out of the game is grey, its avatar under the veil, and says how it went out.
//
// During a vote, a card that the viewer may vote for is a choice (`choosable`), with its radio out
// of sight: a tap anywhere on it but its avatar chooses it, and the chosen one turns yellow; the
// others, the viewer's own, those out and in a revote those not tied, are `grey`. The avatar still
// opens the panel.
const props = withDefaults(
  defineProps<{
    seat: SeatView;
    state: SeatState;
    line: { text: string | null } | null;
    name?: string | null;
    mine?: boolean;
    choosable?: boolean;
    chosen?: boolean;
    grey?: boolean;
    group?: string;
    opens?: (() => void) | null;
  }>(),
  { name: null, mine: false, choosable: false, chosen: false, grey: false, group: '', opens: null },
);
const emit = defineEmits<{ choose: [number: number] }>();
const { t } = useI18n();

const out = computed(() => props.seat.fate !== 'alive');
const inked = computed(() => out.value || props.state === 'writing');
// What a seat out of the game says in place of a line.
const fate = computed(() =>
  props.seat.fate === 'voted_out'
    ? t('games.impostor.seat.votedOutIn', { round: props.seat.out ?? 0 })
    : t(`games.impostor.seat.${props.seat.fate === 'violation' ? 'violation' : 'left'}`),
);
const text = computed(() => {
  if (out.value) return fate.value;
  if (!props.line) return null;
  return props.line.text ?? t('games.impostor.seat.noLine');
});
</script>

<template>
  <component
    :is="choosable ? 'label' : 'div'"
    class="seat-card"
    :class="{ out, mine, chosen, choosable, grey: out || grey }"
  >
    <input
      v-if="choosable"
      type="radio"
      class="sr-only"
      :name="group"
      :value="seat.number"
      :checked="chosen"
      @change="emit('choose', seat.number)"
    />
    <span class="top">
      <SeatAvatar :number="seat.number" size="medium" :faded="out" :opens="opens" />
      <span class="tags">
        <span v-if="mine" class="tag-pill">{{ t('games.impostor.seat.you') }}</span>
        <span :class="inked ? 'tag-pill' : 'state'">{{ t(`games.impostor.seat.states.${state}`) }}</span>
      </span>
    </span>
    <span v-if="name" class="name">{{ name }}</span>
    <span v-if="text" class="text" :class="{ none: !out && line?.text === null }">{{ text }}</span>
    <span v-if="choosable" class="sr-only">{{ t('games.impostor.vote.for', { number: seat.number }) }}</span>
  </component>
</template>

<style scoped>
/* A white card with the outline and no shadow: it can't be pressed but as a choice in a vote, and
   a choice has no shadow either (docs/rules/display.md#choices-and-fields). */
.seat-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  min-height: 7.5rem;
  padding: var(--space-3);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-card);
  background: var(--paper);
  overflow-wrap: anywhere;
}

.seat-card.grey {
  border-color: var(--neutral);
  background: var(--paper-2);
  color: var(--ink-2);
}

.choosable {
  cursor: pointer;
}

.chosen {
  background: var(--bg);
}

.choosable:has(input:focus-visible) {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

.top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-1);
}

.tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-1);
  min-width: 0;
}

.state {
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
}

.name {
  font-size: var(--text-xs);
  font-weight: var(--weight-black);
}

.text {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  line-height: 1.4;
}

.text.none {
  color: var(--ink-2);
}
</style>
