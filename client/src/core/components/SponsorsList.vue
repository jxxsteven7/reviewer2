<script setup lang="ts">
import { SPONSORS_PAGE } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import FoldedList from './FoldedList.vue';

// The sponsors at the foot of the home page (docs/architecture.md#sponsors): the sections of
// SPONSORS.md, as the server reads it, with names alone, never an amount. A sponsor on GitHub links
// to their profile there, and a sponsor of another way to the page they gave, if any. While nobody
// is listed, the list asks for the first, on GitHub Sponsors or with the WeChat tip that the home
// page offers, which `tip` opens.
const { t } = useI18n();
const emit = defineEmits<{ tip: [] }>();
</script>

<template>
  <FoldedList name="sponsors">
    <template #none>
      <i18n-t keypath="sponsors.none" scope="global">
        <template #github>
          <a :href="SPONSORS_PAGE" target="_blank" rel="noopener noreferrer">{{ t('sponsors.github') }}</a>
        </template>
        <template #wechat>
          <button type="button" class="tip" @click="emit('tip')">{{ t('sponsors.wechat') }}</button>
        </template>
      </i18n-t>
    </template>
    <template #default="{ entry }">
      <a
        v-if="entry.link?.startsWith('https://')"
        class="name"
        :href="entry.link"
        target="_blank"
        rel="nofollow ugc noopener"
        >{{ entry.name }}</a
      >
      <span v-else class="name">{{ entry.name }}</span>
    </template>
  </FoldedList>
</template>

<style scoped>
.name {
  color: var(--ink);
  font-weight: var(--weight-bold);
}

/* The way to the WeChat tip reads as a link in the sentence, like the one to GitHub Sponsors
   (styles/base.css). */
.tip {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-weight: var(--weight-bold);
  text-decoration: underline;
  text-decoration-thickness: 2px;
  text-underline-offset: 0.2em;
  cursor: pointer;
}
</style>
