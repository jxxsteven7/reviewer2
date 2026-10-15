<script setup lang="ts">
import { defaultMatchRules, LANGUAGES, type Language, type MatchRules } from '@reviewer2/shared';
import { computed, onMounted, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { games } from '../../games';
import { account } from '../account';
import FieldFold from '../components/FieldFold.vue';
import LanguageSwitch from '../components/LanguageSwitch.vue';
import MatchForm from '../components/MatchForm.vue';
import PlayChoice from '../components/PlayChoice.vue';
import PlayerAvatar from '../components/PlayerAvatar.vue';
import UiButton from '../components/UiButton.vue';
import { errorKey } from '../errors';
import { fields, loadFields } from '../fields';
import { currentLanguage } from '../i18n';
import { keepRoomSetup, keptFields, keptMatch, lastRoom } from '../roomSetup';
import { send } from '../socket';
import { useBusy } from '../useBusy';

// Setting up a room: the language (the interface language, which the switch changes), the word
// lists, folded into a line (FieldFold.vue), or lists drawn anew for every game, the game's own
// settings, whether it is an ordinary room or a match, and the match's rules, whether the room is
// private or listed on the home page, and whether the creator plays or only watches. The creator
// becomes the chair either way. A creator who is logged in has their username, and only they may
// list the room; a guest has a number in the room, and gives no name. The setup starts from the last one
// (roomSetup.ts), as far as it still holds: lists that the language has too few words in drop out,
// a setting that no longer will do is the game's default, and a guest's room is private.
const props = defineProps<{ game: string; wordsNeeded: number }>();
const emit = defineEmits<{ cancel: [] }>();
const { t, locale } = useI18n();
const router = useRouter();

const last = lastRoom();
const chosen = ref<string[]>(keptFields(last?.fields));
const randomFields = ref(last?.randomFields === true);
const play = ref(typeof last?.play === 'boolean' ? last.play : true);
// What the server had against the form.
const formError = ref<string | undefined>();
const { busy, run } = useBusy();
const language = computed(() => locale.value as Language);
const usable = computed(() =>
  (fields.value ?? []).filter((field) => field.counts[language.value] >= props.wordsNeeded),
);
// The game's settings, with its own form, which also says whether they will do: those of the last
// room, which the game reads for this language, knowing the last room's, if it was kept.
const screens = computed(() => games[props.game]);
const settings = ref<object | undefined>(
  last?.game === props.game && last.settings !== undefined
    ? screens.value?.restoreSettings(
        last.settings,
        language.value,
        LANGUAGES.find((known) => known === last.language) ?? null,
      )
    : screens.value?.defaultSettings(language.value),
);
const settingsValid = ref(true);
// An ordinary room, or a match by these rules.
const lastMatch = keptMatch(last?.match);
const isMatch = ref(lastMatch !== null);
const match = ref<MatchRules>(lastMatch ?? defaultMatchRules());
const matchValid = ref(true);
const group = useId();
// Private, as rooms always were, or public (docs/architecture.md#public-rooms).
const isPublic = ref(last?.public === true && account.summary !== null);
const visibility = useId();

// The creator chooses the lists, those of the last room to begin with. When the lists come, or a
// change of language leaves a chosen list without enough words, it drops out, and nothing is
// chosen in its place.
watch(
  usable,
  (lists) => {
    if (!fields.value) return;
    chosen.value = keptFields(chosen.value, new Set(lists.map((field) => field.id)));
  },
  { immediate: true },
);
// Whether to say that a list must be chosen: while there are lists to choose from and none is.
// The group of lists points at the hint, so that a screen reader reads it with them. The button
// can't: it is disabled while the hint shows, so the keyboard never reaches it.
const needsField = computed(() => usable.value.length > 0 && !chosen.value.length && !randomFields.value);
const id = useId();
// Whether the form will do. create() checks it too, since a form can be submitted without its
// button. The lists must have come, so that those chosen have been checked against them.
const ready = computed(
  () =>
    fields.value !== null &&
    (chosen.value.length > 0 || randomFields.value) &&
    settingsValid.value &&
    (!isMatch.value || matchValid.value),
);

onMounted(loadFields);

async function create() {
  if (!ready.value) return;
  formError.value = undefined;
  const reply = await run(() =>
    send<{ code: string }>('room:create', {
      game: props.game,
      language: currentLanguage(),
      fields: chosen.value,
      ...(randomFields.value ? { randomFields: true } : {}),
      ...(settings.value ? { settings: settings.value } : {}),
      ...(isMatch.value ? { match: match.value } : {}),
      ...(isPublic.value ? { public: true } : {}),
      play: play.value,
    }),
  );
  if (!reply) return;
  if (!reply.ok) {
    formError.value = t(errorKey(reply.error));
    return;
  }
  keepRoomSetup({
    room: {
      game: props.game,
      language: currentLanguage(),
      fields: [...chosen.value],
      randomFields: randomFields.value,
      ...(settings.value ? { settings: settings.value } : {}),
      match: isMatch.value ? { ...match.value } : null,
      public: isPublic.value,
      play: play.value,
    },
  });
  await router.push(`/room/${reply.code}`);
}
</script>

<template>
  <form class="create" @submit.prevent="create">
    <section class="step">
      <h3>{{ t('create.language') }}</h3>
      <LanguageSwitch />
      <p class="hint">{{ t('create.languageHint', { language: t(`language.${language}`) }) }}</p>
    </section>

    <section
      class="step"
      role="group"
      :aria-label="t('create.fields')"
      :aria-describedby="needsField ? `${id}-hint` : undefined"
    >
      <FieldFold
        v-model="chosen"
        v-model:random="randomFields"
        :fields="fields"
        :language="language"
        :needed="wordsNeeded"
        each-game
      />
    </section>

    <section v-if="screens && settings" class="step">
      <h3>{{ t('create.settings') }}</h3>
      <component :is="screens.Settings" v-model="settings" v-model:valid="settingsValid" :language="language" />
    </section>

    <section class="step">
      <h3 :id="`${group}-kind`">{{ t('match.kind') }}</h3>
      <fieldset class="kind" :aria-labelledby="`${group}-kind`">
        <label>
          <input v-model="isMatch" type="radio" :name="group" :value="false" />
          <span class="option">{{ t('match.ordinary') }}</span>
          <span class="hint">{{ t('match.ordinaryHint') }}</span>
        </label>
        <label>
          <input v-model="isMatch" type="radio" :name="group" :value="true" />
          <span class="option">{{ t('match.match') }}</span>
          <span class="hint">{{ t('match.matchHint') }}</span>
        </label>
      </fieldset>
      <MatchForm v-if="isMatch" v-model="match" v-model:valid="matchValid" />
    </section>

    <section class="step">
      <h3 :id="`${visibility}-label`">{{ t('create.visibility') }}</h3>
      <fieldset class="kind" :aria-labelledby="`${visibility}-label`">
        <label>
          <input v-model="isPublic" type="radio" :name="visibility" :value="false" />
          <span class="option">{{ t('create.private') }}</span>
          <span class="hint">{{ t('create.privateHint') }}</span>
        </label>
        <label>
          <input v-model="isPublic" type="radio" :name="visibility" :value="true" :disabled="!account.summary" />
          <span class="option">{{ t('create.public') }}</span>
          <span class="hint">{{ t(account.summary ? 'create.publicHint' : 'create.publicNeedsAccount') }}</span>
        </label>
      </fieldset>
    </section>

    <section class="step">
      <i18n-t v-if="account.summary" keypath="account.as" tag="p" class="as" scope="global">
        <template #name>
          <PlayerAvatar :name="account.summary.username" :avatar="account.summary.avatar" />
          <strong>{{ account.summary.username }}</strong>
        </template>
      </i18n-t>
      <PlayChoice v-model="play" />
    </section>

    <p v-if="formError" class="problem" role="alert">{{ formError }}</p>

    <p v-if="needsField" :id="`${id}-hint`" class="hint">{{ t('create.chooseField') }}</p>
    <div class="actions">
      <UiButton variant="primary" type="submit" :disabled="busy || !ready">{{ t('create.submit') }}</UiButton>
      <UiButton variant="quiet" @click="emit('cancel')">{{ t('create.cancel') }}</UiButton>
    </div>
  </form>
</template>

<style scoped>
.create {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding-top: var(--space-2);
}

.step {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

.step > :deep(.field),
.step > :deep(.settings-form) {
  align-self: stretch;
}

h3 {
  font-size: var(--text-xl);
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.as {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.as :deep(.avatar) {
  margin-right: calc(var(--space-2) * -0.5);
}

.kind {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-self: stretch;
  margin: 0;
  padding: 0;
  border: 0;
}

.kind label {
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

.kind label:has(input:checked) {
  background: var(--bg);
}

.kind label:has(input:disabled) {
  color: var(--ink-2);
  cursor: default;
}

.kind label:has(input:focus-visible) {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

.kind input {
  width: 20px;
  height: 20px;
  margin: 0;
  accent-color: var(--ink);
}

.kind .option {
  font-weight: var(--weight-black);
}

.kind .hint {
  grid-column: 2;
}

.step > :deep(.match-form) {
  align-self: stretch;
}

.problem {
  color: var(--red-deep);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}
</style>
