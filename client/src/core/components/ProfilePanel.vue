<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { account } from '../account';
import { standingOf } from '../friends';
import { nameOf, usernameAfter } from '../names';
import { closeProfile, shownProfile } from '../profilePanel';
import { useFriendsList } from '../useFriendsList';
import FriendActions from './FriendActions.vue';
import ProfileCard from './ProfileCard.vue';
import UiButton from './UiButton.vue';
import UiSheet from './UiSheet.vue';

// The panel of an account outside a room (docs/architecture.md#public-profiles): what a tap on an
// avatar opens on the account page and the home page (AvatarButton.vue), and on an account among
// the feedback contributions (ContributionsList.vue), and the search on the account page for the
// account it finds (ProfileFriends.vue), the same as a room's player panel (PlayerPanel.vue)
// without what only a room has, so that nobody leaves the page to look. The site has one, which
// App.vue holds and which opens on whichever account was last asked for (profilePanel.ts). Its
// title, and the whole page's, is the username, or the name the viewer gives a friend (names.ts),
// with the username after it in small grey type. A brief card, and under it what the viewer may
// do by how the two stand (FriendActions.vue), once the viewer's own friends list has come or
// can't be had, or, for the viewer's own account, a word that it is theirs and the way to the
// account page, where they change it, as in a room; last, the whole page, as others see it, a
// second sheet of its own height over the panel, which it hides meanwhile (UiSheet.vue), that
// scrolls inside past the most a sheet may be and leads back to it. Once something has gone
// through, whoever opened the panel hears so, and the panel closes.
const { t } = useI18n();
const shown = shownProfile;
const open = computed(() => shown.value !== null);
const handle = computed(() => shown.value?.handle ?? '');
const username = computed(() => shown.value?.username ?? '');
const reading = ref(false);
const { view, failed } = useFriendsList(computed(() => open.value && account.summary !== null));
const standing = computed(() =>
  account.summary && (view.value !== null || failed.value !== null)
    ? standingOf(handle.value, account.summary.handle, view.value)
    : null,
);
const name = computed(() => nameOf({ name: username.value, handle: handle.value }));
const subtitle = computed(() => usernameAfter({ name: name.value, username: username.value }));
// The viewer's own account, known without the friends list.
const mine = computed(() => account.summary !== null && account.summary.handle === handle.value);

// A panel opened anew, or on someone else, starts with the brief card.
watch([open, handle], () => (reading.value = false));

// The account page, where the viewer's own account is changed. On that page itself, where the
// route stays the same, the panel closes all the same.
function toAccount(navigate: (event?: MouseEvent) => unknown, event: MouseEvent) {
  closeProfile();
  void navigate(event);
}

function done() {
  shown.value?.done?.();
  closeProfile();
}
</script>

<template>
  <UiSheet :open="open" :title="name" :subtitle="subtitle" @close="closeProfile">
    <div class="panel-body">
      <ProfileCard :handle="handle" brief :named="false" />
      <p v-if="mine" class="hint">{{ t('friends.self') }}</p>
      <div class="panel-actions">
        <FriendActions
          v-if="standing && standing.kind !== 'self'"
          :standing="standing"
          :name="username"
          :who="{ username }"
          @done="done"
        />
        <RouterLink v-if="mine" v-slot="{ href, navigate }" to="/account" custom>
          <UiButton :href="href" @click="toAccount(navigate, $event)">{{ t('room.panel.myAccount') }}</UiButton>
        </RouterLink>
        <UiButton @click="reading = true">{{ t('room.panel.fullPage') }}</UiButton>
      </div>
    </div>
  </UiSheet>

  <UiSheet
    :open="open && reading"
    :title="name"
    :subtitle="subtitle"
    :back="t('room.panel.back')"
    @back="reading = false"
    @close="closeProfile"
  >
    <ProfileCard :handle="handle" :named="false" />
  </UiSheet>
</template>

<style scoped>
/* The card, a word when it is the viewer, and the buttons, as close together as in a room's panel. */
.panel-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.panel-actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}
</style>
