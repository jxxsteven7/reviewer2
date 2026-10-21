<script setup lang="ts">
import type { Language } from '@reviewer2/shared';
import type { KeywordsSettings } from '@reviewer2/shared/keywords';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import { GUIDE_PATH } from '../../core/guide/progress';
import UiButton from '../../core/components/UiButton.vue';
import UiSheet from '../../core/components/UiSheet.vue';
import { rulesSections } from './rules';
import SettingsSummary from './SettingsSummary.vue';

// "How to play", in the rules' own sections (rules.ts), as this room plays them, with all of its
// settings at the top, and at the end the way to the tutorial, for a player who would rather be
// shown: in a room it opens in a tab of its own, so that the game goes on in this one.
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

const sections = computed(() => rulesSections(t, props.settings, props.language));
const route = useRoute();
const inRoom = computed(() => route.path.startsWith('/room/'));
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
        <h3 class="section-title">{{ t(defaults ? 'rules.defaultsTitle' : 'settings.title') }}</h3>
        <SettingsSummary class="summary" :settings="settings" :language="language" :custom-words="customWords" />
      </section>
      <section v-for="section in sections" :key="section.title">
        <h3 class="section-title">{{ section.title }}</h3>
        <p v-for="line in section.text" :key="line">{{ line }}</p>
      </section>
      <RouterLink
        class="guide-link text-link"
        :to="GUIDE_PATH"
        :target="inRoom ? '_blank' : undefined"
        :rel="inRoom ? 'noopener' : undefined"
        @click="open = false"
        >{{ t('guide.rulesLink') }}</RouterLink
      >
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

.guide-link {
  align-self: flex-start;
  font-weight: var(--weight-bold);
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
