<script setup lang="ts">
import type { KeywordsView, Seat } from '@reviewer2/shared';
import { computed, onBeforeUnmount, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { bannerFor } from './banner';

// A strip across the top of the waiting room and the game, in the viewer's group color: who they
// are, and what is going on for them now (banner.ts). It stands out when it is the viewer's move,
// and so does the tab's title, for a player who has gone to another tab while they wait. A line
// that waits for someone ends in an ellipsis, which breathes a little, by CSS alone: the words
// stay as they are. A screen reader is told the words as they change, but not what is in the
// slot: that is the reaction button, whose countdown would otherwise be read out second by second.
const props = withDefaults(defineProps<{ seat: Seat; game: KeywordsView | null; chair?: boolean }>(), {
  chair: false,
});
const { t } = useI18n();

const banner = computed(() => bannerFor(props.seat, props.game, props.chair));
const who = computed(() => {
  const { team, role } = props.seat;
  if (team === null) return t('banner.spectator');
  return t('banner.seat', { group: t(`lobby.group.${team}`), role: t(`banner.roles.${role}`) });
});
const line = computed(() => {
  const { group } = banner.value;
  return t(`banner.lines.${banner.value.line}`, { group: group ? t(`lobby.group.${group}`) : '' });
});
// The line's words, and the ellipsis it ends in while someone is waited for, if any.
const parts = computed(() => {
  const found = /^(.*?)(\u2026+)$/su.exec(line.value);
  return found ? { text: found[1] ?? '', dots: found[2] ?? '' } : { text: line.value, dots: '' };
});

const title = document.title;
watchEffect(() => {
  document.title = banner.value.urgent ? t('banner.tabTitle') : title;
});
onBeforeUnmount(() => {
  document.title = title;
});
</script>

<template>
  <section class="role-banner" :class="[seat.team ?? 'spectator', { urgent: banner.urgent }]">
    <div class="text" aria-live="polite">
      <p class="who">{{ who }}</p>
      <p class="line">
        {{ parts.text }}<span v-if="parts.dots" class="dots">{{ parts.dots }}</span>
      </p>
    </div>
    <slot />
  </section>
</template>

<style scoped>
.role-banner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-2);
  padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--neutral-tint);
  transition:
    background-color var(--motion),
    color var(--motion);
}

.text {
  flex: 1;
  min-width: 0;
}

.who {
  font-size: var(--text-xs);
  font-weight: var(--weight-black);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.line {
  font-weight: var(--weight-bold);
}

.red {
  background: var(--red-tint);
}

.red .who {
  color: var(--red-deep);
}

.blue {
  background: var(--blue-tint);
}

.blue .who {
  color: var(--blue-deep);
}

/* The viewer's move: the group's full color, with the line in the display fonts. */
.urgent.red {
  background: var(--red);
  color: var(--on-red);
}

.urgent.blue {
  background: var(--blue);
  color: var(--on-blue);
}

.urgent .who,
.urgent .line {
  color: inherit;
}

.urgent .line {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--weight-display);
  font-synthesis: none;
}

/* The ellipsis of a line that waits breathes, gently. */
.dots {
  display: inline-block;
  animation: breathe 2s ease-in-out infinite;
}

@keyframes breathe {
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dots {
    animation: none;
  }
}
</style>
