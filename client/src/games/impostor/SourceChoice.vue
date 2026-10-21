<script setup lang="ts">
import type { ImpostorSettings } from '@reviewer2/shared/impostor';
import { useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { account } from '../../core/account';
import ChoiceRow from '../../core/components/ChoiceRow.vue';

// Where the words of a room of the hidden word game come from, which the room setup asks before the
// word lists (GameScreens.Source): the word library, by the lists chosen, or a setter, the chair,
// who sets the two words in the waiting room and watches the game (docs/games/impostor.md
// #the-setter). A setter needs an account, and keeps the room private.
const model = defineModel<ImpostorSettings>({ required: true });
const { t } = useI18n();
const group = useId();
const choose = (setter: boolean) => (model.value = { ...model.value, setter });
</script>

<template>
  <fieldset class="source">
    <legend>{{ t('games.impostor.source.title') }}</legend>
    <ChoiceRow :option="t('games.impostor.source.library')" :hint="t('games.impostor.source.libraryHint')">
      <input type="radio" :name="group" :checked="!model.setter" @change="choose(false)" />
    </ChoiceRow>
    <ChoiceRow
      :option="t('games.impostor.source.setter')"
      :hint="t(account.summary ? 'games.impostor.source.setterHint' : 'games.impostor.source.setterNeedsAccount')"
    >
      <input type="radio" :name="group" :checked="model.setter" :disabled="!account.summary" @change="choose(true)" />
    </ChoiceRow>
  </fieldset>
</template>

<style scoped>
.source {
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
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--weight-display);
}
</style>
