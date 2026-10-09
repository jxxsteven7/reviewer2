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
    <label>
      <input v-model="play" type="radio" :name="group" :value="true" />
      <span class="option">{{ t('room.join.play') }}</span>
      <span class="hint">{{ t('room.join.playHint') }}</span>
    </label>
    <label>
      <input v-model="play" type="radio" :name="group" :value="false" />
      <span class="option">{{ t('room.join.watch') }}</span>
      <span class="hint">{{ t('room.join.watchHint') }}</span>
    </label>
  </fieldset>
</template>

<style scoped>
.play-choice {
  align-self: stretch;
  margin: 0;
  padding: 0;
  border: 0;
}

legend {
  margin-bottom: var(--space-1);
  padding: 0;
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: 500;
}

label {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 0 var(--space-3);
  min-height: 48px;
  padding: var(--space-2) 0;
  cursor: pointer;
}

label + label {
  border-top: 1px solid var(--rule);
}

input {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--ink);
}

.hint {
  grid-column: 2;
  color: var(--ink-3);
  font-size: var(--text-sm);
}
</style>
