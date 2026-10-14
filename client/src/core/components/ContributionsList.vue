<script setup lang="ts">
import { type Contribution, CONTRIBUTIONS_API, FEEDBACK_KINDS, PROFILE_PATH, REPOSITORY_URL } from '@reviewer2/shared';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { useLanguage } from '../i18n';
import { countPeople } from '../thanks';
import FoldedList from './FoldedList.vue';
import FoldedSection from './FoldedSection.vue';
import ProfileCard from './ProfileCard.vue';
import UiButton from './UiButton.vue';
import UiSheet from './UiSheet.vue';

// The feedback contributions on the home page (docs/architecture.md#feedback-contributions): the
// feedback that the operator adopted, which the server reads from its database, newest first, in a
// section for each kind of feedback that has any. Each is the name its player left, or "an
// anonymous player"; what they contributed, as the operator wrote it in the page's language; the
// GitHub issue it became, where the discussion and the changes are; and the month it was adopted.
// A name opens its player's profile only when the server sends the profile's handle, which it
// does for a player who let it when sending the feedback: a tap opens a sheet over the home page,
// from the bottom on a phone and in the middle on a wider screen, with the brief profile card, as
// a player's avatar does in a room, and the way to the whole page. Names and what they did are
// plain text.
const { t } = useI18n();
const language = useLanguage();
// The player whose card is open: the name they left, the sheet's title, and their profile.
const shown = ref<{ name: string; handle: string } | null>(null);

type Contributions = { contributions: Contribution[] };
const people = ({ contributions }: Contributions) => countPeople(contributions.map(({ name }) => name));
const empty = ({ contributions }: Contributions) => contributions.length === 0;
const sections = ({ contributions }: Contributions) =>
  FEEDBACK_KINDS.map((kind) => ({ kind, entries: contributions.filter((entry) => entry.kind === kind) })).filter(
    ({ entries }) => entries.length > 0,
  );
</script>

<template>
  <FoldedList name="contributions" :api="CONTRIBUTIONS_API" :people="people" :empty="empty" intro>
    <template #none>{{ t('contributions.none') }}</template>
    <template #default="{ data }">
      <FoldedSection
        v-for="section in sections(data)"
        :key="section.kind"
        v-slot="{ entry }"
        :heading="t(`contributions.kinds.${section.kind}`)"
        :entries="section.entries"
      >
        <button
          v-if="entry.name !== null && entry.profile"
          type="button"
          class="name person"
          @click="shown = { name: entry.name, handle: entry.profile }"
        >
          {{ entry.name }}
        </button>
        <span v-else class="name">{{ entry.name ?? t('contributions.anonymous') }}</span>
        <template v-if="entry.summary">
          <span class="dash"> &mdash; </span>
          <span class="what">{{ entry.summary[language] }}</span>
        </template>
        <span class="meta"
          >&nbsp;<template v-if="entry.issue !== null"
            ><a :href="`${REPOSITORY_URL}/issues/${entry.issue}`" target="_blank" rel="noopener noreferrer"
              >#{{ entry.issue }}</a
            >
            &middot; </template
          >{{ entry.month }}</span
        >
      </FoldedSection>
    </template>
  </FoldedList>

  <UiSheet :open="shown !== null" :title="shown?.name ?? ''" @close="shown = null">
    <div v-if="shown" class="card">
      <ProfileCard :handle="shown.handle" brief />
      <RouterLink v-slot="{ href, navigate }" :to="`${PROFILE_PATH}${shown.handle}`" custom>
        <UiButton :href="href" @click="navigate">{{ t('contributions.fullPage') }}</UiButton>
      </RouterLink>
    </div>
  </UiSheet>
</template>

<style scoped>
.name {
  color: var(--ink);
  font-weight: var(--weight-bold);
}

/* A name that opens a card looks like a link, as it is one to the player. */
.person {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-weight: var(--weight-bold);
  text-decoration: underline;
  text-decoration-thickness: 2px;
  text-underline-offset: 0.2em;
  cursor: pointer;
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.dash,
.what {
  color: var(--ink-2);
}

/* The issue and the month, smaller and quieter, kept together after what they did. */
.meta {
  color: var(--ink-2);
  font-size: var(--text-xs);
  white-space: nowrap;
}

.meta a {
  color: inherit;
}
</style>
