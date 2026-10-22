<script setup lang="ts">
import type { RoomView } from '@reviewer2/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { account } from '../account';
import { act } from '../socket';
import ShareTools from './ShareTools.vue';
import UiButton from './UiButton.vue';
import UiSheet from './UiSheet.vue';

// The head of every game's waiting room: the game's name and "Waiting room" in the display font,
// the tag that says whether the room is public, and the tools to share the room (ShareTools.vue).
// The chair switches the room between public and private from the tag, as in the room menu, and
// without asking again. Listing it takes an account: a guest is told so, with the way to log in or
// register and come back to the room (AccountPage), where the server finds them in their seat, the
// chair's included.
const props = defineProps<{ room: RoomView; isChair: boolean }>();
const { t } = useI18n();

const needsAccount = ref(false);
const signIn = computed(() => ({ path: '/account', query: { next: `/room/${props.room.code}` } }));
function switchVisibility() {
  if (!props.room.public && !account.summary) {
    needsAccount.value = true;
    return;
  }
  void act('room:public', { public: !props.room.public });
}
</script>

<template>
  <header class="lobby-head">
    <p class="kicker">
      {{ t(`games.${room.game}.name`) }} &middot; {{ t('lobby.kicker') }}
      <button v-if="isChair" type="button" class="visibility press-host" @click="switchVisibility">
        <span class="tag" :class="{ listed: room.public, 'press-part': !room.public }">{{
          t(room.public ? 'room.public' : 'room.private')
        }}</span>
        <span class="sr-only">{{ t(room.public ? 'room.makePrivate' : 'room.makePublic') }}</span>
      </button>
      <span v-else-if="room.public" class="public">{{ t('room.public') }}</span>
    </p>
    <ShareTools :room="room" />
  </header>
  <UiSheet :open="needsAccount" :title="t('room.makePublic')" @close="needsAccount = false">
    <div class="needs-account">
      <p>{{ t('room.publicNeedsAccount') }}</p>
      <RouterLink v-slot="{ href, navigate }" :to="signIn" custom>
        <UiButton variant="primary" :href="href" @click="navigate">{{ t('room.signIn') }}</UiButton>
      </RouterLink>
    </div>
  </UiSheet>
</template>

<style scoped>
.lobby-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4) 0;
}

.lobby-head .kicker {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--weight-display);
  font-synthesis: none;
}

.public,
.tag {
  display: inline-block;
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--ink);
  color: var(--on-ink);
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  line-height: 1.6;
}

.public {
  margin-left: var(--space-1);
  vertical-align: middle;
}

/* The chair's tag is a sticker to tap, 44 px high to the finger (docs/rules/display.md): white
   while the room is private, when it lifts and presses as a sticker does (`press-part` in
   base.css), and ink and flat once it is listed, as the others see it. */
.visibility {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  margin: calc(-1 * var(--space-2)) 0;
  padding: 0 var(--space-1);
  border: 0;
  background: none;
  color: inherit;
  vertical-align: middle;
  cursor: pointer;
  touch-action: manipulation;
}

.visibility .tag {
  padding: 2px var(--space-3);
  border: var(--line-thin) solid var(--ink);
  background: var(--paper);
  box-shadow: var(--shadow-1);
  color: var(--ink);
}

.visibility .tag.listed {
  background: var(--ink);
  box-shadow: none;
  color: var(--on-ink);
}

.needs-account {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
</style>
