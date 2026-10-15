<script setup lang="ts">
import type { RoomView } from '@reviewer2/shared';
import { computed, toRef } from 'vue';
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
// offline after them, the whole line faded, each with a button, which for a friend offline says
// that they will see the invitation once they come online, and "Invited" once they are, as long as
// the invitation stands. The room's view alone says whom the viewer has invited (RoomView.invited):
// the server sends it anew before it answers an invitation, and again as one ends, so the sheet
// says "Invited" when it opens again, and offers the button again once the friend has ignored the
// invitation or it has lapsed. The list is asked for whenever the sheet opens, since who is online
// changes all the time. A friend goes by the name the account gives them, if any, with the username
// after it.
const props = defineProps<{ open: boolean; room: RoomView }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const { view, failed, load } = useFriendsList(toRef(props, 'open'));
const invited = (username: string) => (props.room.invited ?? []).some((friend) => friend.username === username);
const { busy, run } = useBusy();

// The room keeps the username of a member with an account beside whatever it calls them (room.ts),
// so a friend whose username is in the room is here already; the server refuses the others that
// are, should the names not tell.
const here = computed(() => new Set(props.room.players.map(({ name, username }) => username ?? name)));
const friends = computed(() => view.value?.friends ?? []);
const candidates = computed(() => {
  const away = friends.value.filter((friend) => !here.value.has(friend.username));
  return [...away.filter((friend) => friend.online), ...away.filter((friend) => !friend.online)];
});

async function invite(username: string) {
  const reply = await run(() => send('friends:invite', { username }));
  if (reply && !reply.ok) toastError(reply.error);
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

/* A friend online wears the friends list's green dot on the avatar's corner; one offline has the
   whole line faded, the button too, as far as its words still read well. */
.friend.offline {
  opacity: 0.8;
}

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
