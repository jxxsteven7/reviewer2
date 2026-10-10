<script setup lang="ts">
import { contributionPieces, REPOSITORY_URL } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import FoldedList from './FoldedList.vue';

// The acknowledgments at the foot of the home page (docs/architecture.md#acknowledgments): the
// sections of ACKNOWLEDGMENTS.md, as the server reads it. The entries stay in English, as the file
// has them. A name links to the page its player gave, which is theirs and not the site's, and a
// number such as #12 to that issue or pull request in the repository. The file's rules are checked
// before it is merged and before the server shows it (shared/src/acknowledgments.ts).
const { t } = useI18n();
</script>

<template>
  <FoldedList name="acknowledgments">
    <template #none>{{ t('acknowledgments.none') }}</template>
    <template #default="{ entry }">
      <a
        v-if="entry.name !== null && entry.link?.startsWith('https://')"
        class="name"
        :href="entry.link"
        target="_blank"
        rel="nofollow ugc noopener"
        >{{ entry.name }}</a
      >
      <span v-else class="name">{{ entry.name ?? t('acknowledgments.anonymous') }}</span>
      <span class="dash"> &mdash; </span>
      <span class="what">
        <template v-for="(piece, at) in contributionPieces(entry.contribution)" :key="at">
          <a
            v-if="piece.issue"
            :href="`${REPOSITORY_URL}/issues/${piece.text}`"
            target="_blank"
            rel="noopener noreferrer"
            >#{{ piece.text }}</a
          >
          <template v-else>{{ piece.text }}</template>
        </template>
      </span>
    </template>
  </FoldedList>
</template>

<style scoped>
.name {
  color: var(--ink);
  font-weight: var(--weight-bold);
}

.dash,
.what {
  color: var(--ink-2);
}

.what a {
  color: inherit;
}
</style>
