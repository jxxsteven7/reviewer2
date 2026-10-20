<script setup lang="ts">
import { BOARD_SIZE, type Language } from '@reviewer2/shared';
import { computed, nextTick, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { account } from '../account';
import FieldFold from '../components/FieldFold.vue';
import LanguageSwitch from '../components/LanguageSwitch.vue';
import PlayerAvatar from '../components/PlayerAvatar.vue';
import UiButton from '../components/UiButton.vue';
import UiSheet from '../components/UiSheet.vue';
import { errorKey } from '../errors';
import { fields, loadFields } from '../fields';
import { currentLanguage } from '../i18n';
import {
  agents,
  checkAgents,
  DEFAULT_FIELDS,
  PRACTICE_ROLES,
  storedFields,
  storedRole,
  storePractice,
  type PracticeRole,
} from '../practice';
import { keepRoomSetup, keptFields, lastPractice } from '../roomSetup';
import { send } from '../socket';
import { useBusy } from '../useBusy';

// "Play with Reviewer 1", in the first game's card on the home page
// (docs/architecture.md#practice-rooms): a button that opens a sheet, where an account says who
// plays. Just the player, which is the first choice: they pick their role, the language and the
// word lists, and start a game in a new private room, where Reviewer 1 takes the three other seats,
// which the sheet shows. Or the player with friends: they pick the language and the word lists
// alone, and open the waiting room of such a room, to send friends its link, sit, and have Reviewer
// 1 take the seats nobody takes. The role and the lists are those of the account's last practice
// room (RoomSetup), or of the browser's from before accounts kept it, or the PI and the general
// list; the lists fold into one line, which names them, so that the whole sheet fits on a phone's
// screen (FieldFold.vue). A guest is asked to log in or register. While the AI players don't
// answer, the button says so and can't be pressed; on a server without an agent, there is no
// button at all. The tutorial may lead here with who plays, and the role, chosen as a chapter
// taught them (`preset`): once the server has said that the AI players answer, the sheet opens
// with them, and they are kept, as any are, only once the player starts; while the AI players are
// offline, the button, which says so, comes into sight instead. Either way the page is told that
// the preset was `taken`, so that it offers it once.
const { t, locale } = useI18n();
// The first game, whose practice rooms these are.
const GAME = 'keywords';
// Who plays: the player alone, with Reviewer 1 in the other seats, or the player with friends.
const WHO = ['me', 'friends'] as const;
type Who = (typeof WHO)[number];
const props = defineProps<{ preset?: { who: Who; role?: PracticeRole } | null }>();
const emit = defineEmits<{ taken: [] }>();

const router = useRouter();
const id = useId();
const open = ref(false);
// The account's last practice room, as the server keeps it, or the browser's.
const lastRole = (): PracticeRole => PRACTICE_ROLES.find((known) => known === lastPractice(GAME)?.role) ?? storedRole();
const lastFields = (): string[] | null => {
  const kept = lastPractice(GAME)?.fields;
  return kept && kept.length > 0 ? kept : storedFields();
};
const who = ref<Who>('me');
const role = ref<PracticeRole>(lastRole());
const chosen = ref<string[]>([]);
const formError = ref<string | undefined>();
const { busy, run } = useBusy();
const language = computed(() => locale.value as Language);
const offered = computed(() => agents.value !== 'none');
const offline = computed(() => agents.value === 'down');
const persona = computed(() => t('agents.personas.reviewer1'));

checkAgents();

// The lists with enough words for a game in the room's language. The lists of the last practice
// room, or the general one, are chosen once the lists are here; a change of language then drops a
// chosen list that hasn't enough words in the new one, as in the room setup. They are chosen again
// each time the sheet opens, from what the account has kept since.
const usable = computed(
  () => new Set((fields.value ?? []).filter((field) => field.counts[language.value] >= BOARD_SIZE).map(({ id }) => id)),
);
let chosenOnce = false;
watch(
  usable,
  (ids) => {
    if (!fields.value) return;
    chosen.value = keptFields(chosenOnce ? chosen.value : (lastFields() ?? DEFAULT_FIELDS), ids);
    chosenOnce = true;
  },
  { immediate: true },
);

// Who sits where when the player plays alone: the player in the red group as the role chosen,
// Reviewer 1 everywhere else.
const seats = computed(() => {
  const me = { name: account.summary?.username ?? '', avatar: account.summary?.avatar ?? null, you: true };
  const ai = { name: persona.value, avatar: null, you: false };
  return [
    { team: 'red', captain: role.value === 'captain' ? me : ai, guesser: role.value === 'guesser' ? me : ai },
    { team: 'blue', captain: ai, guesser: ai },
  ] as const;
});

const ready = computed(() => account.summary !== null && !offline.value && chosen.value.length > 0);

function show(preset?: { who: Who; role?: PracticeRole }) {
  formError.value = undefined;
  who.value = preset?.who ?? 'me';
  role.value = preset?.role ?? lastRole();
  if (fields.value) chosen.value = keptFields(lastFields() ?? DEFAULT_FIELDS, usable.value);
  open.value = true;
  loadFields();
  checkAgents();
}

// The button comes into sight a frame after the page has drawn: the router scrolls a page it opens
// to its top once the page has drawn, which would undo an earlier scroll, as it would the room
// setup's (HomeView.vue).
const entry = ref<HTMLElement | null>(null);
const showEntry = () => nextTick(() => requestAnimationFrame(() => entry.value?.scrollIntoView({ block: 'center' })));
watch(
  [() => props.preset, agents],
  ([preset, status]) => {
    if (!preset || status === 'unknown') return;
    if (status === 'up') show(preset);
    else if (status === 'down') void showEntry();
    emit('taken');
  },
  { immediate: true },
);

async function start() {
  if (!ready.value) return;
  formError.value = undefined;
  const reply = await run(() =>
    send<{ code: string }>('room:create', {
      game: GAME,
      language: currentLanguage(),
      fields: chosen.value,
      practice: who.value === 'me' ? { who: 'me', role: role.value } : { who: 'friends' },
    }),
  );
  if (!reply) return;
  if (!reply.ok) {
    if (reply.error === 'agents_offline') agents.value = 'down';
    formError.value = t(errorKey(reply.error));
    return;
  }
  // What the next sheet starts from, as the server keeps it: the lists, and the role when the
  // player played alone; a room with friends leaves the role as it was.
  const alone = who.value === 'me';
  storePractice(alone ? role.value : null, chosen.value);
  keepRoomSetup(GAME, { practice: { ...(alone ? { role: role.value } : {}), fields: [...chosen.value] } });
  await router.push(`/room/${reply.code}`);
}
</script>

<template>
  <div v-if="offered" class="practice">
    <button ref="entry" type="button" class="entry press" :disabled="offline" @click="show()">
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
      <p v-if="!account.loaded" class="note">{{ t('account.loading') }}</p>
      <div v-else-if="!account.summary" class="sheet">
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
        <fieldset class="choices who-plays" :aria-labelledby="`${id}-who`">
          <legend :id="`${id}-who`">{{ t('home.practice.who') }}</legend>
          <label v-for="option in WHO" :key="option">
            <input v-model="who" type="radio" :name="`${id}-who`" :value="option" />
            <span class="option">{{ t(`home.practice.whoChoice.${option}`) }}</span>
            <span class="hint">{{ t(`home.practice.whoHints.${option}`) }}</span>
          </label>
        </fieldset>

        <template v-if="who === 'me'">
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

          <fieldset class="choices roles" :aria-labelledby="`${id}-role`">
            <legend :id="`${id}-role`">{{ t('home.practice.roleTitle') }}</legend>
            <label v-for="option in PRACTICE_ROLES" :key="option">
              <input v-model="role" type="radio" :name="`${id}-role`" :value="option" />
              <span class="option">{{ t(`home.practice.roles.${option}`) }}</span>
              <span class="hint">{{ t(`home.practice.roleHints.${option}`) }}</span>
            </label>
          </fieldset>
        </template>

        <div class="language">
          <span
            ><strong>{{ t('create.language') }}</strong> {{ t(`language.${language}`) }}</span
          >
          <LanguageSwitch />
        </div>

        <FieldFold v-model="chosen" :fields="fields" :language="language" :needed="BOARD_SIZE" />
        <p v-if="fields && usable.size > 0 && chosen.length === 0" class="hint">{{ t('home.practice.chooseField') }}</p>

        <p class="note">{{ t('home.practice.note') }}</p>
        <p v-if="formError" class="problem" role="alert">{{ formError }}</p>
        <p v-else-if="offline" class="problem" role="alert">{{ t('home.practice.offline') }}</p>
        <UiButton variant="primary" size="large" type="submit" class="start" :disabled="busy || !ready">
          {{ t(who === 'me' ? 'home.practice.start' : 'home.practice.open') }}
        </UiButton>
      </form>
    </UiSheet>
  </div>
</template>

<style scoped>
/* A second sticker in the game's card, under "New room": Reviewer 1's avatar, two lines and an
   arrow, which lifts and presses as "New room" does (`press` in base.css). Grey, with the reason in
   its second line, while the AI players don't answer. */
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

/* Reviewer 1's avatar wears the hard shadow of what a tap opens (docs/rules/display.md), as the button
   does, unless the button can't be pressed. */
.entry :deep(.avatar) {
  box-shadow: var(--shadow-1);
}

.entry:active:not(:disabled) :deep(.avatar) {
  box-shadow: none;
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
  box-shadow: none;
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

/* Who plays, and the role, as the room setup draws its choices. */
.choices {
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

.choices label {
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

.choices label:has(input:checked) {
  background: var(--bg);
}

.choices label:has(input:focus-visible) {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

.choices input {
  width: 20px;
  height: 20px;
  margin: 0;
  accent-color: var(--ink);
}

.option {
  font-weight: var(--weight-black);
}

.choices .hint {
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
