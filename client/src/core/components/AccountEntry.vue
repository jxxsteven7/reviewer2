<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { account } from '../account';
import PlayerAvatar from './PlayerAvatar.vue';

// The way to the account from the masthead of the home page and of a player's page: "Log in /
// Register", or the avatar of the account that the browser is logged in to, with a badge that
// counts the friend requests waiting for an answer. Rooms have none, so that nobody logs in or out
// in the middle of a game.
const { t } = useI18n();
</script>

<template>
  <template v-if="account.loaded">
    <RouterLink
      v-if="account.summary"
      to="/account"
      class="entry avatar-link"
      :aria-label="
        account.summary.requests > 0
          ? t(
              'account.entryRequests',
              { name: account.summary.username, count: account.summary.requests },
              account.summary.requests,
            )
          : t('account.entryLabel', { name: account.summary.username })
      "
    >
      <PlayerAvatar :name="account.summary.username" :avatar="account.summary.avatar" size="medium" />
      <span v-if="account.summary.requests > 0" class="badge num" aria-hidden="true">{{
        account.summary.requests
      }}</span>
    </RouterLink>
    <RouterLink v-else to="/account" class="entry pill">{{ t('account.entry') }}</RouterLink>
  </template>
</template>

<style scoped>
.entry {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: var(--ink);
  font-size: var(--text-sm);
  text-decoration: none;
  white-space: nowrap;
}

.pill {
  padding: 0 var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--paper);
}

.avatar-link {
  position: relative;
  min-width: 44px;
  justify-content: center;
}

.badge {
  position: absolute;
  top: 2px;
  right: -4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border: var(--line-thin) solid var(--paper);
  border-radius: var(--radius-pill);
  background: var(--red);
  color: var(--on-red);
  font-size: var(--text-xs);
  font-weight: var(--weight-black);
  line-height: 1;
}
</style>
