<script setup lang="ts">
import type { KeywordsView } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from '../../core/components/UiButton.vue';

// A student reveals cards in two steps: tap a card to choose it, then confirm here. That keeps
// a stray tap on a phone from revealing anything.
const props = defineProps<{ game: KeywordsView; selected: number | null }>();
const emit = defineEmits<{ reveal: [index: number]; pass: [] }>();
const { t } = useI18n();

const chosen = computed(() => (props.selected === null ? null : props.game.cards[props.selected]));
</script>

<template>
  <div class="guess-bar">
    <p v-if="!chosen" class="hint">{{ t('game.pick') }}</p>
    <div class="buttons">
      <UiButton variant="primary" :disabled="!chosen" @click="selected !== null && emit('reveal', selected)">
        {{ chosen ? t('game.reveal', { word: chosen.word }) : t('game.revealChoose') }}
      </UiButton>
      <UiButton :disabled="game.guessesMade === 0" @click="emit('pass')">{{ t('game.endTurn') }}</UiButton>
    </div>
  </div>
</template>

<style scoped>
.guess-bar {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.hint {
  min-height: 1.2em;
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.buttons > :first-child {
  flex: 1 1 12rem;
}
</style>
