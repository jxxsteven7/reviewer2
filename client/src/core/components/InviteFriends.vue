<script setup lang="ts">
import type { RoomView } from '@reviewer2/shared';
import { computed, reactive, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { errorKey } from '../errors';
import { send } from '../socket';
import { toastError } from '../toast';
import { useBusy } from '../useBusy';
import { useFriendsList } from '../useFriendsList';
import PlayerAvatar from './PlayerAvatar.vue';
import UiButton from './UiButton.vue';
import UiSheet from './UiSheet.vue';

// The sheet from which a member invites friends into the room (docs/architecture.md#friends): every
// friend who isn't here yet, those online first, in their own colors with a green dot, and those
// offline after them, faded, each with a button, which for a friend offline says that they will see
// the invitation once they come online, and "Invited" once they are, as long as the invitation
// stands: the room's view says whom the viewer has invited (RoomView.invited), so the sheet says it
// again when it opens again. The list is asked for whenever the sheet opens, since who is online
// changes all the time. A friend goes by the name the account gives them, if any, with the username
// after it.
const props = defineProps<{ open: boolean; room: RoomView }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const { view, failed, load } = useFriendsList(toRef(props, 'open'));
// Those invited from this sheet, until the room's view says so.
const sent = reactive(new Set<string>());
const invited = (username: string) =>
  sent.has(username) || (props.room.invited ?? []).some((friend) => friend.username === username);
const { busy, run } = useBusy();

// A member with an account is called by their username, so a friend whose name is in the room is
// here already; the server refuses the others that are, should the names not tell.
const here = computed(() => new Set(props.room.players.map(({ name }) => name)));
const friends = computed(() => view.value?.friends ?? []);
const candidates = computed(() => {
  const away = friends.value.filter((friend) => !here.value.has(friend.username));
  return [...away.filter((friend) => friend.online), ...away.filter((friend) => !friend.online)];
});

async function invite(username: string) {
  const reply = await run(() => send('friends:invite', { username }));
  if (!reply) return;
  if (reply.ok) sent.add(username);
  else toastError(reply.error);
}
</script>

<template>
  <UiSheet :open="open" :title="t('friends.invite')" @close="emit('close')">
    <div class="invite">
      <p class="hint">{{ t('friends.inviteIntro') }}</p>
      <p v-if="failed" class="hint">{{ t(errorKey(failed)) }}</p>
      <p v-else-if="view === null" class="hint">{{ t('friends.loading') }}</p>
      <p v-else-if="friends.length === 0" class="hint">{{ t('friends.inviteNone') }}</p>
      <p v-else-if="candidates.length === 0" class="hint">{{ t('friends.inviteAllHere') }}</p>
      <ul v-else class="friends">
        <li v-for="friend in candidates" :key="friend.username" class="friend" :class="{ offline: !friend.online }">
          <span class="face">
            <PlayerAvatar :name="friend.username" :avatar="friend.avatar" :faded="!friend.online" />
            <span v-if="friend.online" class="dot" aria-hidden="true"></span>
          </span>
          <span class="name"
            >{{ friend.alias ?? friend.username
            }}<small v-if="friend.alias" class="username">{{ friend.username }}</small
            ><span class="sr-only">{{ t(friend.online ? 'friends.online' : 'friends.offline') }}</span></span
          >
          <UiButton size="small" :disabled="busy || invited(friend.username)" @click="invite(friend.username)">
            {{
              t(
                invited(friend.username)
                  ? 'friends.invited'
                  : friend.online
                    ? 'friends.inviteOne'
                    : 'friends.inviteLater',
              )
            }}
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

/* A friend online wears the friends list's green dot on the avatar's corner; one offline is faded. */
.face {
  position: relative;
  display: inline-flex;
  flex: none;
}

.dot {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 11px;
  height: 11px;
  border: var(--line-thin) solid var(--ink);
  border-radius: 50%;
  background: var(--online);
}

.offline .name {
  color: var(--ink-2);
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
