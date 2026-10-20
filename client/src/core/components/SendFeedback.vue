<script lang="ts">
import {
  checkContact,
  checkCredit,
  checkFeedback,
  FEEDBACK_KINDS,
  MAX_CONTACT_INPUT,
  MAX_FEEDBACK_INPUT,
  MAX_FEEDBACK_LENGTH,
  MAX_NAME_INPUT,
  textLength,
  type FeedbackKind,
  type FeedbackMessage,
  type FeedbackPage,
} from '@reviewer2/shared';
import { computed, reactive, ref, toRefs, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import { account, loadAccount } from '../account';
import { errorKey } from '../errors';
import { currentLanguage } from '../i18n';
import { connect, send } from '../socket';
import { toast } from '../toast';
import { useBusy } from '../useBusy';
import PlayerAvatar from './PlayerAvatar.vue';
import UiButton from './UiButton.vue';
import UiField from './UiField.vue';
import UiSheet from './UiSheet.vue';

// "Send feedback", for the footer of the home page and of a room, and its panel
// (docs/architecture.md); a page may give the button a label of its own, such as one with a
// drawing, and a look of its own, as the tutorial's last step on feedback has it, a main action. The text, the contact and the name for the feedback contributions are checked by the
// rules that the server applies (shared/src/feedback.ts), and go as those rules clean them: what
// the player pasted may hold characters that JSON writes out at six bytes each, and the message has
// to stay under the server's 16 KB. The panel says that what is written may become a public GitHub
// issue, with the name if there is one and never the contact; without a name, the player is listed
// as anonymous. Along with them go the build of this page, the language it is shown in and whether
// it is the home page or a room, but never the room's code. With a bug, the server also keeps the
// browser's user agent, which it reads from the connection, and the panel says so. The server
// keeps the account the player is logged in to, whether they sign the feedback or not. The player
// chooses to sign, which the panel offers first, or to stay anonymous: a player who is logged in
// signs with the account, which the contributions show by its avatar and username, either opening
// the account's panel (ProfilePanel.vue), and a guest leaves a name of their own, which signing
// then asks for. A guest is asked to log in first, by a way to the account page that brings them
// back to their room, if they are in one, and may send it all the same. Feedback that the server
// couldn't sign with the account makes the page ask again who the browser is, so that the form
// follows. Each kind gets a word on what to write, under the kinds.
//
// What is being written is kept outside the component, so that it survives the panel's closing
// and the component's going with it, as it does when the room menu that holds it closes.
type Signature = 'anonymous' | 'signed';
const SIGNATURES: readonly Signature[] = ['signed', 'anonymous'];
const draft = reactive({
  kind: 'idea' as FeedbackKind,
  text: '',
  contact: '',
  signature: 'signed' as Signature,
  credit: '',
});
</script>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{ page: FeedbackPage; variant?: 'primary' | 'quiet'; size?: 'normal' | 'small' }>(),
  { variant: 'quiet', size: 'small' },
);
const { t } = useI18n();
const name = useId();
const open = ref(false);
const route = useRoute();
const signatureName = useId();
const { kind, text, contact, signature, credit } = toRefs(draft);
// Whether the server has said that this browser is a guest, who is asked to log in first.
const guest = computed(() => account.loaded && account.summary === null);
// From a room, the account page leads back to it once the player has logged in (AccountPage.vue);
// from anywhere else, it leads home.
const signIn = computed(() =>
  route.path.startsWith('/room/') ? { path: '/account', query: { next: route.path } } : '/account',
);
// What the server had against what was sent, until something is changed.
const refused = ref<string | undefined>();
const { busy, run } = useBusy();

const checked = computed(() => checkFeedback(text.value));
const checkedContact = computed(() => checkContact(contact.value));
const checkedCredit = computed(() => checkCredit(credit.value));
// Who signs: the account, for a player who is logged in, or a name of their own, which a guest
// types, and which the feedback needs then. Until the server has said who this browser is, nobody
// is asked for a name, which a player who turns out to be logged in wouldn't need, and nothing
// signed is sent, which would go without a name or an account, as anonymous.
const signer = computed(() => (signature.value === 'signed' ? account.summary : null));
const asksName = computed(() => signature.value === 'signed' && account.loaded && account.summary === null);
const waitsForAccount = computed(() => signature.value === 'signed' && !account.loaded);
watch([kind, text, contact, signature, credit], () => (refused.value = undefined));

const count = computed(() => t('feedback.count', { count: textLength(checked.value.text), max: MAX_FEEDBACK_LENGTH }));
const textProblem = computed(() =>
  checked.value.problem === 'feedback_too_long' ? t(errorKey('feedback_too_long')) : undefined,
);
const contactProblem = computed(() =>
  checkedContact.value.problem ? t(errorKey(checkedContact.value.problem)) : undefined,
);
const creditProblem = computed(() =>
  checkedCredit.value.problem ? t(errorKey(checkedCredit.value.problem)) : undefined,
);
const ready = computed(
  () =>
    checked.value.problem === null &&
    checkedContact.value.problem === null &&
    !waitsForAccount.value &&
    (!asksName.value || (checkedCredit.value.problem === null && checkedCredit.value.credit !== null)),
);

// The home page may have no connection yet. It is made when the panel opens, so that it is there
// by the time the player has written something.
function openPanel() {
  open.value = true;
  connect();
}

function submit() {
  if (!ready.value) return;
  void run(async () => {
    const message: FeedbackMessage = {
      kind: kind.value,
      text: checked.value.text,
      ...(checkedContact.value.contact === null ? {} : { contact: checkedContact.value.contact }),
      ...(asksName.value && checkedCredit.value.credit !== null ? { credit: checkedCredit.value.credit } : {}),
      // Signed with the account, which the server keeps in place of any name.
      ...(signer.value === null ? {} : { linkProfile: true }),
      // The schema takes 64 characters; a build is named by its commit.
      version: __APP_VERSION__.slice(0, 64),
      language: currentLanguage(),
      page: props.page,
    };
    const reply = await send('meta:feedback', message);
    if (!reply.ok) {
      refused.value = t(errorKey(reply.error));
      // Feedback that couldn't be signed with the account: the login may have ended, or the
      // connection may not be the account's yet. The page asks again who the browser is, on which
      // the form asks a guest for a name, or the connection is made again as the account.
      if (reply.error === 'feedback_unsigned') void loadAccount();
      return;
    }
    kind.value = 'idea';
    text.value = '';
    contact.value = '';
    signature.value = 'signed';
    credit.value = '';
    open.value = false;
    toast('feedback.sent');
  });
}
</script>

<template>
  <UiButton :variant="variant" :size="size" @click="openPanel">
    <slot>{{ t('feedback.open') }}</slot>
  </UiButton>

  <UiSheet :open="open" :title="t('feedback.title')" @close="open = false">
    <form class="feedback" @submit.prevent="submit">
      <div v-if="guest" class="guest">
        <p>{{ t('feedback.guest') }}</p>
        <RouterLink :to="signIn" class="sign-in press">{{ t('feedback.signIn') }}</RouterLink>
      </div>
      <p class="note">{{ t('feedback.privacy') }}</p>

      <fieldset class="choices kinds">
        <legend>{{ t('feedback.kind') }}</legend>
        <label v-for="option in FEEDBACK_KINDS" :key="option" class="choice">
          <input v-model="kind" type="radio" :name="name" :value="option" />
          <span>{{ t(`feedback.kinds.${option}`) }}</span>
        </label>
      </fieldset>

      <p class="note">{{ t(`feedback.notes.${kind}`) }}</p>
      <UiField
        v-model="text"
        multiline
        :rows="5"
        :label="t('feedback.text')"
        :maxlength="MAX_FEEDBACK_INPUT"
        :hint="count"
        :error="textProblem"
        autocapitalize="sentences"
        spellcheck
      />
      <UiField
        v-model="contact"
        :label="t('feedback.contact')"
        :hint="t('feedback.contactHint')"
        :maxlength="MAX_CONTACT_INPUT"
        :error="contactProblem"
        enterkeyhint="next"
      />
      <fieldset class="choices signatures">
        <legend>{{ t('feedback.signature') }}</legend>
        <label v-for="option in SIGNATURES" :key="option" class="choice">
          <input v-model="signature" type="radio" :name="signatureName" :value="option" />
          <span>{{ t(`feedback.signatures.${option}`) }}</span>
        </label>
      </fieldset>
      <template v-if="signer">
        <p class="signer">
          <PlayerAvatar :name="signer.username" :avatar="signer.avatar" size="medium" />
          <span>{{ signer.username }}</span>
        </p>
        <p class="note">{{ t('feedback.accountHint') }}</p>
      </template>
      <UiField
        v-else-if="asksName"
        v-model="credit"
        :label="t('feedback.credit')"
        :hint="t('feedback.creditHint')"
        :maxlength="MAX_NAME_INPUT"
        :error="creditProblem"
        enterkeyhint="send"
      />
      <p v-else-if="signature === 'anonymous'" class="note">{{ t('feedback.anonymousHint') }}</p>
      <p v-if="kind === 'bug'" class="note">{{ t('feedback.bugNote') }}</p>

      <p v-if="refused" class="problem" role="alert">{{ refused }}</p>
      <UiButton variant="primary" type="submit" :disabled="busy || !ready">{{ t('feedback.submit') }}</UiButton>
    </form>
  </UiSheet>
</template>

<style scoped>
.feedback {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.note {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.choices {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: 0;
}

legend {
  width: 100%;
  margin-bottom: var(--space-2);
  padding: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

/* A choice, a little smaller than a button, so that the four kinds fit on one line in Chinese on a
   phone; English, whose names are longer, may take two. */
.choice {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 40px;
  padding: 0 var(--space-3) 0 var(--space-2);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--paper);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  cursor: pointer;
}

.choice:has(input:checked) {
  background: var(--bg);
}

.choice:has(input:focus-visible) {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

.choice input {
  margin: 0;
  accent-color: var(--ink);
}

.guest {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-3);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--bg-tint);
  font-size: var(--text-sm);
}

.guest p {
  flex: 1 1 12rem;
}

/* The way to the account page, a small sticker of its own like the account's entry on a page, as
   tall as a finger, with the hard shadow and the press of what opens something. */
.sign-in {
  display: inline-flex;
  flex: none;
  align-items: center;
  min-height: 44px;
  padding: var(--space-1) var(--space-3);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--paper);
  box-shadow: var(--shadow-1);
  color: var(--ink);
  font-weight: var(--weight-bold);
  text-decoration: none;
}

/* The account that signs, as the contributions will show it: its avatar and its username. */
.signer {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-weight: var(--weight-bold);
  overflow-wrap: anywhere;
}

.problem {
  color: var(--red-deep);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}
</style>
