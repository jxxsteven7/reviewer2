<script setup lang="ts">
import { type Contribution, CONTRIBUTIONS_API, FEEDBACK_KINDS, PROFILE_PATH, REPOSITORY_URL } from '@reviewer2/shared';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { useLanguage } from '../i18n';
import { countPeople } from '../thanks';
import FoldedList from './FoldedList.vue';
import FoldedSection from './FoldedSection.vue';
import PlayerAvatar from './PlayerAvatar.vue';
import ProfileCard from './ProfileCard.vue';
import UiButton from './UiButton.vue';
import UiSheet from './UiSheet.vue';

// The feedback contributions on the home page (docs/architecture.md#feedback-contributions): the
// feedback that the operator adopted, which the server reads from its database, newest first, in a
// section for each kind of feedback that has any. Each is the name its player left, or "an
// anonymous player"; what they contributed, as the operator wrote it in the page's language; the
// GitHub issue it became, where the discussion and the changes are; and the month it was adopted.
// Feedback signed with an account comes with the handle of its profile, and shows the account's
// avatar before its username: a tap on either opens a sheet over the home page, from the bottom on
// a phone and in the middle on a wider screen, with the brief profile card, as a player's avatar
// does in a room, and the way to the whole page. Any other name, and what they did, is plain
// text.
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
          <PlayerAvatar :name="entry.name" :avatar="entry.avatar" />
          <span>{{ entry.name }}</span>
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

/* An account that opens a card: its avatar and its username, as a player shows in a room, with
   no underline; the avatar says that it is a player to tap. */
.person {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 100%;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-weight: var(--weight-bold);
  text-align: start;
  vertical-align: middle;
  cursor: pointer;
}

.person:focus-visible {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
  border-radius: var(--radius-small);
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
