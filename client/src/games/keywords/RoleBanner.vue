<script setup lang="ts">
import type { KeywordsView, Seat } from '@reviewer2/shared';
import { computed, onBeforeUnmount, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { bannerFor } from './banner';

// A strip across the top of the waiting room and the game, in the viewer's group color: who they
// are, and what is going on for them now (banner.ts). It stands out when it is the viewer's move,
// and so does the tab's title, for a player who has gone to another tab while they wait. A screen
// reader is told the words as they change, but not what is in the slot: that is the reaction
// button, whose countdown would otherwise be read out second by second.
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
      <p class="line">{{ line }}</p>
    </div>
    <slot />
  </section>
</template>

<style scoped>
.role-banner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-4);
  padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
  border-left: 4px solid var(--ink-3);
  background: var(--paper-2);
}

.text {
  flex: 1;
  min-width: 0;
}

.who {
  font-weight: 600;
  font-variant-caps: all-small-caps;
  letter-spacing: 0.06em;
}

.line {
  color: var(--ink-2);
}

.red {
  border-left-color: var(--red);
  background: var(--red-tint);
}

.red .who {
  color: var(--red);
}

.blue {
  border-left-color: var(--blue);
  background: var(--blue-tint);
}

.blue .who {
  color: var(--blue);
}

/* The viewer's move: the group's full color, with the line in bold. */
.urgent.red {
  background: var(--red);
}

.urgent.blue {
  background: var(--blue);
}

.urgent .who,
.urgent .line {
  color: var(--paper);
}

.urgent .line {
  font-size: var(--text-lg);
  font-weight: 600;
}
</style>
