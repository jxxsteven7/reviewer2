<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { account, loadAccount } from '../account';
import LanguageSwitch from '../components/LanguageSwitch.vue';
import PageMasthead from '../components/PageMasthead.vue';
import ProfileView from './ProfileView.vue';
import SignIn from './SignIn.vue';

// The account page: logging in or registering for a browser that isn't logged in, and the
// account's own page for one that is (docs/architecture.md).
//
// A public room sends a guest here with the way back as `next` (RoomNotice): the room, or the
// screen of one; no other path is honored. Logging in leads back there. A page that is logged in
// already, as when the player logged in from another tab, goes back at once; its connection, made
// as a guest, which the room refused, is made again by loadAccount() (account.ts). With
// `register`, the form opens on registering, as the home page's way to practice asks for a guest.
//
// The account's own page is for a page that stays. One that is about to leave keeps showing what
// it showed, the loading line or the form, busy, until the navigation lands: the account's own page
// would be built and torn down at once, with its requests, and the player would see it flash. A
// login elsewhere, as in another tab, still turns the form into it.
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const next = computed(() => {
  const { next: wanted } = route.query;
  return typeof wanted === 'string' && /^\/room\/[A-Za-z0-9]+(\/screen)?$/.test(wanted) ? wanted : undefined;
});
// Whether the form is logging in, and then leaving (SignIn).
const signingIn = ref(false);
// Whether the page is on its way back to the room: one opened with `next` may be, until the server
// has said whether the browser is logged in.
const leaving = ref(next.value !== undefined);

onMounted(async () => {
  await loadAccount();
  if (!account.summary || !next.value) {
    leaving.value = false;
    return;
  }
  await router.replace(next.value);
});
</script>

<template>
  <div class="page account-page">
    <PageMasthead><LanguageSwitch /></PageMasthead>
    <main>
      <SignIn
        v-if="signingIn || (account.loaded && !account.summary)"
        v-model:busy="signingIn"
        :next="next"
        :register="route.query.register !== undefined"
      />
      <ProfileView v-else-if="account.summary && !leaving" :summary="account.summary" />
      <p v-else class="loading">{{ t('account.loading') }}</p>
    </main>
  </div>
</template>

<style scoped>
main {
  padding: var(--space-3) 0 var(--space-7);
}

.loading {
  margin-top: var(--space-5);
  font-weight: var(--weight-bold);
}
</style>
