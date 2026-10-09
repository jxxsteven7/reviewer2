<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { account } from '../account';
import PlayerAvatar from './PlayerAvatar.vue';

// The way to the account from the home page's masthead: "Log in / Register", or the avatar of the
// account that the browser is logged in to. Rooms have none, so that nobody logs in or out in the
// middle of a game.
const { t } = useI18n();
</script>

<template>
  <template v-if="account.loaded">
    <RouterLink
      v-if="account.summary"
      to="/account"
      class="entry avatar-link"
      :aria-label="t('account.entryLabel', { name: account.summary.username })"
    >
      <PlayerAvatar :name="account.summary.username" :avatar="account.summary.avatar" size="medium" />
    </RouterLink>
    <RouterLink v-else to="/account" class="entry">{{ t('account.entry') }}</RouterLink>
  </template>
</template>

<style scoped>
.entry {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: var(--ink-2);
  font-size: var(--text-sm);
  white-space: nowrap;
}

.avatar-link {
  min-width: 44px;
  justify-content: center;
}
</style>
