<script setup lang="ts">
import { onMounted, watch } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import { loadAccount } from './core/account';
import InvitationNotices from './core/components/InvitationNotices.vue';
import JoinAskNotices from './core/components/JoinAskNotices.vue';
import ProfilePanel from './core/components/ProfilePanel.vue';
import UiToasts from './core/components/UiToasts.vue';
import { closeProfile } from './core/profilePanel';

// Who the browser is, for every page: the home page's masthead, and the forms that ask a guest for
// a name. The invitations to rooms show on every page, under the short messages, and friends'
// requests to be let into a room on the room's page. The panel of an account outside a room is one
// for the whole site (profilePanel.ts), over whichever page opened it, and closes when the page
// changes under it.
onMounted(loadAccount);
const route = useRoute();
watch(() => route.path, closeProfile);
</script>

<template>
  <RouterView />
  <ProfilePanel />
  <UiToasts><InvitationNotices /><JoinAskNotices /></UiToasts>
</template>

<style>
/* As a page comes, what is under its masthead fades in, rising a little, while the masthead, in
   the same place on every page, stands still, and nothing waits for the page before to go. The
   move is the content's own, from the moment it is on the page, so that the bars that stay at the
   top and the place the page is scrolled to are as they would be without it. The animation fills
   backwards alone: over, it leaves the content as it would be without it, which a transform that
   stayed would not, as the containing block of whatever is fixed in it. */
.page > main,
.screen-page > main {
  animation: page-in var(--motion-quick) var(--ease-out) backwards;
}

@keyframes page-in {
  from {
    transform: translateY(6px);
    opacity: 0;
  }
}
</style>
