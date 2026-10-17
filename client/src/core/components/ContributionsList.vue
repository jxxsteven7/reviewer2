<script setup lang="ts">
import {
  CONTRIBUTION_KINDS,
  type Contribution,
  CONTRIBUTIONS_API,
  GITHUB_URL,
  REPOSITORY_URL,
} from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import { useLanguage } from '../i18n';
import { nameOf } from '../names';
import { openProfile } from '../profilePanel';
import { countPeople } from '../thanks';
import FoldedList from './FoldedList.vue';
import FoldedSection from './FoldedSection.vue';
import GithubAvatar from './GithubAvatar.vue';
import LinkArrow from './LinkArrow.vue';
import PlayerAvatar from './PlayerAvatar.vue';

// The contributions on the home page (docs/architecture.md#feedback-contributions): the feedback
// that players sent through the site and the operator adopted, and the issues that developers
// opened on GitHub and the operator adopted, which the server reads from its database as one list,
// newest first, in a section for each kind that has any, the kinds of feedback and then the code,
// which only GitHub is about. Each says who it is from: the account that signed it, "a deleted
// player" once that account is gone, the name a guest left, the GitHub username of an issue's
// author, or "an anonymous player"; then what they contributed, as the operator wrote it in the
// page's language; the GitHub issue it is or became, where the discussion and the changes are, or
// the security advisory published once a problem reported privately was fixed; and the month it
// was adopted. Feedback signed with an account comes with the handle of its profile, and shows the
// account's avatar before its username, or the name that the viewer gives a friend (names.ts): a
// tap on either opens the account's panel over the home page, as an avatar does anywhere else
// (ProfilePanel.vue). An issue's author shows GitHub's mark before their username, in the link
// blue with an arrow after it, since both lead off the site, to their GitHub page. Any other name,
// and what they did, is plain text. What follows the name is one piece, which wraps under itself
// rather than under the name, and goes to a line of its own after a long name; an avatar hangs in
// a column of its own before the name. The card's intro also says where those who wrote the code
// are listed: on GitHub, among the repository's contributors.
const { t } = useI18n();
const language = useLanguage();

type Contributions = { contributions: Contribution[] };
// The people named, counted for each place they came from on its own, since a username on the site
// and the same username on GitHub may be two people.
const people = ({ contributions }: Contributions) =>
  countPeople(contributions.filter(({ source }) => source === 'site').map(({ name }) => name)) +
  countPeople(contributions.filter(({ source }) => source === 'github').map(({ name }) => name));
const empty = ({ contributions }: Contributions) => contributions.length === 0;
const sections = ({ contributions }: Contributions) =>
  CONTRIBUTION_KINDS.map((kind) => ({ kind, entries: contributions.filter((entry) => entry.kind === kind) })).filter(
    ({ entries }) => entries.length > 0,
  );
// Whether an entry has an avatar, an account's or GitHub's, which hangs before the name.
const hangs = ({ name, profile, source }: Contribution) => name !== null && (profile !== null || source === 'github');
const CONTRIBUTORS_URL = `${REPOSITORY_URL}/graphs/contributors`;
</script>

<template>
  <FoldedList name="contributions" :api="CONTRIBUTIONS_API" :people="people" :empty="empty" intro>
    <template #intro>
      <i18n-t keypath="contributions.intro" scope="global">
        <template #github>
          <a class="text-link coders" :href="CONTRIBUTORS_URL" target="_blank" rel="noopener noreferrer"
            >{{ t('contributions.github') }}<LinkArrow
          /></a>
        </template>
      </i18n-t>
    </template>
    <template #none>{{ t('contributions.none') }}</template>
    <template #default="{ data }">
      <FoldedSection
        v-for="section in sections(data)"
        :key="section.kind"
        v-slot="{ entry }"
        :heading="t(`contributions.kinds.${section.kind}`)"
        :entries="section.entries"
      >
        <span class="entry" :class="{ hangs: hangs(entry) }">
          <button
            v-if="entry.name !== null && entry.profile"
            type="button"
            class="name person press-host"
            aria-haspopup="dialog"
            @click="openProfile(entry.profile, entry.name)"
          >
            <PlayerAvatar class="press-part" :name="entry.name" :avatar="entry.avatar" />
            <span>{{ nameOf({ name: entry.name, handle: entry.profile }) }}</span>
          </button>
          <a
            v-else-if="entry.name !== null && entry.source === 'github'"
            class="name person github press-host"
            :href="`${GITHUB_URL}/${entry.name}`"
            target="_blank"
            rel="nofollow ugc noopener"
          >
            <GithubAvatar class="press-part" />
            <span class="text">{{ entry.name }}</span
            ><LinkArrow />
          </a>
          <span v-else class="name">{{
            entry.deleted ? t('contributions.deleted') : (entry.name ?? t('contributions.anonymous'))
          }}</span>
          <!-- The space before the dash reads in the text, and takes no room in the line (.rest). -->
          <span class="rest"
            >{{ ' ' }}<span v-if="entry.summary" class="dash">&mdash; </span>
            <span class="said">
              <span v-if="entry.summary" class="what">{{ entry.summary[language] }}</span>
              <span class="meta"
                >&nbsp;<a
                  v-if="entry.advisory !== null"
                  :href="`${REPOSITORY_URL}/security/advisories/${entry.advisory}`"
                  target="_blank"
                  rel="noopener noreferrer"
                  >{{ t('contributions.advisory') }}</a
                ><a v-else :href="`${REPOSITORY_URL}/issues/${entry.issue}`" target="_blank" rel="noopener noreferrer"
                  >#{{ entry.issue }}</a
                >
                &middot; {{ entry.month }}</span
              >
            </span>
          </span>
        </span>
      </FoldedSection>
    </template>
  </FoldedList>
</template>

<style scoped>
/* Who, then the rest as one piece: the dash, and what they contributed, which wraps under itself
   rather than under the name; the gap before the dash is the name's margin, so that the rest
   starts at the edge of a line of its own. After a name too long to leave the rest three fifths of
   the line, the rest goes to a line of its own, under the name. An avatar hangs in a column of its
   own before the name; an entry without one starts at the edge. */
.entry {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
}

.entry.hangs {
  padding-inline-start: calc(26px + var(--space-2));
}

.name {
  flex: none;
  max-width: 100%;
  margin-inline-end: 0.3em;
  color: var(--ink);
  font-weight: var(--weight-bold);
}

.rest {
  display: flex;
  flex: 1 1 60%;
  align-items: baseline;
  min-width: 0;
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

/* An issue's author on GitHub: GitHub's mark hangs where an account's avatar does, and the username
   is a link that leads off the site, in the deep blue that reads on the beige row (docs/design.md),
   with the arrow after it (LinkArrow.vue): under a pointer an underline sweeps in under the
   username alone and the arrow moves out; pressed, the underline is there at once and the arrow
   further out, and both ease back after. A username too long for the line wraps at its hyphens,
   with the underline under every line, and the arrow stays at the end of the last one: the word
   joiner that closes the username lets no line break before the arrow. */
.github {
  display: inline-block;
  color: var(--blue-deep);
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition: color var(--motion);
}

.github .text {
  background: linear-gradient(currentcolor, currentcolor) 0 100% / 0 2px no-repeat;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
  transition: background-size 220ms var(--ease-out);
}

.github .text::after {
  content: '\2060';
}

.github .arrow {
  margin-inline-start: 3px;
}

@media (hover: hover) {
  .github:hover {
    color: var(--blue-deeper);
  }

  .github:hover .text {
    background-size: 100% 2px;
  }

  .github:hover .arrow {
    transform: translate(2px, -2px);
  }
}

.github:focus-visible .text {
  background-size: 100% 2px;
}

.github:active {
  color: var(--blue-deeper);
  transition-duration: 0s;
}

.github:active .text {
  background-size: 100% 2px;
  transition-duration: 0s;
}

.github:active .arrow {
  transform: translate(4px, -4px);
  transition-duration: 0s;
}

/* The way to GitHub's contributors, in the intro, with its arrow a little apart. */
.coders {
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
}

.coders .arrow {
  top: 0;
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
