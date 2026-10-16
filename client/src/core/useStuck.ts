import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';

// Whether a bar that stays at the top of the screen (`position: sticky`) is stuck there now, with
// content passing under it, for the bar to draw its shade (the game's clock bar, the waiting room's
// start bar): the page has scrolled, and the bar sits at the top it sticks to, rather than lower
// down where the page put it. The masthead, which sticks at the very top, draws its shade on the
// scroll alone (useScrolled.ts). Measured on every scroll, as the shade follows the scroll anyway.
export function useStuck(bar: Ref<HTMLElement | null>): Ref<boolean> {
  const stuck = ref(false);
  const measure = () => {
    const element = bar.value;
    if (!element) {
      stuck.value = false;
      return;
    }
    const top = parseFloat(getComputedStyle(element).top) || 0;
    stuck.value = window.scrollY > 0 && element.getBoundingClientRect().top <= top + 1;
  };
  onMounted(() => {
    measure();
    window.addEventListener('scroll', measure, { passive: true });
  });
  onBeforeUnmount(() => window.removeEventListener('scroll', measure));
  watch(bar, measure);
  return stuck;
}
