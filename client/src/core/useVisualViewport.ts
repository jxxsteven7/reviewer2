import { onBeforeUnmount, ref, watch, type Ref } from 'vue';

// The part of the page that the screen shows, while `active`: where it starts and how tall it is,
// in CSS pixels, as the browser's visual viewport says. A phone's keyboard takes the bottom of the
// screen without making the page any shorter, so whatever must stay above the keyboard, as the line
// a player writes in a sheet, takes its height from this. Null while not active, and in a browser
// without a visual viewport, where the page itself gets shorter instead.
export function useVisualViewport(active: Ref<boolean>): Ref<{ top: number; height: number } | null> {
  const box = ref<{ top: number; height: number } | null>(null);
  let watched: VisualViewport | null = null;

  function update() {
    box.value = watched ? { top: watched.offsetTop, height: watched.height } : null;
  }

  function stop() {
    watched?.removeEventListener('resize', update);
    watched?.removeEventListener('scroll', update);
    watched = null;
    box.value = null;
  }

  watch(
    active,
    (on) => {
      stop();
      if (!on || typeof window === 'undefined' || !window.visualViewport) return;
      watched = window.visualViewport;
      watched.addEventListener('resize', update);
      watched.addEventListener('scroll', update);
      update();
    },
    { immediate: true },
  );
  onBeforeUnmount(stop);
  return box;
}
