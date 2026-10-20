<script setup lang="ts">
import { drawFields, type FieldInfo, type Language } from '@reviewer2/shared';
import { computed, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { errorKey } from '../errors';
import { connection } from '../socket';
import { useFold } from '../useFold';
import FieldPicker from './FieldPicker.vue';

// The word lists of a room, folded into one line that names the chosen ones (docs/architecture.md
// #rooms), so that a setup fits on a phone's screen; a tap opens the lists (FieldPicker), with a way
// to choose them all and a way to choose them at random, each list in or out on the toss of a coin
// (drawFields). Where `eachGame` is offered, the room may instead draw its lists anew for every
// game: the line says so, and the lists chosen by hand are greyed out, kept for when it stops.
// Nothing chosen, the fold opens as soon as the lists are here, so that the choice is seen. The
// lists unfold and fold with their height eased (useFold.ts), as the marker turns.
const props = withDefaults(
  defineProps<{ fields: FieldInfo[] | null; language: Language; needed: number; eachGame?: boolean }>(),
  { eachGame: false },
);
const chosen = defineModel<string[]>({ required: true });
const random = defineModel<boolean>('random', { default: false });
const { t } = useI18n();
const id = useId();
const open = ref(false);
const fold = useFold();

const usable = computed(() => (props.fields ?? []).filter((field) => field.counts[props.language] >= props.needed));

// While the lists are on their way, or while they aren't coming because the server turned the page
// away (socket.ts), which is then said in their place.
const waiting = computed(() => t(connection.refusal ? errorKey(connection.refusal) : 'create.loadingFields'));

watch(
  () => props.fields !== null,
  (loaded) => {
    if (loaded && chosen.value.length === 0 && !random.value) open.value = true;
  },
  { immediate: true },
);

// The chosen lists in a line, in the order of the lists: one or two by name, more as the first two
// and how many there are beyond those.
const summary = computed(() => {
  if (!props.fields) return waiting.value;
  if (random.value) return t('create.fieldsEachSummary');
  const names = props.fields.filter((field) => chosen.value.includes(field.id)).map(({ name }) => name[props.language]);
  const [first, second] = names;
  if (first === undefined) return t('create.fieldsNone');
  if (second === undefined) return first;
  if (names.length === 2) return t('create.fieldsTwo', { first, second });
  return t('create.fieldsMore', { first, second, rest: names.length - 2 });
});

const chooseAll = () => {
  chosen.value = usable.value.map((field) => field.id);
};
const chooseAtRandom = () => {
  chosen.value = drawFields(
    usable.value.map((field) => field.id),
    (below) => Math.floor(Math.random() * below),
  );
};
</script>

<template>
  <div class="field-fold">
    <button type="button" class="toggle" :aria-expanded="open" :aria-controls="`${id}-lists`" @click="open = !open">
      <span class="text">
        <span class="title">{{ t('create.fields') }}</span>
        <span class="summary">{{ summary }}</span>
      </span>
    </button>
    <Transition :css="false" v-bind="fold">
      <div v-show="open" :id="`${id}-lists`" class="lists">
        <p v-if="!fields" class="hint">{{ waiting }}</p>
        <template v-else-if="usable.length">
          <label v-if="eachGame" class="each">
            <input v-model="random" type="checkbox" />
            <span class="option">{{ t('create.fieldsEach') }}</span>
            <span class="hint">{{ t('create.fieldsEachHint') }}</span>
          </label>
          <div class="head">
            <span class="hint">{{
              random ? t('create.fieldsDrawn') : t('create.fieldsChosen', { count: chosen.length })
            }}</span>
            <span class="tools">
              <button type="button" class="tool" :disabled="random" @click="chooseAtRandom">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
                  <circle cx="8.5" cy="8.5" r="1.4" />
                  <circle cx="15.5" cy="8.5" r="1.4" />
                  <circle cx="12" cy="12" r="1.4" />
                  <circle cx="8.5" cy="15.5" r="1.4" />
                  <circle cx="15.5" cy="15.5" r="1.4" />
                </svg>
                {{ t('create.fieldsRandom') }}
              </button>
              <button type="button" class="tool" :disabled="random" @click="chooseAll">
                {{ t('create.fieldsAll') }}
              </button>
            </span>
          </div>
          <FieldPicker v-model="chosen" :fields="fields" :language="language" :needed="needed" :disabled="random" />
        </template>
        <p v-else class="hint">{{ t('create.noFields') }}</p>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* A sticker whose whole first line is the button, with its marker in front. */
.field-fold {
  align-self: stretch;
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-1);
}

.toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 52px;
  padding: var(--space-2) var(--space-4);
  border: 0;
  border-radius: calc(var(--radius-panel) - var(--line));
  background: none;
  color: var(--ink);
  font: inherit;
  text-align: start;
  cursor: pointer;
  touch-action: manipulation;
}

/* The marker turns to point down as the lists unfold. */
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

.text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.title {
  font-weight: var(--weight-black);
  line-height: 1.3;
}

.summary {
  overflow: hidden;
  color: var(--ink-2);
  font-size: var(--text-sm);
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lists {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-1) var(--space-4) var(--space-4);
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

/* Drawing the lists anew for every game: a dashed sticker of its own, solid and tinted when on. */
.each {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 2px var(--space-3);
  padding: var(--space-2) var(--space-4);
  border: var(--line) dashed var(--ink);
  border-radius: var(--radius-control);
  background: var(--paper);
  cursor: pointer;
}

.each:has(input:checked) {
  border-style: solid;
  background: var(--bg-tint);
}

.each:has(input:focus-visible) {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

.each input {
  width: 20px;
  height: 20px;
  margin: 0;
  accent-color: var(--ink);
}

.each .option {
  font-weight: var(--weight-black);
}

.each .hint {
  grid-column: 2;
}

/* How many are chosen, and the two ways to choose at once, as underlined words on the right. */
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0 var(--space-2);
}

.tools {
  display: flex;
  gap: var(--space-1);
}

.tool {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 44px;
  padding: 0 var(--space-2);
  border: 0;
  background: none;
  color: var(--ink);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
  text-decoration: underline;
  text-underline-offset: 0.2em;
  cursor: pointer;
}

.tool:disabled {
  color: var(--ink-2);
  cursor: default;
}

.tool svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentcolor;
  stroke-width: 1.8;
}

.tool svg circle {
  fill: currentcolor;
  stroke: none;
}
</style>
