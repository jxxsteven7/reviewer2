<script setup lang="ts">
import { type AcknowledgmentBlock, LIST_API } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import AcknowledgmentPieces from './AcknowledgmentPieces.vue';
import FoldedList from './FoldedList.vue';

// The acknowledgments on the home page (docs/architecture.md#acknowledgments): ACKNOWLEDGMENTS.md,
// which the maintainers write as they like, in any language, as the server reads it. It comes as
// headings, paragraphs and lists of text, bold, italic and links (shared/src/acknowledgments.ts),
// shown as they are written whatever the page's language, never as markup. The file's rules are
// checked before it is merged and before the server shows it. Nothing in it is counted, so the
// card's title is its name alone.
const { t } = useI18n();

type Acknowledgments = { blocks: AcknowledgmentBlock[] };
const empty = ({ blocks }: Acknowledgments) => blocks.length === 0;
</script>

<template>
  <FoldedList name="acknowledgments" :api="LIST_API.acknowledgments" :empty="empty">
    <template #none>{{ t('acknowledgments.none') }}</template>
    <template #default="{ data }">
      <template v-for="(block, index) in data.blocks" :key="index">
        <h3 v-if="block.kind === 'heading' && block.level === 2"><AcknowledgmentPieces :pieces="block.pieces" /></h3>
        <h4 v-else-if="block.kind === 'heading'"><AcknowledgmentPieces :pieces="block.pieces" /></h4>
        <p v-else-if="block.kind === 'paragraph'"><AcknowledgmentPieces :pieces="block.pieces" /></p>
        <ul v-else>
          <li v-for="(item, at) in block.items" :key="at"><AcknowledgmentPieces :pieces="item" /></li>
        </ul>
      </template>
    </template>
  </FoldedList>
</template>

<style scoped>
/* The file's own headings, as small as the sections of the other cards; a heading sits closer to
   what follows it than to what came before. */
h3,
h4 {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
}

h3 + *,
h4 + * {
  margin-top: calc(-1 * var(--space-2));
}

h4 {
  color: var(--ink-2);
}

p,
li {
  color: var(--ink-2);
}

ul {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding-inline-start: var(--space-5);
}
</style>
