<script setup lang="ts">
// Buttons. "primary" is the one main action on a screen, "secondary" the others, and "quiet" a
// link-like action. "danger" is for actions that can't be undone.
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
    size?: 'normal' | 'small';
    type?: 'button' | 'submit';
    disabled?: boolean;
  }>(),
  { variant: 'secondary', size: 'normal', type: 'button', disabled: false },
);
</script>

<template>
  <button :type="type" :class="['button', variant, size]" :disabled="disabled">
    <slot />
  </button>
</template>

<style scoped>
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: 0 var(--space-4);
  border: 1px solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--paper);
  color: var(--ink);
  font-size: var(--text-md);
  font-weight: 500;
  line-height: 1.2;
  cursor: pointer;
  touch-action: manipulation;
}

/* Small and quiet buttons take less room sideways, but stay 44 px high to tap (docs/design.md). */
.button.small {
  padding: 0 var(--space-3);
  font-size: var(--text-sm);
}

.primary {
  background: var(--ink);
  color: var(--paper);
}

.quiet {
  padding: 0 var(--space-1);
  border-color: transparent;
  background: none;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.2em;
}

.danger {
  border-color: var(--red);
  color: var(--red);
}

.button:disabled {
  border-color: var(--rule);
  background: var(--paper-2);
  color: var(--ink-3);
  cursor: not-allowed;
}

.quiet:disabled {
  border-color: transparent;
  background: none;
}

@media (hover: hover) {
  .secondary:not(:disabled):hover,
  .danger:not(:disabled):hover {
    background: var(--paper-2);
  }
}
</style>
