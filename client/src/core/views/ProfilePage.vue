<script setup lang="ts">
import { HANDLE } from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AccountEntry from '../components/AccountEntry.vue';
import LanguageSwitch from '../components/LanguageSwitch.vue';
import PageMasthead from '../components/PageMasthead.vue';
import PageTitle from '../components/PageTitle.vue';
import ProfileCard from '../components/ProfileCard.vue';
import { errorKey } from '../errors';
import { pageTitle, usePageHead } from '../head';

// A player's public page, /p/<handle> (docs/architecture.md#public-profiles), which anyone may
// open, with or without an account, from the link that its player shares: the site itself shows an
// account's page in a sheet (ProfilePanel.vue). The way back, when there is one, is on the bar of
// its title (PageTitle.vue). An address that can't be a handle is answered as the server answers a
// handle that is no account's. The tab's title names the player once the card has read who they
// are. Search engines may read the page but are asked not to list it: a player shares their page,
// not with the world's searches.
const props = defineProps<{ handle: string }>();
const { t } = useI18n();
const valid = computed(() => HANDLE.test(props.handle));
const name = ref('');
// The name goes with its handle: the page may move to another, whose card says its own, or to
// an address that can't be a handle, which has no card to say any.
watch(
  () => props.handle,
  () => {
    name.value = '';
  },
);
usePageHead(() => ({
  title: pageTitle(name.value ? t('site.profile', { name: name.value }) : t('playerPage.title')),
  noindex: true,
}));
</script>

<template>
  <div class="page player-page">
    <PageMasthead back><AccountEntry /><LanguageSwitch /></PageMasthead>
    <main>
      <PageTitle>{{ t('playerPage.title') }}</PageTitle>
      <section class="card">
        <ProfileCard v-if="valid" :handle="handle" @name="name = $event" />
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
