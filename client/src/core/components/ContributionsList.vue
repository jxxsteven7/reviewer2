<script setup lang="ts">
import { type Contribution, CONTRIBUTIONS_API, FEEDBACK_KINDS, REPOSITORY_URL } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import { useLanguage } from '../i18n';
import { openProfile } from '../profilePanel';
import { countPeople } from '../thanks';
import FoldedList from './FoldedList.vue';
import FoldedSection from './FoldedSection.vue';
import PlayerAvatar from './PlayerAvatar.vue';

// The feedback contributions on the home page (docs/architecture.md#feedback-contributions): the
// feedback that the operator adopted, which the server reads from its database, newest first, in a
// section for each kind of feedback that has any. Each says who it is from: the account that
// signed it, "a deleted player" once that account is gone, the name a guest left, or "an
// anonymous player"; then what they contributed, as the operator wrote it in the page's language;
// the GitHub issue it became, where the discussion and the changes are; and the month it was
// adopted. Feedback signed with an account comes with the handle of its profile, and shows the
// account's avatar before its username: a tap on either opens the account's panel over the home
// page, as an avatar does anywhere else (ProfilePanel.vue). Any other name, and what they did, is
// plain text. What follows the name is one piece, which wraps under itself rather than under the
// name, and an avatar hangs in a column of its own before the name.
const { t } = useI18n();
const language = useLanguage();

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
        <span class="entry" :class="{ hangs: entry.name !== null && entry.profile }">
          <button
            v-if="entry.name !== null && entry.profile"
            type="button"
            class="name person press-host"
            aria-haspopup="dialog"
            @click="openProfile(entry.profile, entry.name)"
          >
            <PlayerAvatar class="press-part" :name="entry.name" :avatar="entry.avatar" />
            <span>{{ entry.name }}</span>
          </button>
          <span v-else class="name">{{
            entry.deleted ? t('contributions.deleted') : (entry.name ?? t('contributions.anonymous'))
          }}</span>
          <span v-if="entry.summary" class="dash"> &mdash; </span>
          <span class="said">
            <span v-if="entry.summary" class="what">{{ entry.summary[language] }}</span>
            <span class="meta"
              >&nbsp;<a :href="`${REPOSITORY_URL}/issues/${entry.issue}`" target="_blank" rel="noopener noreferrer"
                >#{{ entry.issue }}</a
              >
              &middot; {{ entry.month }}</span
            >
          </span>
        </span>
      </FoldedSection>
    </template>
  </FoldedList>
</template>

<style scoped>
/* Who, then what they contributed as one piece, which wraps under itself rather than under the
   name. An avatar hangs in a column of its own before the name, so that the name lines up with the
   names of the entries without one. */
.entry {
  display: flex;
  align-items: baseline;
}

.entry.hangs {
  padding-inline-start: calc(26px + var(--space-2));
}

.name {
  flex: none;
  max-width: 45%;
  color: var(--ink);
  font-weight: var(--weight-bold);
}

.dash {
  flex: none;
  white-space: pre;
}

.said {
  flex: 1 1 0;
  min-width: 0;
}

/* An account that opens its panel: its avatar and its username, as a player shows in a room, with
   no underline; the avatar, which wears the hard shadow of what a tap opens and moves as a sticker
   does (`press-part` in base.css), hangs before the username, in the column the entry keeps for
   it, centred on the username's line. */
.person {
  position: relative;
  display: inline-block;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-weight: var(--weight-bold);
  text-align: start;
  cursor: pointer;
}

.person :deep(.avatar) {
  position: absolute;
  inset-inline-end: calc(100% + var(--space-2));
  top: 50%;
  margin-top: -13px;
  box-shadow: var(--shadow-1);
}

.person:focus-visible {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
  border-radius: var(--radius-small);
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
