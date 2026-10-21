<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from './UiButton.vue';
import UiSheet from './UiSheet.vue';

// The "Beta" beside the name of a game that is still being tested (docs/games/impostor.md#beta): a
// small sticker, which a tap opens, on a sheet that says what the beta means, that a big update
// may clear the game's records while the account and the records of other games stay, and where to
// send a word about it.
const props = defineProps<{ game: string }>();
const { t } = useI18n();
const open = ref(false);
</script>

<template>
  <button type="button" class="beta press press-small" aria-haspopup="dialog" @click="open = true">
    {{ t('beta.pill') }}
  </button>
  <UiSheet :open="open" :title="t('beta.title', { game: t(`games.${props.game}.name`) })" @close="open = false">
    <div class="about">
      <p>{{ t('beta.intro') }}</p>
      <p class="risk">{{ t('beta.risk') }}</p>
      <p class="hint">{{ t('beta.feedback') }}</p>
      <UiButton variant="primary" @click="open = false">{{ t('beta.ok') }}</UiButton>
    </div>
  </UiSheet>
</template>

<style scoped>
/* A small yellow sticker, as a title's pill: the thin outline, the small shadow and the press, and
   a reach of 44 px around it. */
.beta {
  position: relative;
  display: inline-block;
  margin-inline-start: var(--space-2);
  padding: 0 var(--space-2);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--bg);
  box-shadow: var(--shadow-0);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: var(--weight-black);
  line-height: 1.6;
  vertical-align: middle;
  cursor: pointer;
}

.beta::before {
  content: '';
  position: absolute;
  inset: calc(50% - 22px) -6px;
}

.beta:focus-visible {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

.about {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  line-height: 1.6;
}

.risk {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-card);
  background: var(--paper-2);
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}
</style>
