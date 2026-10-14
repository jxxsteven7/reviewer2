<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterView } from 'vue-router';
import { loadAccount } from './core/account';
import InvitationNotices from './core/components/InvitationNotices.vue';
import JoinAskNotices from './core/components/JoinAskNotices.vue';
import UiToasts from './core/components/UiToasts.vue';

// Who the browser is, for every page: the home page's masthead, and the forms that ask a guest for
// a name. The invitations to rooms show on every page, under the short messages, and friends'
// requests to be let into a room on the room's page.
onMounted(loadAccount);
</script>

<template>
  <RouterView />
  <UiToasts><InvitationNotices /><JoinAskNotices /></UiToasts>
</template>
