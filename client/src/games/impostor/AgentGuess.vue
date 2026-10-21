<script setup lang="ts">
import type { ImpostorView } from '@reviewer2/shared/impostor';
import { computed, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from '../../core/components/UiButton.vue';
import UiSheet from '../../core/components/UiSheet.vue';
import { formatList } from '../../core/i18n';
import { act } from '../../core/socket';
import { toast } from '../../core/toast';
import { useBusy } from '../../core/useBusy';
import SeatAvatar from './SeatAvatar.vue';

// Guessing which numbers the AI players were, after a game of the hidden word game with AI players
// and at least three people, for a person who played in it (docs/architecture.md#guessing-the-ai).
// The sheet opens as the game ends, and says that a right guess brings a reward, to get the player
// to guess; there is no time limit, and the player may skip it, or close the sheet and come back to
// it from the line on the page. Each number but the player's own is a choice, a card with the
// number's avatar, which opens its panel, and its role, which turns yellow when chosen, up to as
// many as there were AI players. Once the player has guessed, or skipped, a toast owns up that there
// is no reward, and says who the AI players were; the page then shows whose number was whose.
const props = defineProps<{ game: ImpostorView; open: (number: number) => void }>();
const { t, locale } = useI18n();
const { busy, run } = useBusy();
const group = useId();

const pending = computed(() => props.game.guess !== null && props.game.guess.guess === undefined);
const agents = computed(() => props.game.guess?.agents ?? 0);
const shown = ref(pending.value);
const chosen = ref<number[]>([]);
watch(
  () => props.game.gameId,
  () => {
    shown.value = pending.value;
    chosen.value = [];
  },
);

const seats = computed(() => props.game.seats.filter((seat) => seat.number !== props.game.you?.number));
const label = (numbers: number[]) =>
  formatList(
    locale.value,
    numbers.map((number) => t('games.impostor.number', { number })),
  );

function toggle(number: number) {
  if (chosen.value.includes(number)) chosen.value = chosen.value.filter((other) => other !== number);
  else if (chosen.value.length < agents.value) chosen.value = [...chosen.value, number];
  else chosen.value = [...chosen.value.slice(1), number];
}

const guess = (numbers: number[] | null) =>
  run(() => act('room:guessAgents', { gameId: props.game.gameId, guess: numbers })).then(() => {
    shown.value = false;
  });

// The toast once the numbers are known: the AI players are marked in the seats then.
watch(
  () => props.game.guess?.guess,
  (made, before) => {
    if (made === undefined || before !== undefined) return;
    const real = props.game.seats.filter((seat) => seat.agent).map((seat) => seat.number);
    const right = made !== null && made.length === real.length && made.every((number) => real.includes(number));
    toast(right ? 'games.impostor.guess.right' : 'games.impostor.guess.after', { numbers: label(real) }, 6000);
  },
);
</script>

<template>
  <p v-if="pending && !shown" class="prompt">
    <span>{{ t('games.impostor.guess.prompt') }}</span>
    <UiButton size="small" @click="shown = true">{{ t('games.impostor.guess.title') }}</UiButton>
  </p>
  <UiSheet :open="pending && shown" :title="t('games.impostor.guess.title')" @close="shown = false">
    <div class="guess">
      <p>{{ t('games.impostor.guess.reward', { count: agents }, agents) }}</p>
      <div class="choices" role="group" :aria-label="t('games.impostor.guess.title')">
        <label
          v-for="seat in seats"
          :key="seat.number"
          class="choice"
          :class="{ chosen: chosen.includes(seat.number) }"
        >
          <input
            type="checkbox"
            class="sr-only"
            :name="group"
            :checked="chosen.includes(seat.number)"
            @change="toggle(seat.number)"
          />
          <SeatAvatar :number="seat.number" size="medium" :opens="() => open(seat.number)" />
          <span v-if="seat.role" class="role">{{ t(`games.impostor.roles.${seat.role}`) }}</span>
          <span class="sr-only">{{ t('games.impostor.number', { number: seat.number }) }}</span>
        </label>
      </div>
      <UiButton variant="primary" :disabled="busy || chosen.length === 0" @click="guess(chosen)">
        {{
          chosen.length === 0
            ? t('games.impostor.guess.choose')
            : t('games.impostor.guess.submit', { numbers: label([...chosen].sort((a, b) => a - b)) })
        }}
      </UiButton>
      <UiButton variant="quiet" :disabled="busy" @click="guess(null)">{{ t('games.impostor.guess.skip') }}</UiButton>
      <p class="hint">{{ t('games.impostor.guess.note') }}</p>
    </div>
  </UiSheet>
</template>

<style scoped>
.prompt {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-3);
  margin: var(--space-3) 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-card);
  background: var(--paper-2);
  font-weight: var(--weight-bold);
}

.guess {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.choices {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
}

/* A choice: the outline and no shadow, yellow once chosen (docs/rules/display.md#choices-and-fields). */
.choice {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-2);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-card);
  background: var(--paper);
  cursor: pointer;
}

.choice.chosen {
  background: var(--bg);
}

.choice:has(input:focus-visible) {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

.role {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
  text-align: center;
}
</style>
