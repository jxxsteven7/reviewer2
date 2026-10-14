<script setup lang="ts">
import { BOARD_SIZE } from '@reviewer2/shared';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import tipCode from '../../assets/wechat-tip.jpg';
import AccountEntry from '../components/AccountEntry.vue';
import AcknowledgmentsList from '../components/AcknowledgmentsList.vue';
import ContributionsList from '../components/ContributionsList.vue';
import LanguageSwitch from '../components/LanguageSwitch.vue';
import PageMasthead from '../components/PageMasthead.vue';
import SendFeedback from '../components/SendFeedback.vue';
import SponsorsList from '../components/SponsorsList.vue';
import UiButton from '../components/UiButton.vue';
import UiSheet from '../components/UiSheet.vue';
import { games } from '../../games';
import { storedLanguage, useLanguage } from '../i18n';
import BackToRoom from './BackToRoom.vue';
import CreateRoom from './CreateRoom.vue';
import JoinRoom from './JoinRoom.vue';
import LanguageGate from './LanguageGate.vue';
import FriendsPlaying from './FriendsPlaying.vue';
import PracticeRoom from './PracticeRoom.vue';
import PublicRooms from './PublicRooms.vue';

// The home page: the way back to any room where the player still has a seat, the tagline, a line
// on how to play, the ways into a room, by its number, by the rooms that friends are in or from the
// list of public rooms, the first game on a big sticker, with the way to practise it with
// Reviewer 1, the games to come below it, the feedback contributions, the acknowledgments and the
// sponsors, folded, and footnotes, which offer a way to buy the author a cola and the way to send
// them feedback, each with a drawing, and name the build's version. The author, linked to their
// page, follows the line on how to play, or on a narrow English page the tagline, whose last line
// has room for them there; the page holds both and shows one. On a wide screen the games stand on
// the right, beside the rest.
// The WeChat reward code is bundled with the page, as is everything it shows, and kept as the author
// gave it but for its metadata: WeChat reads it when a player presses and holds it, which a smaller
// or recompressed copy could spoil. Below it, a note tells tippers how to ask to be on the list of
// sponsors: by a name, or "list me", in the tip's message.
const { t } = useI18n();
const version = __APP_VERSION__;
const chosen = ref(storedLanguage() !== null);
// The rules of the first game, beside its name, as a new room in the page's language has them.
const keywords = games.keywords;
const language = useLanguage();
const creating = ref(false);
const tipping = ref(false);

const forthcoming = ['impostor', 'titles', 'abstracts'];
</script>

<template>
  <LanguageGate v-if="!chosen" @chosen="chosen = true" />
  <div v-else class="page home">
    <PageMasthead><AccountEntry /><LanguageSwitch /></PageMasthead>
    <BackToRoom />

    <main>
      <div class="heading">
        <h1>{{ t('app.tagline') }}</h1>
        <i18n-t keypath="footer.byline" tag="span" class="byline after-tagline" scope="global">
          <template #name>
            <a class="author" href="https://jxxsteven7.github.io/" target="_blank" rel="noopener noreferrer">{{
              t('footer.author')
            }}</a>
          </template>
        </i18n-t>
      </div>
      <p class="intro">
        <span>{{ t('home.intro') }}</span>
        <i18n-t keypath="footer.byline" tag="span" class="byline" scope="global">
          <template #name>
            <a class="author" href="https://jxxsteven7.github.io/" target="_blank" rel="noopener noreferrer">{{
              t('footer.author')
            }}</a>
          </template>
        </i18n-t>
      </p>

      <section class="ways">
        <JoinRoom />
        <FriendsPlaying />
        <PublicRooms />
      </section>

      <section class="contents">
        <ol>
          <li class="entry">
            <div class="line">
              <span class="title"
                >{{ t('home.games.keywords.name')
                }}<component
                  :is="keywords.Rules"
                  v-if="keywords"
                  link
                  defaults
                  :settings="keywords.defaultSettings(language)"
                  :language="language"
              /></span>
              <UiButton v-if="!creating" variant="red" size="large" @click="creating = true">
                {{ t('home.newRoom') }}
              </UiButton>
            </div>
            <p class="summary">{{ t('home.games.keywords.summary') }}</p>
            <p class="meta">{{ t('home.players') }}</p>
            <PracticeRoom v-if="!creating" />
            <CreateRoom v-if="creating" game="keywords" :words-needed="BOARD_SIZE" @cancel="creating = false" />
          </li>
          <li v-for="game in forthcoming" :key="game" class="entry forthcoming">
            <div class="line">
              <span class="title">{{ t(`home.games.${game}.name`) }}</span>
              <span class="status">{{ t('home.forthcoming') }}</span>
            </div>
            <p class="summary">{{ t(`home.games.${game}.summary`) }}</p>
          </li>
        </ol>
      </section>

      <div class="thanks">
        <ContributionsList />
        <AcknowledgmentsList />
        <SponsorsList @tip="tipping = true" />
      </div>
    </main>

    <footer class="footnotes">
      <UiButton variant="quiet" size="small" @click="tipping = true">
        <span class="footnote">
          <svg class="icon cola" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 7.5 14 2h4" />
            <path class="cup" d="M6.5 9.5h11l-1.4 11.6a1.6 1.6 0 0 1-1.6 1.4H9.5a1.6 1.6 0 0 1-1.6-1.4Z" />
            <path class="band" d="M7.2 14.2h9.6l-.4 3.3H7.6Z" />
            <rect class="lid" x="5" y="6.6" width="14" height="3" rx="1.5" />
          </svg>
          {{ t('footer.tip') }}
        </span>
      </UiButton>
      <SendFeedback page="home">
        <span class="footnote">
          <svg class="icon bulb" viewBox="0 0 24 24" aria-hidden="true">
            <path
              class="glass"
              d="M12 2.5a6.5 6.5 0 0 0-3.9 11.7c.8.6 1.4 1.5 1.4 2.5v.8h5v-.8c0-1 .6-1.9 1.4-2.5A6.5 6.5 0 0 0 12 2.5Z"
            />
            <path d="M9.5 20h5M10.5 22.5h3M9.4 8a3 3 0 0 1 2.1-2" />
          </svg>
          {{ t('footer.feedback') }}
        </span>
      </SendFeedback>
      <p class="version num">{{ t('footer.version', { version }) }}</p>
    </footer>

    <UiSheet :open="tipping" :title="t('footer.tip')" @close="tipping = false">
      <figure class="tip">
        <img :src="tipCode" :alt="t('footer.tipCode')" width="1152" height="1152" />
        <figcaption>{{ t('footer.tipHint') }}</figcaption>
      </figure>
      <p class="listing">
        <strong>{{ t('footer.listTitle') }}</strong>
        {{ t('footer.listHow') }}
      </p>
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

/* How to play, close under the tagline, and the author after it, who goes to the start of a line
   of their own when the sentence leaves no room. */
.intro {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 var(--space-3);
  margin-top: calc(-1 * var(--space-4));
  font-size: var(--text-md);
}

.byline {
  color: var(--ink-2);
  white-space: nowrap;
}

/* Below 30rem the English tagline takes two lines (it fits on one from about 32rem), and the
   author follows its last line instead, going to a line of their own if it leaves no room. */
.after-tagline {
  display: none;
}

@media (max-width: 29.99rem) {
  .home:lang(en) h1 {
    display: inline;
    margin-inline-end: var(--space-3);
  }

  .home:lang(en) .after-tagline {
    display: inline-block;
  }

  .home:lang(en) .intro .byline {
    display: none;
  }
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
   summary below, the button and the way to practise at the bottom, and the room setup after that
   when it opens, in their place. The
   dashed stickers of the games to come follow, with room above them. */
.entry:not(.forthcoming) {
  display: grid;
  width: 100%;
  margin-bottom: var(--space-3);
  grid-template-areas:
    'title meta'
    'summary summary'
    'button button'
    'practice practice'
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

.entry:not(.forthcoming) > :deep(.practice) {
  grid-area: practice;
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

/* The games to come: a dashed sticker each, with a line about the game. */
.forthcoming {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: var(--line) dashed var(--ink);
  border-radius: var(--radius-panel);
}

.forthcoming .line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-2);
}

.forthcoming .title {
  font-family: var(--font-sans);
  font-size: var(--text-md);
  font-weight: var(--weight-black);
}

.forthcoming .summary {
  color: var(--ink-2);
  font-size: var(--text-sm);
  line-height: 1.5;
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

/* The feedback contributions, the acknowledgments and the sponsors, a folded card each. */
.thanks {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* Every footnote, button or not, is 44 px high with the same room on either side, so the words
   stand the same distance apart and on one middle line, the drawings' with them. The row reaches
   that room past both edges of the column, so the first footnote of every line starts on the
   column's edge. */
.footnotes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 var(--space-2);
  margin: var(--space-6) calc(-1 * var(--space-2)) 0;
  padding: var(--space-3) 0 max(var(--space-4), env(safe-area-inset-bottom));
  font-size: var(--text-sm);
}

.version {
  padding: 0 var(--space-2);
  color: var(--ink-2);
  line-height: 44px;
}

/* A small button's padding outweighs the quiet one's, and its border takes room too. */
.footnotes > :deep(.button) {
  padding: 0 var(--space-2);
  border-width: 0;
}

/* The footnotes' drawings, in ink, in front of their words: a cup of cola with a lid and a bent
   straw, and a light bulb for ideas. Each stands centered on the line of its words, in either
   language. */
.footnote {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
}

.icon {
  display: block;
  flex: none;
  width: 1.5em;
  height: 1.5em;
  fill: none;
  stroke: var(--ink);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.6;
}

.bulb .glass {
  fill: var(--paper);
}

.cola .cup {
  fill: var(--red);
}

.cola .band {
  fill: var(--paper);
  stroke: none;
}

.cola .lid {
  fill: var(--paper);
}

/* The author's name: blue, and underlined under a pointer or the keyboard. Its focus ring sits
   close, clear of "By" before it; a tap on a touch screen leaves no underline. */
.author {
  display: inline-block;
  color: var(--blue-deep);
  text-decoration: none;
}

.author:focus-visible {
  outline-offset: 0;
  text-decoration: underline;
}

@media (hover: hover) {
  .author:hover {
    text-decoration: underline;
  }
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

/* How a tipper gets on the list of sponsors: a sticker of its own, so that nobody misses it. */
.listing {
  width: min(100%, 20rem);
  margin: var(--space-4) auto 0;
  padding: var(--space-3) var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--bg);
  box-shadow: var(--shadow-1);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.listing strong {
  display: block;
  margin-bottom: var(--space-1);
  font-size: var(--text-md);
}

.sponsor {
  margin-top: var(--space-3);
}

@media (min-width: 40rem) {
  .entry:not(.forthcoming) {
    padding: var(--space-6) var(--space-5);
  }
}

/* On a wide screen the contents stand on the right, and the rest keeps to the left, which is at
   least 30rem wide, so that the tagline stays on one line where the columns are at their
   narrowest. */
@media (min-width: 60rem) {
  main {
    grid-template-areas:
      'tagline contents'
      'intro contents'
      'ways contents'
      'thanks contents';
    grid-template-columns: minmax(30rem, 1.1fr) minmax(0, 1fr);
    grid-template-rows: auto auto auto 1fr;
    gap: var(--space-5) var(--space-7);
    padding-top: var(--space-6);
  }

  .heading {
    grid-area: tagline;
  }

  .intro {
    grid-area: intro;
    margin-top: calc(-1 * var(--space-3));
  }

  .contents {
    grid-area: contents;
  }

  .ways {
    grid-area: ways;
  }

  .thanks {
    grid-area: thanks;
    align-self: start;
  }
}
</style>
