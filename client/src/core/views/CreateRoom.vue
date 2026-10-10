<script setup lang="ts">
import { defaultMatchRules, MAX_NAME_INPUT, type Language, type MatchRules } from '@reviewer2/shared';
import { computed, onMounted, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { games } from '../../games';
import { account } from '../account';
import FieldPicker from '../components/FieldPicker.vue';
import LanguageSwitch from '../components/LanguageSwitch.vue';
import MatchForm from '../components/MatchForm.vue';
import PlayChoice from '../components/PlayChoice.vue';
import PlayerAvatar from '../components/PlayerAvatar.vue';
import UiButton from '../components/UiButton.vue';
import UiField from '../components/UiField.vue';
import { errorKey } from '../errors';
import { fields, loadFields } from '../fields';
import { currentLanguage } from '../i18n';
import { storedName, storeName } from '../session';
import { send } from '../socket';
import { useBusy } from '../useBusy';
import { useNameField } from '../useNameField';

// Setting up a room: the language (the interface language, which the switch changes), the word
// lists, the game's own settings, whether it is an ordinary room or a match, and the match's
// rules, the creator's nickname, and whether they play or only watch.
// The creator becomes the chair either way. A creator who is logged in has their username, and is
// asked for no nickname.
const props = defineProps<{ game: string; wordsNeeded: number }>();
const emit = defineEmits<{ cancel: [] }>();
const { t, locale } = useI18n();
const router = useRouter();

const chosen = ref<string[]>([]);
const { name, clean, problem, refuse } = useNameField(storedName());
const play = ref(true);
// What the server had against the form, apart from the name, which the name field shows.
const formError = ref<string | undefined>();
const { busy, run } = useBusy();
const language = computed(() => locale.value as Language);
const usable = computed(() =>
  (fields.value ?? []).filter((field) => field.counts[language.value] >= props.wordsNeeded),
);
// The game's settings, with its own form, which also says whether they will do.
const screens = computed(() => games[props.game]);
const settings = ref<object | undefined>(screens.value?.defaultSettings(language.value));
const settingsValid = ref(true);
// An ordinary room, or a match by these rules.
const isMatch = ref(false);
const match = ref<MatchRules>(defaultMatchRules());
const matchValid = ref(true);
const group = useId();

// The creator chooses the lists: none is chosen to begin with. When a change of language leaves
// a chosen list without enough words, it drops out, and nothing is chosen in its place.
watch(usable, (lists) => {
  const ids = new Set(lists.map((field) => field.id));
  chosen.value = chosen.value.filter((id) => ids.has(id));
});
// Whether to say that a list must be chosen: while there are lists to choose from and none is.
// The group of lists points at the hint, so that a screen reader reads it with them. The button
// can't: it is disabled while the hint shows, so the keyboard never reaches it.
const needsField = computed(() => usable.value.length > 0 && !chosen.value.length);
const id = useId();
// Whether the form will do. create() checks it too, since a form can be submitted without its
// button. A creator who is logged in needs no nickname: theirs is the username.
const ready = computed(
  () =>
    chosen.value.length > 0 &&
    (!!clean.value || account.summary !== null) &&
    settingsValid.value &&
    (!isMatch.value || matchValid.value),
);

onMounted(loadFields);

const NAME_ERRORS = ['name_required', 'name_invalid', 'name_taken', 'name_reserved'];

async function create() {
  if (!ready.value) return;
  formError.value = undefined;
  const reply = await run(() =>
    send<{ code: string }>('room:create', {
      game: props.game,
      language: currentLanguage(),
      fields: chosen.value,
      ...(settings.value ? { settings: settings.value } : {}),
      ...(isMatch.value ? { match: match.value } : {}),
      ...(account.summary ? {} : { name: name.value }),
      play: play.value,
    }),
  );
  if (!reply) return;
  if (!reply.ok) {
    if (NAME_ERRORS.includes(reply.error) && !account.summary) refuse(reply.error);
    else formError.value = t(errorKey(reply.error));
    return;
  }
  if (!account.summary) storeName(clean.value ?? name.value.trim());
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
      :aria-labelledby="`${id}-fields`"
      :aria-describedby="needsField ? `${id}-hint` : undefined"
    >
      <h3 :id="`${id}-fields`">{{ t('create.fields') }}</h3>
      <p v-if="!fields" class="hint">{{ t('create.loadingFields') }}</p>
      <FieldPicker
        v-else-if="usable.length"
        v-model="chosen"
        :fields="fields"
        :language="language"
        :needed="wordsNeeded"
      />
      <p v-else class="hint">{{ t('create.noFields') }}</p>
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
      <i18n-t v-if="account.summary" keypath="account.as" tag="p" class="as" scope="global">
        <template #name>
          <PlayerAvatar :name="account.summary.username" :avatar="account.summary.avatar" />
          <strong>{{ account.summary.username }}</strong>
        </template>
      </i18n-t>
      <UiField
        v-else
        v-model="name"
        :label="t('create.name')"
        :maxlength="MAX_NAME_INPUT"
        autocomplete="nickname"
        enterkeyhint="go"
        :error="problem"
      />
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
  padding: var(--space-4) 0 var(--space-2);
}

.step {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

h3 {
  color: var(--ink-2);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: 500;
  font-variant-caps: all-small-caps;
  letter-spacing: 0.06em;
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
  margin: 0;
  padding: 0;
  border: 0;
}

.kind label {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 0 var(--space-3);
  min-height: 48px;
  padding: var(--space-2) 0;
  cursor: pointer;
}

.kind label + label {
  border-top: 1px solid var(--rule);
}

.kind input {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--ink);
}

.kind .hint {
  grid-column: 2;
  color: var(--ink-3);
}

.kind + .match-form {
  margin-top: var(--space-3);
}

.problem {
  color: var(--red);
  font-size: var(--text-sm);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}
</style>
