<script setup lang="ts">
import { useId } from 'vue';
import { useI18n } from 'vue-i18n';
import ChoiceRow from './ChoiceRow.vue';

// Whether a newcomer comes to play or only to watch, when they create or join a room. The server
// gives a player a seat; a spectator can take one later.
const play = defineModel<boolean>({ required: true });
const { t } = useI18n();
const group = useId();
</script>

<template>
  <fieldset class="play-choice">
    <legend>{{ t('room.join.as') }}</legend>
    <ChoiceRow :option="t('room.join.play')" :hint="t('room.join.playHint')">
      <input v-model="play" type="radio" :name="group" :value="true" />
    </ChoiceRow>
    <ChoiceRow :option="t('room.join.watch')" :hint="t('room.join.watchHint')">
      <input v-model="play" type="radio" :name="group" :value="false" />
    </ChoiceRow>
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
</style>
