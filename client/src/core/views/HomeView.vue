<script setup lang="ts">
import { BOARD_SIZE } from '@reviewer2/shared';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import tipCode from '../../assets/wechat-tip.jpg';
import AccountEntry from '../components/AccountEntry.vue';
import AcknowledgmentsList from '../components/AcknowledgmentsList.vue';
import LanguageSwitch from '../components/LanguageSwitch.vue';
import PageMasthead from '../components/PageMasthead.vue';
import SendFeedback from '../components/SendFeedback.vue';
import SponsorsList from '../components/SponsorsList.vue';
import UiButton from '../components/UiButton.vue';
import UiSheet from '../components/UiSheet.vue';
import { storedLanguage } from '../i18n';
import CreateRoom from './CreateRoom.vue';
import JoinRoom from './JoinRoom.vue';
import LanguageGate from './LanguageGate.vue';
import PublicRooms from './PublicRooms.vue';

// The home page: the tagline, the first game on a big sticker with the games to come below it,
// the ways into a room, by its number or from the list of public rooms, and footnotes, which name
// the author, offer a way to buy them a cola, the way to send them feedback and, folded, the
// acknowledgments and the sponsors. On a wide screen the games stand on the right, beside the rest.
// The WeChat reward code is bundled with the page, as is everything it shows, and kept as the author
// gave it but for its metadata: WeChat reads it when a player presses and holds it, which a smaller
// or recompressed copy could spoil.
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

      <section class="contents">
        <ol>
          <li class="entry">
            <div class="line">
              <span class="title">{{ t('home.games.keywords.name') }}</span>
              <UiButton v-if="!creating" variant="red" size="large" @click="creating = true">
                {{ t('home.newRoom') }}
              </UiButton>
            </div>
            <p class="summary">{{ t('home.games.keywords.summary') }}</p>
            <p class="meta">{{ t('home.players') }}</p>
            <CreateRoom v-if="creating" game="keywords" :words-needed="BOARD_SIZE" @cancel="creating = false" />
          </li>
          <li v-for="game in forthcoming" :key="game" class="entry forthcoming">
            <div class="line">
              <span class="title">{{ t(`home.games.${game}.name`) }}</span>
              <span class="status">{{ t('home.forthcoming') }}</span>
            </div>
          </li>
        </ol>
      </section>

      <section class="ways">
        <JoinRoom />
        <PublicRooms />
      </section>
    </main>

    <footer class="footnotes">
      <p class="credits">
        <a href="https://jxxsteven7.github.io/" target="_blank" rel="noopener noreferrer">{{ t('footer.byline') }}</a>
        <UiButton variant="quiet" size="small" @click="tipping = true">{{ t('footer.tip') }}</UiButton>
      </p>
      <p class="num">{{ t('footer.version', { version }) }}</p>
      <SendFeedback page="home" />
      <AcknowledgmentsList />
      <SponsorsList @tip="tipping = true" />
    </footer>

    <UiSheet :open="tipping" :title="t('footer.tip')" @close="tipping = false">
      <figure class="tip">
        <img :src="tipCode" :alt="t('footer.tipCode')" width="1152" height="1152" />
        <figcaption>{{ t('footer.tipHint') }}</figcaption>
      </figure>
      <p class="sponsor">
        <a href="https://github.com/sponsors/jxxsteven7" target="_blank" rel="noopener noreferrer">{{
          t('footer.sponsor')
        }}</a>
      </p>
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
  display: grid;
  flex: 1;
  gap: var(--space-5);
  align-content: start;
  padding-top: var(--space-4);
}

h1 {
  font-size: var(--text-4xl);
  line-height: 1.08;
}

.intro {
  margin-top: calc(-1 * var(--space-3));
  font-size: var(--text-lg);
}

ol {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* The first game is a big sticker that takes the row: its name and players on one row, the
   summary below, the button at the bottom, and the room setup after that when it opens. The
   dashed stickers of the games to come follow, with room above them. */
.entry:not(.forthcoming) {
  display: grid;
  width: 100%;
  margin-bottom: var(--space-3);
  grid-template-areas:
    'title meta'
    'summary summary'
    'button button'
    'create create';
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: var(--space-3) var(--space-3);
  padding: var(--space-5) var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-hero);
  background: var(--paper);
  box-shadow: var(--shadow-3);
}

.entry:not(.forthcoming) .line {
  display: contents;
}

.entry:not(.forthcoming) .line > :deep(.button) {
  grid-area: button;
  justify-self: stretch;
}

.entry:not(.forthcoming) > :deep(.create) {
  grid-area: create;
}

.title {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--weight-display);
  font-synthesis: none;
  line-height: 1.1;
}

.entry:not(.forthcoming) .title {
  grid-area: title;
}

.summary {
  grid-area: summary;
  line-height: 1.6;
}

.meta {
  grid-area: meta;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  background: var(--ink);
  color: var(--on-ink);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  white-space: nowrap;
}

/* The games to come: a dashed sticker each, in a row. */
.forthcoming {
  display: inline-flex;
  padding: var(--space-2) var(--space-4);
  border: var(--line) dashed var(--ink);
  border-radius: var(--radius-pill);
}

.forthcoming .line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-2);
}

.forthcoming .title {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.status {
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
}

/* The ways into a room. Not named "join": a scoped rule reaches a child's root element, and the
   form of JoinRoom is one. */
.ways {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.footnotes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-4);
  margin-top: var(--space-6);
  padding: var(--space-3) 0 max(var(--space-4), env(safe-area-inset-bottom));
  font-size: var(--text-sm);
}

.credits {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 var(--space-2);
}

/* The feedback button and the folds of the lists of thanks line up with the footnotes around them;
   the list that a fold opens keeps to the column. */
.footnotes > :deep(.button),
.footnotes > :deep(.fold > summary) {
  margin-left: calc(-1 * var(--space-2));
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
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
}

.tip figcaption,
.sponsor {
  color: var(--ink-2);
  font-size: var(--text-sm);
  text-align: center;
}

.sponsor {
  margin-top: var(--space-3);
}

@media (min-width: 40rem) {
  .entry:not(.forthcoming) {
    padding: var(--space-6) var(--space-5);
  }
}

/* On a wide screen the contents stand on the right, and the rest keeps to the left. */
@media (min-width: 60rem) {
  main {
    grid-template-areas:
      'tagline contents'
      'intro contents'
      'ways contents';
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
    grid-template-rows: auto auto 1fr;
    gap: var(--space-5) var(--space-7);
    padding-top: var(--space-6);
  }

  h1 {
    grid-area: tagline;
  }

  .intro {
    grid-area: intro;
    margin-top: 0;
  }

  .contents {
    grid-area: contents;
  }

  .ways {
    grid-area: ways;
  }
}
</style>
