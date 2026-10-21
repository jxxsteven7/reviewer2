<script setup lang="ts">
import { type Language } from '@reviewer2/shared';
import {
  DESCRIPTION_LENGTH,
  settingsProblems,
  TIME_LIMIT,
  TIME_SETTINGS,
  type ImpostorSettings,
} from '@reviewer2/shared/impostor';
import { computed, reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ChoiceRow from '../../core/components/ChoiceRow.vue';
import UiField from '../../core/components/UiField.vue';

// The settings of a room of the hidden word game, for the room setup and the chair's desk: the
// rules a room may turn on or off, as checkbox rows, the seats shown by number, the PI, the guess
// after being voted out and the god view; and, typed, the time for each description and each vote,
// 0 for none, and how long a description may be. A number can be wrong while it is being typed: the
// form says what is wrong with each, and `valid` says whether the settings can be sent. The server
// checks them again.
const props = defineProps<{ language: Language }>();
const model = defineModel<ImpostorSettings>({ required: true });
const valid = defineModel<boolean>('valid', { default: true });
const { t } = useI18n();

type NumberSetting = 'length' | (typeof TIME_SETTINGS)[number];
const NUMBERS: readonly NumberSetting[] = [...TIME_SETTINGS, 'length'];
const FLAGS = ['anonymous', 'pi', 'comeback', 'godView'] as const;

// A whole number as it is typed, full-width digits from a Chinese keyboard included, or NaN for
// anything else, which the check refuses.
function parse(text: string): number {
  const plain = text.normalize('NFKC').trim();
  return /^\d{1,6}$/.test(plain) ? Number(plain) : Number.NaN;
}

const typed = reactive(
  Object.fromEntries(NUMBERS.map((key) => [key, String(model.value[key])])) as Record<NumberSetting, string>,
);
function type(key: NumberSetting, text: string) {
  typed[key] = text;
  model.value = { ...model.value, [key]: parse(text) };
}
watch(model, (settings) => {
  for (const key of NUMBERS) if (!Object.is(parse(typed[key]), settings[key])) typed[key] = String(settings[key]);
});

// A description is counted in characters in either language, but the ranges differ, so another
// language brings its own length.
watch(
  () => props.language,
  (language) => (model.value = { ...model.value, length: DESCRIPTION_LENGTH[language].default }),
);

const problems = computed(() => settingsProblems(model.value, props.language));
watch(problems, (found) => (valid.value = Object.keys(found).length === 0), { immediate: true });
const length = computed(() => DESCRIPTION_LENGTH[props.language]);

function error(key: NumberSetting): string | undefined {
  const problem = problems.value[key];
  if (!problem) return undefined;
  if (problem === 'not_whole') return t('settings.notWhole');
  return key === 'length' ? t('settings.lengthRange', length.value) : t('settings.timeRange', TIME_LIMIT);
}

const flip = (key: (typeof FLAGS)[number], on: boolean) => (model.value = { ...model.value, [key]: on });
</script>

<template>
  <div class="settings-form">
    <fieldset>
      <legend>{{ t('games.impostor.settings.rules') }}</legend>
      <ChoiceRow
        v-for="key in FLAGS"
        :key="key"
        :option="t(`games.impostor.settings.${key}`)"
        :hint="t(`games.impostor.settings.hints.${key}`)"
      >
        <input type="checkbox" :checked="model[key]" @change="flip(key, ($event.target as HTMLInputElement).checked)" />
      </ChoiceRow>
    </fieldset>

    <fieldset>
      <legend>{{ t('games.impostor.settings.numbers') }}</legend>
      <div class="numbers">
        <UiField
          v-for="key in NUMBERS"
          :key="key"
          :model-value="typed[key]"
          :label="t(`games.impostor.settings.boxes.${key}`)"
          :error="error(key)"
          inputmode="numeric"
          :maxlength="6"
          @update:model-value="type(key, $event)"
        />
      </div>
      <p class="hint">{{ t('games.impostor.settings.timesHint', length) }}</p>
    </fieldset>
  </div>
</template>

<style scoped>
.settings-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

fieldset {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
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

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

/* Three boxes side by side, which wrap on the narrowest phones. */
.numbers {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(6rem, 1fr));
  gap: var(--space-3);
}
</style>
