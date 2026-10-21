<script setup lang="ts">
import { LANGUAGES, MATCH_GAMES, type Language, type MatchRules } from '@reviewer2/shared';
import { computed, onMounted, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { games } from '../../games';
import { gameInfo } from '../../games/info';
import { account } from '../account';
import BetaNote from '../components/BetaNote.vue';
import ChoiceRow from '../components/ChoiceRow.vue';
import FieldFold from '../components/FieldFold.vue';
import LanguageSwitch from '../components/LanguageSwitch.vue';
import MatchForm from '../components/MatchForm.vue';
import PlayChoice from '../components/PlayChoice.vue';
import UiButton from '../components/UiButton.vue';
import { errorKey } from '../errors';
import { fields, loadFields } from '../fields';
import { currentLanguage } from '../i18n';
import { DEFAULT_FIELDS } from '../practice';
import { keepRoomSetup, keptFields, lastRoom } from '../roomSetup';
import { send } from '../socket';
import { useBusy } from '../useBusy';

// Setting up a room of a game: the language (the interface language, which the switch changes),
// where the words come from, for a game whose words may come from elsewhere than the word lists
// (GameScreens.Source), the word lists, folded into a line (FieldFold.vue), or lists drawn anew for
// every game, while the game draws its words from them, the game's own settings, whether it is an
// ordinary room or a match, and the match's rules, for a game with matches, whether the room is
// private or listed on the home page, which some settings of a game keep private
// (GameInfo.mayBePublic), and whether the creator plays or only watches. A game in beta says so
// first (BetaNote.vue). The creator
// becomes the chair either way. A creator who is logged in has their username, which the masthead
// shows, and only they may list the room; a guest has a number in the room, and gives no name, and
// is told in a line that the games are recorded, which an account agreed to as it registered
// (privacy.guestNotice). The setup starts from the last one (roomSetup.ts), as far as it still
// holds: lists that the language has too few words in drop out, a setting that no longer will do
// is the game's default, and a guest's room is private. A `fresh` setup, as the tutorial shows
// one, starts from the defaults instead, with the general list, whatever the last room was.
const props = withDefaults(defineProps<{ game: string; fresh?: boolean }>(), { fresh: false });
const emit = defineEmits<{ cancel: [] }>();
const { t, locale } = useI18n();
const router = useRouter();

const last = props.fresh ? null : lastRoom(props.game);
const chosen = ref<string[]>(props.fresh ? [...DEFAULT_FIELDS] : keptFields(last?.fields));
const randomFields = ref(last?.randomFields === true);
const play = ref(typeof last?.play === 'boolean' ? last.play : true);
// What the server had against the form.
const formError = ref<string | undefined>();
const { busy, run } = useBusy();
const language = computed(() => locale.value as Language);
const info = computed(() => gameInfo(props.game));
const usable = computed(() => (fields.value ?? []).filter((field) => info.value?.usable(field, language.value)));
// The game's settings, with its own form, which also says whether they will do: those of the last
// room of this game, which the game reads for this language, knowing the last room's, if it was
// kept.
const screens = computed(() => games[props.game]);
const settings = ref<object | undefined>(
  last?.settings !== undefined
    ? screens.value?.restoreSettings(
        last.settings,
        language.value,
        LANGUAGES.find((known) => known === last.language) ?? null,
      )
    : screens.value?.defaultSettings(language.value),
);
const settingsValid = ref(true);
// Whether the game draws its words from the lists with these settings, and whether a room with
// them may be listed.
const drawsWords = computed(() => info.value?.drawsWords(settings.value) ?? true);
const mayBePublic = computed(() => info.value?.mayBePublic(settings.value) ?? true);
// An ordinary room, or a match by these rules, in a game with matches (GameScreens.match).
const matches = computed(() => screens.value?.match !== undefined);
const lastMatch = screens.value?.match?.restore(last?.match) ?? null;
const isMatch = ref(lastMatch !== null);
const match = ref<MatchRules>(lastMatch ?? screens.value?.match?.defaults() ?? { games: MATCH_GAMES.default });
const matchValid = ref(true);
const group = useId();
// Private, as rooms always were, or public (docs/architecture.md#public-rooms).
const isPublic = ref(last?.public === true && account.summary !== null && mayBePublic.value);
const visibility = useId();
watch(mayBePublic, (may) => {
  if (!may) isPublic.value = false;
});
const publicHint = computed(() =>
  t(
    !account.summary
      ? 'create.publicNeedsAccount'
      : mayBePublic.value
        ? 'create.publicHint'
        : `games.${props.game}.privateOnly`,
  ),
);

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
const needsField = computed(
  () => drawsWords.value && usable.value.length > 0 && !chosen.value.length && !randomFields.value,
);
const id = useId();
// Whether the form will do. create() checks it too, since a form can be submitted without its
// button. The lists must have come, so that those chosen have been checked against them.
const ready = computed(
  () =>
    (!drawsWords.value || (fields.value !== null && (chosen.value.length > 0 || randomFields.value))) &&
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
      fields: drawsWords.value ? chosen.value : [],
      ...(drawsWords.value && randomFields.value ? { randomFields: true } : {}),
      ...(settings.value ? { settings: settings.value } : {}),
      ...(isMatch.value && matches.value ? { match: match.value } : {}),
      ...(isPublic.value && mayBePublic.value ? { public: true } : {}),
      play: play.value,
    }),
  );
  if (!reply) return;
  if (!reply.ok) {
    formError.value = t(errorKey(reply.error));
    return;
  }
  keepRoomSetup(props.game, {
    room: {
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
    <BetaNote v-if="info?.beta" :game="game" text="beta.create" />
    <section class="step">
      <h3>{{ t('create.language') }}</h3>
      <LanguageSwitch />
      <p class="hint">{{ t('create.languageHint', { language: t(`language.${language}`) }) }}</p>
    </section>

    <section v-if="screens?.Source && settings" class="step">
      <component :is="screens.Source" v-model="settings" />
    </section>

    <section
      v-if="drawsWords"
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
        :game="game"
        each-game
      />
    </section>

    <section v-if="screens && settings" class="step">
      <h3>{{ t('create.settings') }}</h3>
      <component :is="screens.Settings" v-model="settings" v-model:valid="settingsValid" :language="language" />
    </section>

    <section v-if="matches" class="step">
      <h3 :id="`${group}-kind`">{{ t('match.kind') }}</h3>
      <fieldset class="kind" :aria-labelledby="`${group}-kind`">
        <ChoiceRow :option="t('match.ordinary')" :hint="t('match.ordinaryHint')">
          <input v-model="isMatch" type="radio" :name="group" :value="false" />
        </ChoiceRow>
        <ChoiceRow :option="t('match.match')" :hint="t('match.matchHint')">
          <input v-model="isMatch" type="radio" :name="group" :value="true" />
        </ChoiceRow>
      </fieldset>
      <MatchForm v-if="isMatch" v-model="match" v-model:valid="matchValid" :game="game" />
    </section>

    <section class="step">
      <h3 :id="`${visibility}-label`">{{ t('create.visibility') }}</h3>
      <fieldset class="kind" :aria-labelledby="`${visibility}-label`">
        <ChoiceRow :option="t('create.private')" :hint="t('create.privateHint')">
          <input v-model="isPublic" type="radio" :name="visibility" :value="false" />
        </ChoiceRow>
        <ChoiceRow :option="t('create.public')" :hint="publicHint">
          <input
            v-model="isPublic"
            type="radio"
            :name="visibility"
            :value="true"
            :disabled="!account.summary || !mayBePublic"
          />
        </ChoiceRow>
      </fieldset>
    </section>

    <section class="step">
      <PlayChoice v-model="play" />
    </section>

    <p v-if="formError" class="problem" role="alert">{{ formError }}</p>

    <p v-if="needsField" :id="`${id}-hint`" class="hint">{{ t('create.chooseField') }}</p>
    <p v-if="!account.summary" class="notice">{{ t('privacy.guestNotice') }}</p>
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

.notice {
  color: var(--ink-2);
  font-size: var(--text-xs);
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
