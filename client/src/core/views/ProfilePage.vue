<script setup lang="ts">
import { HANDLE } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import AccountEntry from '../components/AccountEntry.vue';
import LanguageSwitch from '../components/LanguageSwitch.vue';
import PageMasthead from '../components/PageMasthead.vue';
import ProfileCard from '../components/ProfileCard.vue';
import { errorKey } from '../errors';

// A player's public page, /p/<handle> (docs/architecture.md#public-profiles), which anyone may
// open, with or without an account. An address that can't be a handle is answered as the server
// answers a handle that is no account's.
const props = defineProps<{ handle: string }>();
const { t } = useI18n();
const valid = computed(() => HANDLE.test(props.handle));
</script>

<template>
  <div class="page player-page">
    <PageMasthead><AccountEntry /><LanguageSwitch /></PageMasthead>
    <main>
      <RouterLink to="/" class="back">{{ t('account.back') }}</RouterLink>
      <section class="card">
        <h1>{{ t('playerPage.title') }}</h1>
        <ProfileCard v-if="valid" :handle="handle" />
        <p v-else class="hint">{{ t(errorKey('no_such_profile')) }}</p>
      </section>
    </main>
  </div>
</template>

<style scoped>
main {
  padding: var(--space-3) 0 var(--space-7);
}

.back {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  font-size: var(--text-sm);
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 34rem;
  margin-top: var(--space-3);
  padding: var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}

h1 {
  font-size: var(--text-2xl);
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}
</style>
