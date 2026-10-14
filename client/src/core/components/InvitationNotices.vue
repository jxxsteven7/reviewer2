<script setup lang="ts">
import { formatCode } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { forget, ignore, invitations } from '../friends';
import PlayerAvatar from './PlayerAvatar.vue';
import UiButton from './UiButton.vue';

// The invitations to rooms that this account has received (docs/architecture.md#friends), in the
// column of short messages at the top of whatever page is open: who invited them to which room,
// with the way in and the way to ignore it. An inviter whom the account has given a name of its
// own goes by it, with the username after it. Joining takes the invitation along, which stands in
// for the room's code, and so leads into a private room too; the server uses it up once the
// player is in.
const { t } = useI18n();
const router = useRouter();

function join(id: string, code: string): void {
  forget(id);
  void router.push({ path: `/room/${code}`, query: { invite: id } });
}
</script>

<template>
  <div v-for="invitation in invitations" :key="invitation.id" class="invitation" role="status">
    <p class="line">
      <PlayerAvatar :name="invitation.from.username" :avatar="invitation.from.avatar" />
      <span>{{
        t('friends.invitation', {
          name: invitation.from.alias
            ? t('friends.aliasWithName', { alias: invitation.from.alias, username: invitation.from.username })
            : invitation.from.username,
          code: formatCode(invitation.code),
        })
      }}</span>
    </p>
    <div class="actions">
      <UiButton variant="primary" size="small" @click="join(invitation.id, invitation.code)">
        {{ t('friends.invitationJoin') }}
      </UiButton>
      <UiButton variant="quiet" size="small" @click="ignore(invitation.id)">{{
        t('friends.invitationIgnore')
      }}</UiButton>
    </div>
  </div>
</template>

<style scoped>
.invitation {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--paper);
  box-shadow: var(--shadow-1);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  pointer-events: auto;
}

.line {
  display: flex;
  flex: 1 1 12rem;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  overflow-wrap: anywhere;
}

.actions {
  display: flex;
  flex: none;
  gap: var(--space-1);
}
</style>
