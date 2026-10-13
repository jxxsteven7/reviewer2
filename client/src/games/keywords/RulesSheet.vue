<script setup lang="ts">
import type { KeywordsSettings, Language } from '@reviewer2/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from '../../core/components/UiButton.vue';
import UiSheet from '../../core/components/UiSheet.vue';
import SettingsSummary from './SettingsSummary.vue';

// "How to play", in the rules' own sections, as this room plays them: its guess rule, its clue
// rule, its time limits and its extensions, with all of its settings at the top, and at the end what
// becomes of the record of the game (docs/architecture.md#game-records), which guests read here. A
// Chinese room also asks for no clue that sounds like a word on the board, which no program checks.
//
// In a room it opens from a quiet button. On the home page it opens from a `link`, the small word
// "Rules" beside the game's name, with the `defaults`, as a new room has them, and a word that each
// room may change them.
const props = withDefaults(
  defineProps<{
    settings: KeywordsSettings;
    language: Language;
    customWords?: number;
    link?: boolean;
    defaults?: boolean;
  }>(),
  { customWords: 0, link: false, defaults: false },
);
const { t } = useI18n();
const open = ref(false);

// What time does in this room: a line for the clues and one for the guesses, for the phases that
// have a limit, or one line when none has.
const time = computed(() => {
  const { firstClueTime, clueTime, guessTime, extensions } = props.settings;
  const limited = firstClueTime > 0 || clueTime > 0 || guessTime > 0;
  const lines = [
    ...(firstClueTime > 0 || clueTime > 0 ? [t('rules.timeClue')] : []),
    ...(guessTime > 0 ? [t('rules.timeGuess')] : []),
    ...(limited && extensions ? [t('rules.extension')] : []),
  ];
  return [...(lines.length > 0 ? [t('rules.time'), ...lines] : [t('rules.noTime')]), t('rules.pause')];
});
const sections = computed(() => [
  { title: t('rules.goalTitle'), text: [t('rules.goal')] },
  { title: t('rules.rolesTitle'), text: [t('rules.roles')] },
  { title: t('rules.turnTitle'), text: [t(`rules.turn.${props.settings.guessRule}`)] },
  { title: t('rules.revealTitle'), text: [t('rules.reveal')] },
  {
    title: t('rules.clueTitle'),
    text: [
      t(`rules.clue.${props.language}`, { count: props.settings.clueLength }, props.settings.clueLength),
      t('rules.clueCommon'),
      ...(props.language === 'zh' ? [t('rules.clueSound')] : []),
      t('rules.clueQuiet'),
      t('rules.clueTargets'),
      t(`rules.clueRule.${props.settings.clueRule}`),
    ],
  },
  { title: t('rules.timeTitle'), text: time.value },
  { title: t('rules.endTitle'), text: [t('rules.end')] },
  { title: t('privacy.recordsTitle'), text: [t('privacy.records')] },
]);
</script>

<template>
  <button v-if="link" type="button" class="rules-link" aria-haspopup="dialog" @click="open = true">
    {{ t('rules.link') }}
  </button>
  <UiButton v-else variant="quiet" size="small" @click="open = true">{{ t('rules.title') }}</UiButton>
  <UiSheet :open="open" :title="t('rules.title')" @close="open = false">
    <div class="rules sections">
      <p v-if="defaults" class="defaults">{{ t('rules.defaults') }}</p>
      <section>
        <h3 class="section-title">{{ t('settings.title') }}</h3>
        <SettingsSummary class="summary" :settings="settings" :language="language" :custom-words="customWords" />
      </section>
      <section v-for="section in sections" :key="section.title">
        <h3 class="section-title">{{ section.title }}</h3>
        <p v-for="line in section.text" :key="line">{{ line }}</p>
      </section>
    </div>
  </UiSheet>
</template>

<style scoped>
.rules {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.rules .section-title {
  font-size: var(--text-lg);
}

.rules p {
  margin-top: var(--space-1);
  color: var(--ink-2);
}

.summary {
  margin-top: var(--space-2);
}

.rules .defaults {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-card);
  background: var(--paper-2);
  color: var(--ink);
  font-size: var(--text-sm);
}

/* The small word beside the game's name: underlined text in the text font, whose box reaches 44 px
   high, and wide, out of sight, and which follows the name's last line. */
.rules-link {
  position: relative;
  margin-left: var(--space-2);
  padding: 0;
  border: 0;
  background: none;
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  line-height: 1.2;
  text-decoration: underline;
  text-decoration-thickness: 2px;
  text-underline-offset: 0.2em;
  white-space: nowrap;
  vertical-align: baseline;
  cursor: pointer;
}

.rules-link::before {
  content: '';
  position: absolute;
  inset: calc(50% - 22px) -8px;
}
</style>
