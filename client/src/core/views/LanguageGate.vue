<script setup lang="ts">
import { LANGUAGES, type Language } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import { HTML_LANG, setLanguage } from '../i18n';

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
    <p class="title num"><span class="tile" aria-hidden="true"></span>{{ t('app.name') }}</p>
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

.title {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  font-size: var(--text-3xl);
  font-weight: var(--weight-display);
}

.tile {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: var(--radius-control);
  background: var(--ink);
  color: var(--on-ink);
  font-size: var(--text-xl);
}

.tile::before {
  content: 'R2';
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
