<script setup lang="ts">
// Buttons, which look like stickers: an ink outline, a hard shadow, and the press of every sticker
// (`press` in base.css), a lift on hover and a push into its shadow. "primary" is the one main
// action on a screen, "secondary" the others, "quiet" a link-like action without the outline, and
// "danger" an action that can't be undone. "red" and "blue" are the bright buttons of the home
// page. With an `href`, the button is a link that looks like one, such as one that opens another
// page.
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'quiet' | 'danger' | 'red' | 'blue';
    size?: 'normal' | 'small' | 'large';
    type?: 'button' | 'submit';
    disabled?: boolean;
    href?: string;
  }>(),
  { variant: 'secondary', size: 'normal', type: 'button', disabled: false, href: undefined },
);

// A quiet button doesn't move, and an ink one, which has no shadow, moves only when pressed.
const pressed = (variant: string) =>
  variant === 'quiet' ? null : { press: true, 'press-flat': variant === 'primary' };
</script>

<template>
  <a v-if="href" :href="href" :class="['button', variant, size, pressed(variant)]">
    <slot />
  </a>
  <button v-else :type="type" :class="['button', variant, size, pressed(variant)]" :disabled="disabled">
    <slot />
  </button>
</template>

<style scoped>
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 48px;
  padding: 0 var(--space-5);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--paper);
  box-shadow: var(--shadow-1);
  color: var(--ink);
  font-size: var(--text-md);
  font-weight: var(--weight-black);
  line-height: 1.2;
  text-decoration: none;
  cursor: pointer;
  touch-action: manipulation;
}

/* Small buttons take less room sideways, but stay 44 px high to tap (docs/design.md). */
.button.small {
  min-height: 44px;
  padding: 0 var(--space-4);
  border-width: var(--line);
  font-size: var(--text-sm);
}

.button.large {
  min-height: 58px;
  padding: 0 var(--space-6);
  font-size: var(--text-xl);
  letter-spacing: 0.04em;
}

/* Ink is flat, as the tags and badges are: an ink shadow would merge with the button. */
.primary {
  background: var(--ink);
  box-shadow: none;
  color: var(--on-ink);
}

.red {
  background: var(--red);
  color: var(--on-red);
}

.blue {
  background: var(--blue);
  color: var(--on-blue);
}

.quiet {
  min-height: 44px;
  padding: 0 var(--space-2);
  border-color: transparent;
  background: none;
  box-shadow: none;
  font-weight: var(--weight-bold);
  transition: background-color var(--motion);
}

.danger {
  border-color: var(--red-deep);
  color: var(--red-deep);
}

.button:disabled {
  border-color: var(--neutral);
  background: var(--paper-2);
  box-shadow: none;
  color: var(--ink-2);
  cursor: not-allowed;
}

.quiet:disabled {
  border-color: transparent;
  background: none;
}

@media (hover: hover) {
  .quiet:not(:disabled):hover {
    background: var(--paper-2);
  }
}
</style>
