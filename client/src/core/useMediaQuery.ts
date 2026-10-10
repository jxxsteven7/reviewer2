import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

// Whether the window matches a media query, kept up to date, for the few layouts that differ in
// what they render and not only in their CSS. Until the component is mounted it is false.
export function useMediaQuery(query: string): Ref<boolean> {
  const matches = ref(false);
  let list: MediaQueryList | undefined;
  const update = () => {
    matches.value = list?.matches ?? false;
  };
  onMounted(() => {
    if (typeof window.matchMedia !== 'function') return;
    list = window.matchMedia(query);
    update();
    // Older WebKit has only the deprecated addListener.
    if (typeof list.addEventListener === 'function') list.addEventListener('change', update);
    else list.addListener(update);
  });
  onBeforeUnmount(() => {
    if (!list) return;
    if (typeof list.removeEventListener === 'function') list.removeEventListener('change', update);
    else list.removeListener(update);
  });
  return matches;
}
