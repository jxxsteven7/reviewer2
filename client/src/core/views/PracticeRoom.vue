<script setup lang="ts">
import { BOARD_SIZE, type Language } from '@reviewer2/shared';
import { computed, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { account } from '../account';
import FieldPicker from '../components/FieldPicker.vue';
import LanguageSwitch from '../components/LanguageSwitch.vue';
import PlayerAvatar from '../components/PlayerAvatar.vue';
import UiButton from '../components/UiButton.vue';
import UiSheet from '../components/UiSheet.vue';
import { errorKey } from '../errors';
import { fields, loadFields } from '../fields';
import { currentLanguage } from '../i18n';
import {
  agentsAvailable,
  checkAgents,
  DEFAULT_FIELDS,
  PRACTICE_ROLES,
  storedFields,
  storedRole,
  storePractice,
  type PracticeRole,
} from '../practice';
import { send } from '../socket';
import { useBusy } from '../useBusy';

// "Practice with Reviewer 1", in the first game's card on the home page
// (docs/architecture.md#practice-rooms): a button that opens a sheet, where an account picks its
// role, the language and the word lists, and starts a game in a new private room, where Reviewer 1
// takes the three other seats. The sheet shows who will sit where. The role and the lists are
// those of the last practice room, which the browser remembers, or the PI and the general list;
// the lists fold into one line, which names them, so that the whole sheet fits on a phone's
// screen. A guest is asked to log in or register. While the AI players don't answer, the button
// says so and can't be pressed.
const { t, locale } = useI18n();
const router = useRouter();
const id = useId();
const open = ref(false);
const role = ref<PracticeRole>(storedRole());
const chosen = ref<string[]>([]);
const folded = ref(true);
const formError = ref<string | undefined>();
const { busy, run } = useBusy();
const language = computed(() => locale.value as Language);
const offline = computed(() => agentsAvailable.value === false);
const persona = computed(() => t('agents.personas.reviewer1'));

checkAgents();

// The lists with enough words for a game in the room's language. The lists of the last practice
// room, or the general one, are chosen once the lists are here; a change of language then drops a
// chosen list that hasn't enough words in the new one, as in the room setup.
const usable = computed(
  () => new Set((fields.value ?? []).filter((field) => field.counts[language.value] >= BOARD_SIZE).map(({ id }) => id)),
);
let chosenOnce = false;
watch(
  usable,
  (ids) => {
    if (!fields.value) return;
    const from = chosenOnce ? chosen.value : (storedFields() ?? DEFAULT_FIELDS);
    chosen.value = from.filter((field) => ids.has(field));
    chosenOnce = true;
  },
  { immediate: true },
);

// The chosen lists in a line, in the order of the setup's list: one or two by name, more as the
// first two and how many in all.
const summary = computed(() => {
  if (!fields.value) return t('create.loadingFields');
  const names = fields.value.filter((field) => chosen.value.includes(field.id)).map(({ name }) => name[language.value]);
  const [first, second] = names;
  if (first === undefined) return t('home.practice.chooseField');
  if (second === undefined) return first;
  if (names.length === 2) return t('home.practice.fieldsTwo', { first, second });
  return t('home.practice.fieldsMore', { first, second, count: names.length });
});

// Who sits where: the player in the red group as the role chosen, Reviewer 1 everywhere else.
const seats = computed(() => {
  const me = { name: account.summary?.username ?? '', avatar: account.summary?.avatar ?? null, you: true };
  const ai = { name: persona.value, avatar: null, you: false };
  return [
    { team: 'red', captain: role.value === 'captain' ? me : ai, guesser: role.value === 'guesser' ? me : ai },
    { team: 'blue', captain: ai, guesser: ai },
  ] as const;
});

const ready = computed(() => account.summary !== null && !offline.value && chosen.value.length > 0);

function show() {
  formError.value = undefined;
  folded.value = true;
  open.value = true;
  loadFields();
  checkAgents();
}

async function start() {
  if (!ready.value) return;
  formError.value = undefined;
  const reply = await run(() =>
    send<{ code: string }>('room:create', {
      game: 'keywords',
      language: currentLanguage(),
      fields: chosen.value,
      practice: { role: role.value },
    }),
  );
  if (!reply) return;
  if (!reply.ok) {
    if (reply.error === 'agents_offline') agentsAvailable.value = false;
    formError.value = t(errorKey(reply.error));
    return;
  }
  storePractice(role.value, chosen.value);
  await router.push(`/room/${reply.code}`);
}
</script>

<template>
  <div class="practice">
    <button type="button" class="entry" :disabled="offline" @click="show">
      <PlayerAvatar :name="persona" agent size="medium" />
      <span class="text">
        <span class="main">{{ t('home.practice.entry') }}</span>
        <span class="sub" :class="{ off: offline }">{{
          offline ? t('home.practice.offline') : t('home.practice.entryHint')
        }}</span>
      </span>
      <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 5 7 7-7 7" /></svg>
    </button>

    <UiSheet :open="open" :title="t('home.practice.entry')" @close="open = false">
      <div v-if="!account.summary" class="sheet">
        <p class="note">{{ t('home.practice.intro') }}</p>
        <p class="login">
          <strong>{{ t('home.practice.loginTitle') }}</strong>
          {{ t('home.practice.loginHint') }}
        </p>
        <div class="row">
          <UiButton variant="primary" @click="router.push('/account')">{{ t('account.signIn.login') }}</UiButton>
          <UiButton @click="router.push({ path: '/account', query: { register: '1' } })">{{
            t('account.signIn.register')
          }}</UiButton>
        </div>
      </div>

      <form v-else class="sheet" @submit.prevent="start">
        <div class="seats">
          <section v-for="group in seats" :key="group.team" :class="['group', group.team]">
            <h3>{{ t(`lobby.group.${group.team}`) }}</h3>
            <div v-for="seat in PRACTICE_ROLES" :key="seat" class="seat">
              <span class="role">{{ t(`home.practice.roles.${seat}`) }}</span>
              <span class="who">
                <PlayerAvatar :name="group[seat].name" :avatar="group[seat].avatar" :agent="!group[seat].you" />
                <span class="name">{{ group[seat].name }}</span>
                <span v-if="group[seat].you" class="you">{{ t('home.practice.you') }}</span>
              </span>
            </div>
          </section>
        </div>

        <fieldset class="roles" :aria-labelledby="`${id}-role`">
          <legend :id="`${id}-role`">{{ t('home.practice.roleTitle') }}</legend>
          <label v-for="option in PRACTICE_ROLES" :key="option">
            <input v-model="role" type="radio" :name="`${id}-role`" :value="option" />
            <span class="option">{{ t(`home.practice.roles.${option}`) }}</span>
            <span class="hint">{{ t(`home.practice.roleHints.${option}`) }}</span>
          </label>
        </fieldset>

        <div class="language">
          <span
            ><strong>{{ t('create.language') }}</strong> {{ t(`language.${language}`) }}</span
          >
          <LanguageSwitch />
        </div>

        <div class="fold">
          <button
            type="button"
            class="toggle"
            :aria-expanded="!folded"
            :aria-controls="`${id}-fields`"
            @click="folded = !folded"
          >
            <span class="fold-text">
              <span class="fold-title">{{ t('create.fields') }}</span>
              <span class="fold-summary">{{ summary }}</span>
            </span>
          </button>
          <div v-show="!folded" :id="`${id}-fields`" class="fold-list">
            <p v-if="!fields" class="hint">{{ t('create.loadingFields') }}</p>
            <FieldPicker
              v-else-if="usable.size > 0"
              v-model="chosen"
              :fields="fields"
              :language="language"
              :needed="BOARD_SIZE"
            />
            <p v-else class="hint">{{ t('create.noFields') }}</p>
          </div>
        </div>

        <p class="note">{{ t('home.practice.note') }}</p>
        <p v-if="formError" class="problem" role="alert">{{ formError }}</p>
        <p v-else-if="offline" class="problem" role="alert">{{ t('home.practice.offline') }}</p>
        <UiButton variant="red" size="large" type="submit" class="start" :disabled="busy || !ready">
          {{ t('home.practice.start') }}
        </UiButton>
      </form>
    </UiSheet>
  </div>
</template>

<style scoped>
/* A second sticker in the game's card, under "New room": Reviewer 1's avatar, two lines and an
   arrow. Grey, with the reason in its second line, while the AI players don't answer. */
.entry {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0 var(--space-3);
  width: 100%;
  min-height: 64px;
  padding: var(--space-2) var(--space-4) var(--space-2) var(--space-3);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--paper);
  box-shadow: var(--shadow-1);
  color: var(--ink);
  font: inherit;
  text-align: start;
  cursor: pointer;
  touch-action: manipulation;
}

.entry:active:not(:disabled) {
  box-shadow: none;
  transform: translate(2px, 2px);
}

.entry:focus-visible {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

.text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.main {
  font-size: var(--text-lg);
  font-weight: var(--weight-black);
  line-height: 1.25;
}

.sub {
  color: var(--ink-2);
  font-size: var(--text-sm);
  line-height: 1.35;
}

.chevron {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: var(--ink);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2.6;
}

.entry:disabled {
  border-color: var(--neutral);
  background: var(--paper-2);
  box-shadow: none;
  color: var(--ink-2);
  cursor: not-allowed;
}

.entry:disabled :deep(.avatar) {
  border-color: var(--ink-2);
  opacity: 0.55;
  filter: grayscale(1);
}

.entry:disabled .chevron {
  stroke: var(--neutral);
}

/* Offline: a hollow dot before the reason, as for a player who is offline. */
.sub.off {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.sub.off::before {
  flex: none;
  width: 8px;
  height: 8px;
  border: var(--line-thin) solid var(--ink-2);
  border-radius: 50%;
  content: '';
}

.sheet {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* Who sits where: the two groups side by side, the player's seat marked. */
.seats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
}

.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2) var(--space-3) var(--space-3);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-card);
}

.group.red {
  background: var(--red-tint);
}

.group.blue {
  background: var(--blue-tint);
}

.group h3 {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
}

.red h3 {
  color: var(--red-deep);
}

.blue h3 {
  color: var(--blue-deep);
}

.seat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.role {
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
}

.who {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.you {
  flex: none;
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--ink);
  color: var(--on-ink);
  font-size: var(--text-xs);
  font-weight: var(--weight-black);
  line-height: 1.6;
}

/* The role, as the room setup draws its choices. */
.roles {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: 0;
}

legend {
  margin-bottom: var(--space-2);
  padding: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.roles label {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 0 var(--space-3);
  min-height: 52px;
  padding: var(--space-2) var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--paper);
  cursor: pointer;
}

.roles label:has(input:checked) {
  background: var(--bg);
}

.roles label:has(input:focus-visible) {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

.roles input {
  width: 20px;
  height: 20px;
  margin: 0;
  accent-color: var(--ink);
}

.option {
  font-weight: var(--weight-black);
}

.roles .hint {
  grid-column: 2;
}

.hint,
.note {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.note {
  line-height: 1.5;
}

.language {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  font-size: var(--text-md);
}

.language strong {
  margin-inline-end: var(--space-3);
  font-weight: var(--weight-black);
}

/* The word lists, folded into one line that names them, as the home page folds its lists of
   thanks: the whole line is the button, with its marker in front. */
.fold {
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

.fold-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.fold-title {
  font-weight: var(--weight-black);
  line-height: 1.3;
}

.fold-summary {
  overflow: hidden;
  color: var(--ink-2);
  font-size: var(--text-sm);
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fold-list {
  padding: var(--space-1) var(--space-4) var(--space-4);
}

.problem {
  color: var(--red-deep);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.start {
  width: 100%;
}

/* A guest: why to log in, on a sticker, and the two ways to. */
.login {
  padding: var(--space-3) var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--bg);
  box-shadow: var(--shadow-1);
  font-size: var(--text-md);
  line-height: 1.5;
}

.login strong {
  display: block;
  margin-bottom: var(--space-1);
}

.row {
  display: flex;
  gap: var(--space-3);
}

.row > * {
  flex: 1;
}
</style>
