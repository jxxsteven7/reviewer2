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
