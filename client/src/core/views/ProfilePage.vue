<script setup lang="ts">
import { HANDLE } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AccountEntry from '../components/AccountEntry.vue';
import LanguageSwitch from '../components/LanguageSwitch.vue';
import PageMasthead from '../components/PageMasthead.vue';
import PageTitle from '../components/PageTitle.vue';
import ProfileCard from '../components/ProfileCard.vue';
import { errorKey } from '../errors';

// A player's public page, /p/<handle> (docs/architecture.md#public-profiles), which anyone may
// open, with or without an account, from the link that its player shares: the site itself shows an
// account's page in a sheet (ProfilePanel.vue). The way back, when there is one, is on the bar of
// its title (PageTitle.vue). An address that can't be a handle is answered as the server answers a
// handle that is no account's.
const props = defineProps<{ handle: string }>();
const { t } = useI18n();
const valid = computed(() => HANDLE.test(props.handle));
</script>

<template>
  <div class="page player-page">
    <PageMasthead back><AccountEntry /><LanguageSwitch /></PageMasthead>
    <main>
      <PageTitle>{{ t('playerPage.title') }}</PageTitle>
      <section class="card">
        <ProfileCard v-if="valid" :handle="handle" />
        <p v-else class="hint">{{ t(errorKey('no_such_profile')) }}</p>
      </section>
    </main>
  </div>
</template>

<style scoped>
main {
  padding-bottom: var(--space-7);
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 34rem;
  padding: var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}
</style>
