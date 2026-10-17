<script setup lang="ts">
import { LIST_API, type ListSection, type Sponsor, type SponsorKind, SPONSORS_PAGE } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import { countPeople } from '../thanks';
import FoldedList from './FoldedList.vue';
import FoldedSection from './FoldedSection.vue';

// The sponsors on the home page (docs/architecture.md#sponsors): the sections of SPONSORS.md,
// as the server reads it, with names, never an amount. A sponsor on GitHub links to their profile
// there, and a sponsor of another way to the page they gave, if any. Under the name comes the line
// of thanks that the maintainers may have written to them, as it is written, in whatever language
// the page is in. While nobody is listed, the list asks for the first, on GitHub Sponsors or with
// the WeChat tip that the home page offers, which `tip` opens.
const { t } = useI18n();
const emit = defineEmits<{ tip: [] }>();

type Sponsors = { sections: ListSection<SponsorKind, Sponsor>[] };
const people = ({ sections }: Sponsors) =>
  countPeople(sections.flatMap(({ entries }) => entries.map(({ name }) => name)));
const empty = ({ sections }: Sponsors) => sections.length === 0;
</script>

<template>
  <FoldedList name="sponsors" :api="LIST_API.sponsors" :people="people" :empty="empty" intro>
    <template #none>
      <i18n-t keypath="sponsors.none" scope="global">
        <template #github>
          <a :href="SPONSORS_PAGE" class="text-link" target="_blank" rel="noopener noreferrer">{{
            t('sponsors.github')
          }}</a>
        </template>
        <template #wechat>
          <button type="button" class="tip text-link" @click="emit('tip')">{{ t('sponsors.wechat') }}</button>
        </template>
      </i18n-t>
    </template>
    <template #default="{ data }">
      <FoldedSection
        v-for="section in data.sections"
        :key="section.kind"
        v-slot="{ entry }"
        :heading="t(`sponsors.kinds.${section.kind}`)"
        :entries="section.entries"
      >
        <a
          v-if="entry.link?.startsWith('https://')"
          class="name text-link on-tint"
          :href="entry.link"
          target="_blank"
          rel="nofollow ugc noopener"
          >{{ entry.name }}</a
        >
        <span v-else class="name">{{ entry.name }}</span>
        <span v-if="entry.thanks" class="thanks">{{ entry.thanks }}</span>
      </FoldedSection>
    </template>
  </FoldedList>
</template>

<style scoped>
/* A sponsor's name, a text link where they left one, in the deep blue that reads on the beige row
   (`on-tint` in base.css), in bold either way. */
.name {
  font-weight: var(--weight-bold);
}

/* A line of thanks takes a line of its own, smaller and quieter than the name. */
.thanks {
  display: block;
  color: var(--ink-2);
  font-size: var(--text-sm);
}

/* The way to the WeChat tip reads as a text link in the sentence, like the one to GitHub Sponsors
   (styles/base.css). */
.tip {
  padding: 0;
  border: 0;
  font: inherit;
  font-weight: var(--weight-bold);
  cursor: pointer;
}
</style>
