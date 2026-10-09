<script setup lang="ts">
import { BOARD_SIZE } from '@reviewer2/shared';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import tipCode from '../../assets/wechat-tip.jpg';
import AccountEntry from '../components/AccountEntry.vue';
import LanguageSwitch from '../components/LanguageSwitch.vue';
import PageMasthead from '../components/PageMasthead.vue';
import SendFeedback from '../components/SendFeedback.vue';
import UiButton from '../components/UiButton.vue';
import UiSheet from '../components/UiSheet.vue';
import { storedLanguage } from '../i18n';
import CreateRoom from './CreateRoom.vue';
import JoinRoom from './JoinRoom.vue';
import LanguageGate from './LanguageGate.vue';

// The home page, set out like the contents page of a journal: the games, the way into a room,
// and footnotes, which name the author, offer a way to buy them a cola and the way to send them
// feedback. The WeChat reward code is bundled with the page, as is everything it shows, and kept
// as the author gave it but for its metadata: WeChat reads it when a player presses and holds it,
// which a smaller or recompressed copy could spoil.
const { t } = useI18n();
const version = __APP_VERSION__;
const chosen = ref(storedLanguage() !== null);
const creating = ref(false);
const tipping = ref(false);

const forthcoming = ['impostor', 'titles', 'abstracts'];
</script>

<template>
  <LanguageGate v-if="!chosen" @chosen="chosen = true" />
  <div v-else class="page home">
    <PageMasthead><AccountEntry /><LanguageSwitch /></PageMasthead>

    <main>
      <h1>{{ t('app.tagline') }}</h1>
      <p class="intro">{{ t('home.intro') }}</p>

      <section class="contents" aria-labelledby="contents">
        <h2 id="contents" class="kicker">{{ t('home.contents') }}</h2>
        <ol>
          <li class="entry">
            <div class="line">
              <span class="number">1</span>
              <span class="title">{{ t('home.games.keywords.name') }}</span>
              <span class="leader" aria-hidden="true"></span>
              <UiButton v-if="!creating" variant="primary" size="small" @click="creating = true">
                {{ t('home.newRoom') }}
              </UiButton>
            </div>
            <p class="summary">{{ t('home.games.keywords.summary') }}</p>
            <p class="meta">{{ t('home.players') }}</p>
            <CreateRoom v-if="creating" game="keywords" :words-needed="BOARD_SIZE" @cancel="creating = false" />
          </li>
          <li v-for="(game, index) in forthcoming" :key="game" class="entry forthcoming">
            <div class="line">
              <span class="number">{{ index + 2 }}</span>
              <span class="title">{{ t(`home.games.${game}.name`) }}</span>
              <span class="leader" aria-hidden="true"></span>
              <span class="status">{{ t('home.forthcoming') }}</span>
            </div>
            <p class="summary">{{ t(`home.games.${game}.summary`) }}</p>
          </li>
        </ol>
      </section>

      <section class="join" aria-labelledby="join">
        <h2 id="join" class="kicker">{{ t('home.join.title') }}</h2>
        <JoinRoom />
      </section>
    </main>

    <footer class="footnotes">
      <p>{{ t('footer.noSignUp') }}</p>
      <p class="credits">
        <a href="https://jxxsteven7.github.io/" target="_blank" rel="noopener noreferrer">{{ t('footer.byline') }}</a>
        <UiButton variant="quiet" size="small" @click="tipping = true">{{ t('footer.tip') }}</UiButton>
      </p>
      <p>{{ t('footer.build', { version }) }}</p>
      <SendFeedback page="home" />
    </footer>

    <UiSheet :open="tipping" :title="t('footer.tip')" @close="tipping = false">
      <figure class="tip">
        <img :src="tipCode" :alt="t('footer.tipCode')" width="1152" height="1152" />
        <figcaption>{{ t('footer.tipHint') }}</figcaption>
      </figure>
    </UiSheet>
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
}

main {
  flex: 1;
  padding-top: var(--space-6);
}

h1 {
  font-size: var(--text-2xl);
}

.intro {
  margin-top: var(--space-3);
  color: var(--ink-2);
  font-size: var(--text-lg);
}

.contents,
.join {
  margin-top: var(--space-6);
}

.contents h2,
.join h2 {
  margin-bottom: var(--space-2);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--ink);
}

ol {
  margin: 0;
  padding: 0;
  list-style: none;
}

.entry {
  padding: var(--space-4) 0;
  border-bottom: 1px solid var(--rule);
}

.line {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.number {
  width: 1.5em;
  color: var(--ink-3);
  font-family: var(--font-serif);
  font-variant-numeric: tabular-nums;
}

.title {
  font-family: var(--font-serif);
  font-size: var(--text-xl);
  font-weight: 600;
}

.leader {
  flex: 1;
  align-self: flex-end;
  margin-bottom: 0.45em;
  border-bottom: 1px dotted var(--ink-3);
}

.summary,
.meta {
  margin-left: calc(1.5em + var(--space-3));
}

.summary {
  margin-top: var(--space-1);
  color: var(--ink-2);
}

.meta {
  margin-top: var(--space-1);
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.forthcoming .title {
  color: var(--ink-2);
  font-weight: 500;
}

.status {
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.footnotes {
  margin-top: var(--space-7);
  padding: var(--space-3) 0 max(var(--space-4), env(safe-area-inset-bottom));
  border-top: 1px solid var(--rule);
  color: var(--ink-3);
  font-size: var(--text-xs);
}

.credits {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 var(--space-3);
  font-size: var(--text-sm);
}

.credits a {
  color: var(--ink-2);
}

.tip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  margin: 0;
}

/* Shown whole, never cropped, at a size that a phone's camera and WeChat's press-and-hold read. */
.tip img {
  display: block;
  width: min(100%, 20rem);
  height: auto;
}

.tip figcaption {
  color: var(--ink-2);
  font-size: var(--text-sm);
  text-align: center;
}

/* The feedback button lines up with the footnotes above it. */
.footnotes > :deep(.button) {
  margin-left: calc(-1 * var(--space-3));
}

@media (min-width: 40rem) {
  h1 {
    font-size: var(--text-3xl);
  }
}

/* Chinese has no true italics, and slanted characters look broken. */
.status:lang(en) {
  font-style: italic;
}
</style>
