<script setup lang="ts">
import { LANGUAGES } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import { HTML_LANG, setLanguage } from '../i18n';

const { t, locale } = useI18n();
</script>

<template>
  <div class="language-switch" role="group" :aria-label="t('language.label')">
    <button
      v-for="language in LANGUAGES"
      :key="language"
      type="button"
      :lang="HTML_LANG[language]"
      :aria-pressed="locale === language"
      @click="setLanguage(language)"
    >
      {{ t(`language.${language}`) }}
    </button>
  </div>
</template>

<style scoped>
.language-switch {
  display: flex;
  align-items: center;
}

button {
  padding: var(--space-1) var(--space-2);
  border: 0;
  background: none;
  color: var(--ink-3);
  font-size: var(--text-sm);
  cursor: pointer;
}

button + button {
  border-left: 1px solid var(--rule);
}

button[aria-pressed='true'] {
  color: var(--ink);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.3em;
}
</style>
