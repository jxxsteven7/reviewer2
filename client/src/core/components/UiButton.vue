<script setup lang="ts">
// Buttons, which look like stickers: an ink outline, a hard shadow, and the press of every sticker
// (`press` in base.css), a lift on hover and a push into its shadow. The color says what a button
// does (docs/design.md): "primary", a main action, is green; "secondary", the others, white; "danger", an action that can't be undone, white with red; and "quiet" is a
// link-like action without the outline. With an `href`, the button is a link that looks like one,
// such as one that opens another page.
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
    size?: 'normal' | 'small' | 'large';
    type?: 'button' | 'submit';
    disabled?: boolean;
    href?: string;
  }>(),
  { variant: 'secondary', size: 'normal', type: 'button', disabled: false, href: undefined },
);

// A quiet button doesn't move.
const pressed = (variant: string) => (variant === 'quiet' ? null : 'press');
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

.primary {
  background: var(--go);
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
