<script setup lang="ts">
import { LANGUAGES, type Language } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { HTML_LANG, setLanguage } from '../i18n';

// One button that switches to the other language, and shows that language's short name in that
// language: "EN" on the Chinese interface, "中文" on the English one. Its accessible name is the
// language's full name, so that a screen reader says what the button leads to.
const { t, locale } = useI18n();
const other = computed<Language>(() => LANGUAGES.find((language) => language !== locale.value) ?? 'en');
</script>

<template>
  <div class="language-switch" role="group" :aria-label="t('language.label')">
    <button type="button" :lang="HTML_LANG[other]" :aria-label="t(`language.${other}`)" @click="setLanguage(other)">
      {{ t(`language.short.${other}`) }}
    </button>
  </div>
</template>

<style scoped>
.language-switch {
  display: inline-flex;
}

button {
  min-height: 44px;
  padding: 0 var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--ink);
  font-family: var(--font-number);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  cursor: pointer;
}

button:active {
  background: var(--paper);
}
</style>
