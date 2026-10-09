<script setup lang="ts">
import { useId } from 'vue';
import { useI18n } from 'vue-i18n';

// Whether a newcomer comes to play or only to watch, when they create or join a room. The server
// gives a player a seat; a spectator can take one later.
const play = defineModel<boolean>({ required: true });
const { t } = useI18n();
const group = useId();
</script>

<template>
  <fieldset class="play-choice">
    <legend>{{ t('room.join.as') }}</legend>
    <label class="choice">
      <input v-model="play" type="radio" :name="group" :value="true" />
      <span class="option">{{ t('room.join.play') }}</span>
      <span class="hint">{{ t('room.join.playHint') }}</span>
    </label>
    <label class="choice">
      <input v-model="play" type="radio" :name="group" :value="false" />
      <span class="option">{{ t('room.join.watch') }}</span>
      <span class="hint">{{ t('room.join.watchHint') }}</span>
    </label>
  </fieldset>
</template>

<style scoped>
.play-choice {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-self: stretch;
  margin: 0;
  padding: 0;
  border: 0;
}

legend {
  margin-bottom: var(--space-2);
  padding: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.choice {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 0 var(--space-3);
  min-height: 52px;
  padding: var(--space-2) var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--paper);
  cursor: pointer;
}

.choice:has(input:checked) {
  background: var(--bg);
}

.choice:has(input:focus-visible) {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

input {
  width: 20px;
  height: 20px;
  margin: 0;
  accent-color: var(--ink);
}

.option {
  font-weight: var(--weight-black);
}

.hint {
  grid-column: 2;
  color: var(--ink-2);
  font-size: var(--text-sm);
}
</style>
