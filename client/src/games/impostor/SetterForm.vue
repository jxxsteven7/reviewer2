<script setup lang="ts">
import type { Language } from '@reviewer2/shared';
import { checkSetterWords, MAX_LINE_INPUT, type ImpostorRoomData } from '@reviewer2/shared/impostor';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ChoiceRow from '../../core/components/ChoiceRow.vue';
import FieldFold from '../../core/components/FieldFold.vue';
import UiButton from '../../core/components/UiButton.vue';
import UiField from '../../core/components/UiField.vue';
import { errorKey } from '../../core/errors';
import { fields, loadFields } from '../../core/fields';
import { DEFAULT_FIELDS } from '../../core/practice';
import { act } from '../../core/socket';
import { useBusy } from '../../core/useBusy';

// The setter's two words, in the waiting room (docs/games/impostor.md#the-setter): word A, word B,
// the field they are of, in the fold that the room setup chooses lists in, and whether the setter
// is named if the pair is adopted into the word library, which they are by default. The game
// decides which word the students get. The form checks the words as the server does, two words
// that differ and fit on a card, and keeps what is typed until it is sent; the words that the
// server has come back with the room, and the form takes them up whenever they change.
const props = defineProps<{ words: ImpostorRoomData['setterWords']; language: Language }>();
const { t } = useI18n();
const { busy, run } = useBusy();

const a = ref(props.words?.a ?? '');
const b = ref(props.words?.b ?? '');
const field = ref<string[]>([props.words?.field ?? DEFAULT_FIELDS[0] ?? 'general']);
const named = ref(props.words?.named ?? true);
watch(
  () => props.words,
  (words) => {
    if (!words) return;
    a.value = words.a;
    b.value = words.b;
    field.value = [words.field];
    named.value = words.named;
  },
);
loadFields();

const problem = computed(() => checkSetterWords(a.value, b.value));
// Whether the form says what is wrong: once both words have something in them.
const shownProblem = computed(() =>
  problem.value && a.value.trim() && b.value.trim() ? t(errorKey(problem.value)) : undefined,
);
const saved = computed(
  () =>
    props.words !== null &&
    props.words.a === a.value.trim() &&
    props.words.b === b.value.trim() &&
    props.words.field === field.value[0] &&
    props.words.named === named.value,
);
const send = () =>
  run(() => act('impostor:words', { a: a.value, b: b.value, field: field.value[0], named: named.value }));
</script>

<template>
  <section class="setter panel">
    <h2 class="section-title">{{ t('games.impostor.setter.title') }}</h2>
    <form class="form" @submit.prevent="send">
      <UiField v-model="a" :label="t('games.impostor.setter.a')" :maxlength="MAX_LINE_INPUT" />
      <UiField v-model="b" :label="t('games.impostor.setter.b')" :maxlength="MAX_LINE_INPUT" :error="shownProblem" />
      <FieldFold v-model="field" :fields="fields" :language="language" game="impostor" single />
      <ChoiceRow :option="t('games.impostor.setter.named')" :hint="t('games.impostor.setter.namedHint')">
        <input v-model="named" type="checkbox" />
      </ChoiceRow>
      <p class="hint">{{ t('games.impostor.setter.note') }}</p>
      <UiButton type="submit" variant="primary" :disabled="busy || problem !== null || saved">
        {{ t(saved ? 'games.impostor.setter.saved' : 'games.impostor.setter.submit') }}
      </UiButton>
    </form>
  </section>
</template>

<style scoped>
/* As wide as the panel, whatever the page lines its panels' contents up by. */
.form {
  display: flex;
  flex-direction: column;
  align-self: stretch;
  gap: var(--space-3);
  min-width: 0;
  margin-top: var(--space-3);
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}
</style>
