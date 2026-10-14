<script setup lang="ts">
import type { JoinAskView } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { asks, dismissAsk } from '../friends';
import { room } from '../room';
import { send } from '../socket';
import { toast, toastError } from '../toast';
import { useBusy } from '../useBusy';
import PlayerAvatar from './PlayerAvatar.vue';
import UiButton from './UiButton.vue';

// The requests of friends to be let into the room (docs/architecture.md#friends), in the column of
// short messages at the top of the room's page, for a member and not a screen: who would like to
// join, with the way to invite them and the way to ignore it. Inviting sends the invitation that
// the waiting room's list of friends sends, which answers the request; a refusal, such as an
// invitation sent a moment ago, leaves the request on the page. A friend whom the account has given
// a name of its own goes by it, with the username after it.
const { t } = useI18n();
const { busy, run } = useBusy();

const shown = computed(() => {
  const view = room.value;
  return view && view.me !== null ? asks.filter((ask) => ask.roomId === view.roomId) : [];
});

const nameOf = (ask: JoinAskView) =>
  ask.from.alias
    ? t('friends.aliasWithName', { alias: ask.from.alias, username: ask.from.username })
    : ask.from.username;

async function invite(ask: JoinAskView) {
  const reply = await run(() => send('friends:invite', { username: ask.from.username }));
  if (!reply) return;
  if (reply.ok) toast('friends.askInvited', { name: nameOf(ask) });
  else toastError(reply.error);
}
</script>

<template>
  <div v-for="ask in shown" :key="ask.id" class="join-ask" role="status">
    <p class="line">
      <PlayerAvatar :name="ask.from.username" :avatar="ask.from.avatar" />
      <span>{{ t('friends.askNotice', { name: nameOf(ask) }) }}</span>
    </p>
    <div class="actions">
      <UiButton variant="primary" size="small" :disabled="busy" @click="invite(ask)">
        {{ t('friends.askInvite') }}
      </UiButton>
      <UiButton variant="quiet" size="small" @click="dismissAsk(ask.id)">{{ t('friends.askIgnore') }}</UiButton>
    </div>
  </div>
</template>

<style scoped>
.join-ask {
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
