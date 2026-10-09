<script setup lang="ts">
import { onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { account, loadAccount } from '../account';
import LanguageSwitch from '../components/LanguageSwitch.vue';
import PageMasthead from '../components/PageMasthead.vue';
import ProfileView from './ProfileView.vue';
import SignIn from './SignIn.vue';

// The account page: logging in or registering for a browser that isn't logged in, and the
// account's own page for one that is (docs/architecture.md).
const { t } = useI18n();
onMounted(loadAccount);
</script>

<template>
  <div class="page account-page">
    <PageMasthead><LanguageSwitch /></PageMasthead>
    <main>
      <RouterLink to="/" class="back">{{ t('account.back') }}</RouterLink>
      <p v-if="!account.loaded" class="loading">{{ t('account.loading') }}</p>
      <ProfileView v-else-if="account.summary" :summary="account.summary" />
      <SignIn v-else />
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
