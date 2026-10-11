<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { account, loadAccount } from '../account';
import LanguageSwitch from '../components/LanguageSwitch.vue';
import PageMasthead from '../components/PageMasthead.vue';
import { connection, reconnect } from '../socket';
import ProfileView from './ProfileView.vue';
import SignIn from './SignIn.vue';

// The account page: logging in or registering for a browser that isn't logged in, and the
// account's own page for one that is (docs/architecture.md).
//
// A public room sends a guest here with the way back as `next` (RoomNotice): the room, or the
// screen of one; no other path is honored. Logging in leads back there. A page that is logged in
// already, as when the player logged in from another tab, goes back at once, with a new
// connection: the one it has was made as a guest, which the room refused.
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const next = computed(() => {
  const { next: wanted } = route.query;
  return typeof wanted === 'string' && /^\/room\/[A-Za-z0-9]+(\/screen)?$/.test(wanted) ? wanted : undefined;
});

onMounted(async () => {
  await loadAccount();
  if (!account.summary || !next.value) return;
  if (connection.everConnected) reconnect();
  await router.replace(next.value);
});
</script>

<template>
  <div class="page account-page">
    <PageMasthead><LanguageSwitch /></PageMasthead>
    <main>
      <RouterLink to="/" class="back">{{ t('account.back') }}</RouterLink>
      <p v-if="!account.loaded" class="loading">{{ t('account.loading') }}</p>
      <ProfileView v-else-if="account.summary" :summary="account.summary" />
      <SignIn v-else :next="next" />
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

.loading {
  margin-top: var(--space-5);
  font-weight: var(--weight-bold);
}
</style>
