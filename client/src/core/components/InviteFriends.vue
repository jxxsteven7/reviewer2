<script setup lang="ts">
import type { RoomView } from '@reviewer2/shared';
import { computed, reactive, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { errorKey } from '../errors';
import { send } from '../socket';
import { toastError } from '../toast';
import { useBusy } from '../useBusy';
import { useFriendsList } from '../useFriendsList';
import PlayerAvatar from './PlayerAvatar.vue';
import UiButton from './UiButton.vue';
import UiSheet from './UiSheet.vue';

// The sheet from which a member invites friends into the room (docs/architecture.md#friends): the
// friends who are online and not here yet, each with a button, which says "Invited" once they are.
// The list is asked for whenever the sheet opens, since who is online changes all the time. A
// friend goes by the name the account gives them, if any, with the username after it.
const props = defineProps<{ open: boolean; room: RoomView }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const { view, failed, load } = useFriendsList(toRef(props, 'open'));
const invited = reactive(new Set<string>());
const { busy, run } = useBusy();

watch(
  () => props.open,
  (open) => {
    if (open) invited.clear();
  },
);

// A member with an account is called by their username, so a friend whose name is in the room is
// here already; the server refuses the others that are, should the names not tell.
const here = computed(() => new Set(props.room.players.map(({ name }) => name)));
const online = computed(() => (view.value?.friends ?? []).filter((friend) => friend.online));
const candidates = computed(() => online.value.filter((friend) => !here.value.has(friend.username)));

async function invite(username: string) {
  const reply = await run(() => send('friends:invite', { username }));
  if (!reply) return;
  if (reply.ok) invited.add(username);
  else toastError(reply.error);
}
</script>

<template>
  <UiSheet :open="open" :title="t('friends.invite')" @close="emit('close')">
    <div class="invite">
      <p class="hint">{{ t('friends.inviteIntro') }}</p>
      <p v-if="failed" class="hint">{{ t(errorKey(failed)) }}</p>
      <p v-else-if="view === null" class="hint">{{ t('friends.loading') }}</p>
      <p v-else-if="online.length === 0" class="hint">{{ t('friends.inviteNone') }}</p>
      <p v-else-if="candidates.length === 0" class="hint">{{ t('friends.inviteAllHere') }}</p>
      <ul v-else class="friends">
        <li v-for="friend in candidates" :key="friend.username" class="friend">
          <PlayerAvatar :name="friend.username" :avatar="friend.avatar" />
          <span class="name"
            >{{ friend.alias ?? friend.username
            }}<small v-if="friend.alias" class="username">{{ friend.username }}</small></span
          >
          <UiButton size="small" :disabled="busy || invited.has(friend.username)" @click="invite(friend.username)">
            {{ t(invited.has(friend.username) ? 'friends.invited' : 'friends.inviteOne') }}
          </UiButton>
        </li>
      </ul>
      <UiButton v-if="view !== null || failed" variant="quiet" size="small" :disabled="busy" @click="load">{{
        t('friends.refresh')
      }}</UiButton>
    </div>
  </UiSheet>
</template>

<style scoped>
.invite {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.friends {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-self: stretch;
  margin: 0;
  padding: 0;
  list-style: none;
}

.friend {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
}

.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-weight: var(--weight-bold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.username {
  margin-left: var(--space-2);
  color: var(--ink-2);
  font-size: var(--text-xs);
}
</style>
