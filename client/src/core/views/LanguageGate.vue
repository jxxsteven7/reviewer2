<script setup lang="ts">
import { LANGUAGES, type Language } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import { HTML_LANG, setLanguage } from '../i18n';
import SiteWordmark from '../components/SiteWordmark.vue';

// The first visit to the home page starts with the choice of language, because it decides the
// words as well as the interface. Each option speaks its own language.
const emit = defineEmits<{ chosen: [language: Language] }>();
const { t } = useI18n();

function choose(language: Language) {
  setLanguage(language);
  emit('chosen', language);
}
</script>

<template>
  <main class="gate">
    <SiteWordmark class="title" size="large" :link="false" />
    <p class="tagline">
      <span v-for="language in LANGUAGES" :key="language" :lang="HTML_LANG[language]" class="display">
        {{ t('app.tagline', {}, { locale: language }) }}
      </span>
    </p>
    <div class="choices">
      <button
        v-for="language in LANGUAGES"
        :key="language"
        type="button"
        class="choice"
        :lang="HTML_LANG[language]"
        @click="choose(language)"
      >
        <span class="name">{{ t(`language.${language}`) }}</span>
        <span class="description">{{ t('gate.description', {}, { locale: language }) }}</span>
      </button>
    </div>
    <p class="prompt">
      <span v-for="language in LANGUAGES" :key="language" :lang="HTML_LANG[language]">
        {{ t('gate.title', {}, { locale: language }) }}
      </span>
    </p>
  </main>
</template>

<style scoped>
.gate {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--space-6);
  max-width: 28rem;
  min-height: 100vh;
  min-height: 100dvh;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4);
  text-align: center;
}

/* Centered, as the rest; the wordmark itself is a row. */
.title {
  align-self: center;
}

.tagline,
.prompt {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.tagline {
  font-size: var(--text-xl);
}

.prompt {
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.choices {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.choice {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-4) var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
  text-align: center;
  cursor: pointer;
  transition:
    transform var(--motion),
    box-shadow var(--motion);
}

.choice:active {
  transform: translate(var(--shift-2), var(--shift-2));
  box-shadow: none;
}

.name {
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  font-weight: var(--weight-display);
  font-synthesis: none;
}

.description {
  color: var(--ink-2);
  font-size: var(--text-sm);
}
</style>
