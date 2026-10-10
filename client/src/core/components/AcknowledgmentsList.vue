<script setup lang="ts">
import { ACCOUNT_API, ACKNOWLEDGMENT_KINDS, type Acknowledgment } from '@reviewer2/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { request } from '../account';
import { errorKey } from '../errors';

// The acknowledgments at the foot of the home page (docs/architecture.md#acknowledgments): the
// players whose suggestions were adopted, who added words or who tested, by the names they gave,
// in groups by what they did and with the day. The list is folded until it is opened, and fetched
// then; one that couldn't be fetched is fetched again the next time it is opened.
const { t, locale } = useI18n();
const entries = ref<Acknowledgment[] | null>(null);
const failed = ref<string | undefined>();
let loading = false;

async function load(): Promise<void> {
  if (entries.value || loading) return;
  loading = true;
  failed.value = undefined;
  const reply = await request<{ acknowledgments: Acknowledgment[] }>(ACCOUNT_API.acknowledgments);
  loading = false;
  if (reply.ok) entries.value = reply.acknowledgments;
  else failed.value = t(errorKey(reply.error));
}

function toggled(event: Event) {
  if ((event.target as HTMLDetailsElement).open) void load();
}

const groups = computed(() =>
  ACKNOWLEDGMENT_KINDS.map((kind) => ({
    kind,
    entries: (entries.value ?? []).filter((entry) => entry.kind === kind),
  })).filter((group) => group.entries.length > 0),
);

// A day, as the page's language writes it. It is a day and not a moment, so it is read in UTC,
// where the server wrote it, rather than shift by the browser's time zone.
function day(date: string): string {
  try {
    return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(date));
  } catch {
    return date;
  }
}
</script>

<template>
  <details class="acknowledgments" @toggle="toggled">
    <summary>{{ t('acknowledgments.title') }}</summary>
    <div class="panel list">
      <p class="intro">{{ t('acknowledgments.intro') }}</p>
      <p v-if="failed" class="problem" role="alert">{{ failed }}</p>
      <p v-else-if="!entries" class="note">{{ t('acknowledgments.loading') }}</p>
      <p v-else-if="entries.length === 0" class="note">{{ t('acknowledgments.none') }}</p>
      <section v-for="group in groups" :key="group.kind" class="group">
        <h3>{{ t(`acknowledgments.kinds.${group.kind}`) }}</h3>
        <ul>
          <li v-for="(entry, index) in group.entries" :key="index">
            <span class="name">{{ entry.name }}</span>
            <span class="day num">{{ day(entry.date) }}</span>
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

.problem {
  color: var(--red-deep);
  font-weight: var(--weight-bold);
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
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-card);
  background: var(--paper-2);
}

.name {
  font-weight: var(--weight-bold);
  overflow-wrap: anywhere;
}

.day {
  flex: none;
  color: var(--ink-2);
}
</style>
