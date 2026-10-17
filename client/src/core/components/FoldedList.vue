<script setup lang="ts" generic="Data extends object">
import { computed, onMounted, ref, shallowRef, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { request } from '../account';
import { useFold } from '../useFold';
import UiButton from './UiButton.vue';

// A list of thanks on the home page (docs/architecture.md#lists-of-thanks): a card folded until its
// title is pressed. The page asks the server for the list once, when the card is shown, so that
// the title can count the people it names, and again when the card is opened after a failure. The
// feedback contributions come from the database; the acknowledgments and the sponsors from
// ACKNOWLEDGMENTS.md and SPONSORS.md, which the server reads, so they can change without a new
// build. The card says what the list is for, while it loads, when it couldn't be loaded and while
// nobody is listed; the component that uses this one shows what the server sent, as plain text.
// Its title counts the people with `people`, and is the list's name alone without it, or until the
// list has come. The list unfolds and folds with its height eased (useFold.ts), as its marker turns.
const props = defineProps<{
  // The list's key in the locale files, which names its card too.
  name: 'contributions' | 'acknowledgments' | 'sponsors';
  api: string;
  people?: (data: Data) => number;
  // Whether the list has nobody, or nothing, in it.
  empty: (data: Data) => boolean;
  // Whether the card opens with the sentence that says what the list is for.
  intro?: boolean;
}>();
defineSlots<{ default(props: { data: Data }): unknown; none(): unknown }>();
const { t } = useI18n();
const panel = useId();
const open = ref(false);
const fold = useFold();

// The list once the server has sent it, and whether it is being asked or failed to answer.
const data = shallowRef<Data | null>(null);
const failed = ref(false);
let asking = false;

async function load(): Promise<void> {
  if (data.value !== null || asking) return;
  asking = true;
  failed.value = false;
  const reply = await request<Data>(props.api);
  asking = false;
  if (reply.ok) data.value = reply;
  else failed.value = true;
}

onMounted(load);

function toggle() {
  open.value = !open.value;
  if (open.value) void load();
}

const title = computed(() => {
  const count = data.value === null || !props.people ? null : props.people(data.value);
  return count === null ? t(`${props.name}.title`) : t(`${props.name}.counted`, { count }, count);
});
</script>

<template>
  <div :class="['fold', name]">
    <h2>
      <button type="button" class="toggle" :aria-expanded="open" :aria-controls="panel" @click="toggle">
        {{ title }}
      </button>
    </h2>
    <Transition :css="false" v-bind="fold">
      <div v-show="open" :id="panel" class="list">
        <p v-if="intro" class="intro">{{ t(`${name}.intro`) }}</p>
        <p v-if="failed" class="note failed">
          {{ t('thanks.failed') }}
          <UiButton variant="quiet" size="small" @click="load">{{ t('thanks.retry') }}</UiButton>
        </p>
        <p v-else-if="data === null" class="note">{{ t('thanks.loading') }}</p>
        <p v-else-if="empty(data)" class="note"><slot name="none" /></p>
        <slot v-else :data="data" />
      </div>
    </Transition>
  </div>
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

/* The marker turns to point down as the list unfolds. */
.toggle::before {
  content: '\25B8';
  display: inline-block;
  font-size: var(--text-xs);
  transition: transform 220ms var(--ease-out);
}

.toggle[aria-expanded='true']::before {
  transform: rotate(90deg);
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
</style>
