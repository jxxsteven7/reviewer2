import { cleanName } from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { errorKey } from './errors';

// A nickname as someone types it, checked by the rules that the server applies
// (shared/src/names.ts), so that a form knows before sending whether the name can be used.
export function useNameField(initial = '') {
  const { t } = useI18n();
  const name = ref(initial);
  // The name as it will be shown, or null when what is typed can't be a name.
  const clean = computed(() => cleanName(name.value));
  // What the server had against the name that was sent, until the name is changed.
  const refused = ref<string | undefined>();
  watch(name, () => (refused.value = undefined));
  const refuse = (code: string): void => {
    refused.value = t(errorKey(code));
  };
  // What is wrong with the name, for the field to show: the server's objection, or that what is
  // typed can't be a name, once there is something typed.
  const problem = computed(
    () => refused.value ?? (name.value.trim() && clean.value === null ? t(errorKey('name_invalid')) : undefined),
  );
  return { name, clean, problem, refuse };
}
