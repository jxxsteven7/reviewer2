import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

// Whether the page has scrolled down at all, for a bar that stays at the top of the screen to draw
// its shade once there is content passing under it (PageMasthead.vue, the game's clock bar and the
// waiting room's start bar). The listener comes and goes with the component.
export function useScrolled(): Ref<boolean> {
  const scrolled = ref(false);
  const onScroll = () => {
    scrolled.value = window.scrollY > 0;
  };
  onMounted(() => {
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  });
  onBeforeUnmount(() => window.removeEventListener('scroll', onScroll));
  return scrolled;
}
