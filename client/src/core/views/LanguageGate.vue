<script setup lang="ts">
import { LANGUAGES, type Language } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import { setLanguage } from '../i18n';

// The first visit to the home page starts with the choice of language, because it decides the
// words as well as the interface. Each option speaks its own language.
const emit = defineEmits<{ chosen: [language: Language] }>();
const { t } = useI18n();

const htmlLang = (language: Language) => (language === 'zh' ? 'zh-CN' : 'en');

function choose(language: Language) {
  setLanguage(language);
  emit('chosen', language);
}
</script>

<template>
  <main class="gate">
    <p class="title">{{ t('app.name') }}</p>
    <p class="tagline">
      <span v-for="language in LANGUAGES" :key="language" :lang="htmlLang(language)">
        {{ t('app.tagline', {}, { locale: language }) }}
      </span>
    </p>
    <div class="choices">
      <button
        v-for="language in LANGUAGES"
        :key="language"
        type="button"
        class="choice"
        :lang="htmlLang(language)"
        @click="choose(language)"
      >
        <span class="name">{{ t(`language.${language}`) }}</span>
        <span class="description">{{ t('gate.description', {}, { locale: language }) }}</span>
      </button>
    </div>
    <p class="prompt">
      <span v-for="language in LANGUAGES" :key="language" :lang="htmlLang(language)">
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
  gap: var(--space-5);
  max-width: 28rem;
  min-height: 100vh;
  min-height: 100dvh;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4);
  text-align: center;
}

.title {
  font-family: var(--font-serif);
  font-size: var(--text-3xl);
  font-weight: 600;
  font-variant-caps: all-small-caps;
  letter-spacing: 0.08em;
}

.tagline,
.prompt {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  color: var(--ink-2);
}

.prompt {
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.choices {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--ink);
  border-bottom: 1px solid var(--ink);
}

.choice {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-4) var(--space-2);
  border: 0;
  background: none;
  text-align: center;
  cursor: pointer;
}

.choice + .choice {
  border-top: 1px solid var(--rule);
}

.name {
  font-family: var(--font-serif);
  font-size: var(--text-xl);
  font-weight: 600;
}

.description {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

@media (hover: hover) {
  .choice:hover {
    background: var(--paper-2);
  }
}
</style>
