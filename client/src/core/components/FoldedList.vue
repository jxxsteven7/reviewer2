<script setup lang="ts" generic="Name extends ListName">
import { type Acknowledgment, LIST_API, type ListName, type ListSection, type Sponsor } from '@reviewer2/shared';
import { computed, onMounted, ref, shallowRef, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { request } from '../account';
import UiButton from './UiButton.vue';

// A list of thanks on the home page (docs/architecture.md#lists-of-thanks): a card whose title
// says how many people the list names, folded until its title is pressed. The page asks the server
// for the list once, when the card is shown, so that the title can count them, and again when the
// card is opened after a failure. The server reads the list from ACKNOWLEDGMENTS.md or SPONSORS.md,
// so it can change without a new build, and sends its sections. Each section has its heading in
// the page's language; the component that uses this one shows the entries, as plain text, and what
// to say while nobody is listed.
type Entries = { acknowledgments: Acknowledgment; sponsors: Sponsor };

const props = defineProps<{ name: Name }>();
defineSlots<{ default(props: { entry: Entries[Name] }): unknown; none(): unknown }>();
const { t } = useI18n();
const panel = useId();
const open = ref(false);

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

onMounted(load);

function toggle() {
  open.value = !open.value;
  if (open.value) void load();
}

// How many people the list names: someone listed in two sections counts once, and every anonymous
// player counts on their own. Until the list arrives, the title is the list's name alone.
const people = computed(() => {
  if (sections.value === null) return null;
  const entries = sections.value.flatMap((section) => section.entries);
  const names = new Set(entries.flatMap(({ name }) => (name === null ? [] : [name])));
  return names.size + entries.filter(({ name }) => name === null).length;
});
const title = computed(() =>
  people.value === null ? t(`${props.name}.title`) : t(`${props.name}.counted`, { count: people.value }, people.value),
);
</script>

<template>
  <section :class="['fold', name]">
    <h2>
      <button type="button" class="toggle" :aria-expanded="open" :aria-controls="panel" @click="toggle">
        {{ title }}
      </button>
    </h2>
    <div v-show="open" :id="panel" class="list">
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
  </section>
</template>

<style scoped>
/* A sticker with a thin outline, quieter than the ways into a room above it. The whole title row
   is the button, with its marker in front. */
.fold {
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-1);
}

h2 {
  font-family: var(--font-sans);
  font-size: var(--text-md);
  font-weight: var(--weight-black);
}

.toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 52px;
  padding: 0 var(--space-4);
  border: 0;
  border-radius: calc(var(--radius-panel) - var(--line));
  background: none;
  color: var(--ink);
  font: inherit;
  text-align: start;
  cursor: pointer;
  touch-action: manipulation;
}

.toggle::before {
  content: '\25B8';
  font-size: var(--text-xs);
}

.toggle[aria-expanded='true']::before {
  content: '\25BE';
}

@media (hover: hover) {
  .toggle:hover {
    background: var(--paper-2);
  }
}

.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-1) var(--space-4) var(--space-4);
  font-size: var(--text-sm);
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
