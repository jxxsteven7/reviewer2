<script setup lang="ts" generic="Name extends ListName">
import { type Acknowledgment, LIST_API, type ListName, type ListSection, type Sponsor } from '@reviewer2/shared';
import { ref, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { request } from '../account';
import UiButton from './UiButton.vue';

// A list of thanks at the foot of the home page (docs/architecture.md#lists-of-thanks), folded
// until it is opened, which is when the page asks the server for it, once. The server reads the
// list from ACKNOWLEDGMENTS.md or SPONSORS.md, so it can change without a new build, and sends its
// sections. Each section has its heading in the page's language; the component that uses this one
// shows the entries, as plain text, and what to say while nobody is listed.
type Entries = { acknowledgments: Acknowledgment; sponsors: Sponsor };

const props = defineProps<{ name: Name }>();
defineSlots<{ default(props: { entry: Entries[Name] }): unknown; none(): unknown }>();
const { t } = useI18n();

// The sections once the server has sent them, and whether it is being asked or failed to answer.
const sections = shallowRef<ListSection<string, Entries[Name]>[] | null>(null);
const failed = ref(false);
let asking = false;

async function load(): Promise<void> {
  if (sections.value !== null || asking) return;
  asking = true;
  failed.value = false;
  const reply = await request<{ sections: ListSection<string, Entries[Name]>[] }>(LIST_API[props.name]);
  asking = false;
  if (reply.ok) sections.value = reply.sections;
  else failed.value = true;
}

const toggled = (event: Event) => {
  if ((event.target as HTMLDetailsElement).open) void load();
};
</script>

<template>
  <details :class="['fold', name]" @toggle="toggled">
    <summary>{{ t(`${name}.title`) }}</summary>
    <div class="panel list">
      <p class="intro">{{ t(`${name}.intro`) }}</p>
      <p v-if="failed" class="note failed">
        {{ t('thanks.failed') }}
        <UiButton variant="quiet" size="small" @click="load">{{ t('thanks.retry') }}</UiButton>
      </p>
      <p v-else-if="sections === null" class="note">{{ t('thanks.loading') }}</p>
      <p v-else-if="sections.length === 0" class="note"><slot name="none" /></p>
      <template v-else>
        <section v-for="section in sections" :key="section.kind" class="group">
          <h3>{{ t(`${name}.kinds.${section.kind}`) }}</h3>
          <ul>
            <li v-for="(entry, index) in section.entries" :key="index">
              <slot :entry="entry" />
            </li>
          </ul>
        </section>
      </template>
    </div>
  </details>
</template>

<style scoped>
/* The fold is a quiet button, like "Send feedback" beside it, with its own marker. Open, the
   list takes a row of its own below the footnotes. */
.fold[open] {
  flex-basis: 100%;
}

summary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-control);
  font-weight: var(--weight-bold);
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

.fold[open] summary::before {
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

.failed {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
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
</style>
