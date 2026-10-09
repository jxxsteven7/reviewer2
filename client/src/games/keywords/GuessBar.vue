<script setup lang="ts">
import type { KeywordsView } from '@reviewer2/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from '../../core/components/UiButton.vue';
import UiSheet from '../../core/components/UiSheet.vue';

// A student reveals cards in two steps: tap a card to choose it, then confirm here. That keeps
// a stray tap on a phone from revealing anything. Ending the turn asks for a confirmation too,
// since its button sits next to "Reveal" and the guesses it gives up can't be taken back.
const props = withDefaults(defineProps<{ game: KeywordsView; selected: number | null; busy?: boolean }>(), {
  busy: false,
});
const emit = defineEmits<{ reveal: [index: number]; pass: [] }>();
const { t } = useI18n();

const chosen = computed(() => (props.selected === null ? null : props.game.cards[props.selected]));

const passing = ref(false);
function pass() {
  passing.value = false;
  emit('pass');
}
</script>

<template>
  <div class="guess-bar">
    <p v-if="!chosen" class="hint">{{ t('game.pick') }}</p>
    <div class="buttons">
      <UiButton variant="primary" :disabled="!chosen || busy" @click="selected !== null && emit('reveal', selected)">
        {{ chosen ? t('game.reveal', { word: chosen.word }) : t('game.revealChoose') }}
      </UiButton>
      <UiButton :disabled="game.guessesMade === 0 || busy" @click="passing = true">{{ t('game.endTurn') }}</UiButton>
    </div>

    <UiSheet :open="passing" :title="t('game.endTurn')" @close="passing = false">
      <div class="confirm">
        <p>{{ t('game.endTurnConfirm') }}</p>
        <UiButton variant="primary" @click="pass">{{ t('game.endTurn') }}</UiButton>
        <UiButton variant="quiet" @click="passing = false">{{ t('lobby.manage.cancel') }}</UiButton>
      </div>
    </UiSheet>
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

/* Both buttons on one row, so that the bar stays low on a phone: the reveal button takes the
   room and wraps a long word, and "End the turn" keeps its width. */
.buttons {
  display: flex;
  gap: var(--space-3);
}

.buttons > :first-child {
  flex: 1 1 0;
  min-width: 0;
}

.buttons > :last-child {
  flex: 0 1 auto;
}

.confirm {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
</style>
