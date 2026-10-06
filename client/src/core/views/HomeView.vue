<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import LanguageSwitch from '../components/LanguageSwitch.vue';

const { t } = useI18n();
const version = __APP_VERSION__;
</script>

<template>
  <div class="page">
    <header class="masthead">
      <span class="wordmark">{{ t('app.name') }}</span>
      <LanguageSwitch />
    </header>

    <main>
      <p class="status small-caps">{{ t('home.status') }}</p>
      <h1>{{ t('app.tagline') }}</h1>
      <p class="intro">{{ t('home.intro') }}</p>
      <hr />
      <p>{{ t('home.first') }}</p>
    </main>

    <footer class="footnotes">
      <p>{{ t('footer.noSignUp') }}</p>
      <p>{{ t('footer.build', { version }) }}</p>
    </footer>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  max-width: var(--measure);
  min-height: 100vh;
  min-height: 100dvh;
  margin: 0 auto;
  padding: max(var(--space-4), env(safe-area-inset-top)) var(--space-4) max(var(--space-4), env(safe-area-inset-bottom));
}

.masthead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--ink);
}

.wordmark {
  font-family: var(--font-serif);
  font-size: var(--text-lg);
  font-weight: 600;
  font-variant-caps: all-small-caps;
  letter-spacing: 0.08em;
}

main {
  flex: 1;
}

.status {
  margin-bottom: var(--space-2);
  color: var(--red);
  font-size: var(--text-sm);
}

h1 {
  font-size: var(--text-2xl);
}

.intro {
  margin-top: var(--space-4);
  color: var(--ink-2);
  font-size: var(--text-lg);
}

.footnotes {
  padding-top: var(--space-3);
  border-top: 1px solid var(--rule);
  color: var(--ink-3);
  font-size: var(--text-xs);
}

@media (min-width: 40rem) {
  .page {
    padding-inline: var(--space-5);
  }

  h1 {
    font-size: var(--text-3xl);
  }
}
</style>
