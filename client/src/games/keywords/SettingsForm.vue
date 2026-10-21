<script setup lang="ts">
import { type Language } from '@reviewer2/shared';
import {
  CLUE_LENGTH,
  CLUE_RULES,
  GUESS_RULES,
  settingsProblems,
  TIME_LIMIT,
  TIME_SETTINGS,
  type KeywordsSettings,
} from '@reviewer2/shared/keywords';
import { computed, reactive, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import UiField from '../../core/components/UiField.vue';

// The settings of a room, for the room setup and the chair's desk: how the students guess, how
// strict the clue check is, how long a clue may be, and how much time each phase has. The numbers
// are typed, so one can be wrong while it is being typed: the form says what is wrong with each,
// and `valid` says whether the settings can be sent. The server checks them again.
const props = defineProps<{ language: Language }>();
const model = defineModel<KeywordsSettings>({ required: true });
const valid = defineModel<boolean>('valid', { default: true });
const { t } = useI18n();
const id = useId();

type NumberSetting = 'clueLength' | (typeof TIME_SETTINGS)[number];
const NUMBERS: readonly NumberSetting[] = ['clueLength', ...TIME_SETTINGS];

// A whole number as it is typed, full-width digits from a Chinese keyboard included, or NaN for
// anything else, which the check refuses.
function parse(text: string): number {
  const plain = text.normalize('NFKC').trim();
  return /^\d{1,6}$/.test(plain) ? Number(plain) : Number.NaN;
}

// What is in each box, which goes into the settings at every keystroke.
const typed = reactive(
  Object.fromEntries(NUMBERS.map((key) => [key, String(model.value[key])])) as Record<NumberSetting, string>,
);

function type(key: NumberSetting, text: string) {
  typed[key] = text;
  model.value = { ...model.value, [key]: parse(text) };
}

// Settings that change from elsewhere show in the boxes, unless the box says the same already.
watch(model, (settings) => {
  for (const key of NUMBERS) if (!Object.is(parse(typed[key]), settings[key])) typed[key] = String(settings[key]);
});

// A clue is counted in Chinese characters in a Chinese room and in words in an English one, so
// another language brings its own length.
watch(
  () => props.language,
  (language) => (model.value = { ...model.value, clueLength: CLUE_LENGTH[language].default }),
);

const problems = computed(() => settingsProblems(model.value, props.language));
watch(problems, (found) => (valid.value = Object.keys(found).length === 0), { immediate: true });

const length = computed(() => CLUE_LENGTH[props.language]);

function error(key: NumberSetting): string | undefined {
  const problem = problems.value[key];
  if (!problem) return undefined;
  if (problem === 'not_whole') return t('settings.notWhole');
  return key === 'clueLength' ? t('settings.lengthRange', length.value) : t('settings.timeRange', TIME_LIMIT);
}

const choose = (changes: Partial<KeywordsSettings>) => (model.value = { ...model.value, ...changes });
</script>

<template>
  <div class="settings-form">
    <fieldset>
      <legend>{{ t('settings.guessRule') }}</legend>
      <div class="options">
        <label v-for="rule in GUESS_RULES" :key="rule" :class="{ chosen: model.guessRule === rule }">
          <input
            type="radio"
            :name="`${id}-guess`"
            :value="rule"
            :checked="model.guessRule === rule"
            @change="choose({ guessRule: rule })"
          />
          {{ t(`settings.guess.${rule}`) }}
        </label>
      </div>
      <p class="hint">{{ t(`settings.guessHint.${model.guessRule}`) }}</p>
    </fieldset>

    <fieldset>
      <legend>{{ t('settings.clueRule') }}</legend>
      <div class="options">
        <label v-for="rule in CLUE_RULES" :key="rule" :class="{ chosen: model.clueRule === rule }">
          <input
            type="radio"
            :name="`${id}-clue`"
            :value="rule"
            :checked="model.clueRule === rule"
            @change="choose({ clueRule: rule })"
          />
          {{ t(`settings.clue.${rule}`) }}
        </label>
      </div>
      <p class="hint">{{ t(`settings.clueHint.${model.clueRule}`) }}</p>
    </fieldset>

    <div class="number">
      <UiField
        :model-value="typed.clueLength"
        :label="t(`settings.clueLength.${language}`)"
        :hint="t('settings.lengthRange', length)"
        :error="error('clueLength')"
        inputmode="numeric"
        :maxlength="6"
        @update:model-value="type('clueLength', $event)"
      />
    </div>

    <fieldset>
      <legend>{{ t('settings.times') }}</legend>
      <div class="times">
        <UiField
          v-for="key in TIME_SETTINGS"
          :key="key"
          :model-value="typed[key]"
          :label="t(`settings.${key}`)"
          :error="error(key)"
          inputmode="numeric"
          :maxlength="6"
          @update:model-value="type(key, $event)"
        />
      </div>
      <p class="hint">{{ t('settings.timesHint') }}</p>
    </fieldset>

    <fieldset>
      <legend>{{ t('settings.extensions') }}</legend>
      <div class="options">
        <label v-for="on in [true, false]" :key="String(on)" :class="{ chosen: model.extensions === on }">
          <input
            type="radio"
            :name="`${id}-extensions`"
            :value="on"
            :checked="model.extensions === on"
            @change="choose({ extensions: on })"
          />
          {{ t(`settings.extension.${on ? 'on' : 'off'}`) }}
        </label>
      </div>
      <p class="hint">{{ t('settings.extensionsHint') }}</p>
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

.options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.options label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: 0 var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--paper);
  font-weight: var(--weight-bold);
  cursor: pointer;
}

.options label.chosen {
  background: var(--bg);
}

.options label:focus-within {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

.options input {
  margin: 0;
  accent-color: var(--ink);
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.number {
  max-width: 16rem;
}

/* Three boxes side by side, which wrap on the narrowest phones. */
.times {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
  gap: var(--space-3);
}
</style>
