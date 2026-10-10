<script setup lang="ts">
import { parseAcknowledgments, REPOSITORY_URL } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import source from '../../../../ACKNOWLEDGMENTS.md?raw';

// The acknowledgments at the foot of the home page (docs/architecture.md#acknowledgments), folded
// until they are opened: ACKNOWLEDGMENTS.md, which the build bundles, in its sections, under
// headings in the page's language. The entries stay in English, as the file has them. A name
// links to the page its player gave, which is theirs and not the site's, and a number such as
// #12 to that issue or pull request in the repository. The file's rules are checked before it is
// merged (shared/src/acknowledgments.ts); an entry that broke them would be left out.
const { t } = useI18n();
const { sections } = parseAcknowledgments(source);

// What someone did, in pieces of text and numbers of issues.
const pieces = (contribution: string) =>
  contribution.split(/#(\d+)/).map((text, index) => ({ text, issue: index % 2 === 1 }));
</script>

<template>
  <details class="acknowledgments">
    <summary>{{ t('acknowledgments.title') }}</summary>
    <div class="panel list">
      <p class="intro">{{ t('acknowledgments.intro') }}</p>
      <p v-if="sections.length === 0" class="note">{{ t('acknowledgments.none') }}</p>
      <section v-for="section in sections" :key="section.kind" class="group">
        <h3>{{ t(`acknowledgments.kinds.${section.kind}`) }}</h3>
        <ul>
          <li v-for="(entry, index) in section.entries" :key="index">
            <a
              v-if="entry.name !== null && entry.link !== null"
              class="name"
              :href="entry.link"
              target="_blank"
              rel="nofollow ugc noopener"
              >{{ entry.name }}</a
            >
            <span v-else class="name">{{ entry.name ?? t('acknowledgments.anonymous') }}</span>
            <span class="dash"> &mdash; </span>
            <span class="what">
              <template v-for="(piece, at) in pieces(entry.contribution)" :key="at">
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
          </li>
        </ul>
      </section>
    </div>
  </details>
</template>

<style scoped>
/* The fold is a quiet button, like "Send feedback" beside it, with its own marker. Open, the
   list takes a row of its own below the footnotes. */
.acknowledgments[open] {
  flex-basis: 100%;
}

summary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-control);
  font-weight: var(--weight-black);
  list-style: none;
  cursor: pointer;
}

summary::-webkit-details-marker {
  display: none;
}

summary::before {
  content: '\25B8';
  font-size: var(--text-xs);
}

.acknowledgments[open] summary::before {
  content: '\25BE';
}

.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 34rem;
  margin: var(--space-2) 0 var(--space-3);
}

.intro,
.note {
  color: var(--ink-2);
}

.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

h3 {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
}

ul {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

li {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-card);
  background: var(--paper-2);
  overflow-wrap: anywhere;
}

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
