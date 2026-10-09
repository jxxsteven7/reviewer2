<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterView } from 'vue-router';
import { loadAccount } from './core/account';
import UiToasts from './core/components/UiToasts.vue';

// Who the browser is, for every page: the home page's masthead, and the forms that ask a guest for
// a name.
onMounted(loadAccount);
</script>

<template>
  <RouterView />
  <UiToasts />
</template>
