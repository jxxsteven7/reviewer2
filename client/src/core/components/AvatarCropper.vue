<script setup lang="ts">
import { AVATAR_SIZE } from '@reviewer2/shared';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { encodeAvatar } from '../avatar';
import UiButton from './UiButton.vue';

// Crops a picture that the player chose to a square, in a round frame, as avatars show: drag it
// into place, and zoom with the slider or with two fingers. The cropped square is drawn at
// AVATAR_SIZE pixels and encoded here (avatar.ts), so the server gets a small image of the right
// size, and nothing else that the file held.
const props = defineProps<{ file: File }>();
const emit = defineEmits<{ done: [avatar: Blob]; cancel: []; failed: [code: string] }>();
const { t } = useI18n();

type Source = CanvasImageSource & { width: number; height: number };

const canvas = ref<HTMLCanvasElement | null>(null);
const source = ref<Source | null>(null);
// How far in the picture is zoomed, from 1, where the frame takes the whole of its shorter side,
// and where in the picture the frame's center is, as a share of its width and height.
const zoom = ref(1);
const center = ref({ x: 0.5, y: 0.5 });
const encoding = ref(false);
const MAX_ZOOM = 4;

// Loads the file as a picture: with createImageBitmap where the browser has it, which also turns
// a photo upright, and otherwise through an <img> with a data URL, which the page's Content
// Security Policy allows.
async function load(file: File): Promise<Source> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall back to an <img>, which knows more formats in some browsers.
    }
  }
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('unreadable'));
    image.src = url;
  });
}

// The square of the picture that the frame shows, in its own pixels, kept inside the picture.
const square = computed(() => {
  const picture = source.value;
  if (!picture) return null;
  const side = Math.min(picture.width, picture.height) / zoom.value;
  const x = Math.min(Math.max(center.value.x * picture.width - side / 2, 0), picture.width - side);
  const y = Math.min(Math.max(center.value.y * picture.height - side / 2, 0), picture.height - side);
  return { x, y, side };
});

function draw(target: HTMLCanvasElement, size: number): void {
  const picture = source.value;
  const crop = square.value;
  const context = target.getContext('2d');
  if (!picture || !crop || !context) return;
  target.width = size;
  target.height = size;
  // A picture with transparent parts gets white behind them, as on the page.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  context.imageSmoothingQuality = 'high';
  context.drawImage(picture, crop.x, crop.y, crop.side, crop.side, 0, 0, size, size);
}

function render(): void {
  const target = canvas.value;
  if (!target) return;
  draw(target, Math.round(target.clientWidth * (window.devicePixelRatio || 1)) || AVATAR_SIZE);
}

watch([square, canvas], render);

// Where the frame's center goes when the picture is dragged, or pinched with two fingers.
const pointers = new Map<number, { x: number; y: number }>();
let pinch: { distance: number; zoom: number } | null = null;

function onDown(event: PointerEvent): void {
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
    pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: zoom.value };
  }
}

function onMove(event: PointerEvent): void {
  const last = pointers.get(event.pointerId);
  const picture = source.value;
  const crop = square.value;
  const target = canvas.value;
  if (!last || !picture || !crop || !target) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
    zoom.value = Math.min(MAX_ZOOM, Math.max(1, (pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.distance));
    return;
  }
  // The picture moves with the finger, so the frame moves the other way.
  const perPixel = crop.side / target.clientWidth;
  const x = (crop.x + crop.side / 2 - (event.clientX - last.x) * perPixel) / picture.width;
  const y = (crop.y + crop.side / 2 - (event.clientY - last.y) * perPixel) / picture.height;
  center.value = { x, y };
}

function onUp(event: PointerEvent): void {
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinch = null;
}

// The center as the frame really is, kept inside the picture, so that zooming out after dragging
// to an edge doesn't jump.
watch(zoom, () => {
  const picture = source.value;
  const crop = square.value;
  if (picture && crop) {
    center.value = { x: (crop.x + crop.side / 2) / picture.width, y: (crop.y + crop.side / 2) / picture.height };
  }
});

async function use(): Promise<void> {
  encoding.value = true;
  const output = document.createElement('canvas');
  draw(output, AVATAR_SIZE);
  const blob = await encodeAvatar(output);
  encoding.value = false;
  if (blob) emit('done', blob);
  else emit('failed', 'avatar_unreadable');
}

onMounted(async () => {
  try {
    source.value = await load(props.file);
  } catch {
    emit('failed', 'avatar_unreadable');
  }
});

onBeforeUnmount(() => {
  const picture = source.value;
  if (picture && 'close' in picture && typeof picture.close === 'function') picture.close();
});
</script>

<template>
  <div class="cropper">
    <div class="frame" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp">
      <canvas ref="canvas" class="picture"></canvas>
      <span class="ring" aria-hidden="true"></span>
    </div>
    <label class="zoom">
      <span>{{ t('account.avatar.zoom') }}</span>
      <input v-model.number="zoom" type="range" min="1" :max="MAX_ZOOM" step="0.01" />
    </label>
    <p class="hint">{{ t('account.avatar.cropHint') }}</p>
    <div class="actions">
      <UiButton variant="primary" :disabled="!source || encoding" @click="use">{{ t('account.avatar.use') }}</UiButton>
      <UiButton variant="quiet" @click="emit('cancel')">{{ t('account.cancel') }}</UiButton>
    </div>
  </div>
</template>

<style scoped>
.cropper {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
}

/* The square that is cropped, with the picture dimmed outside the round frame. */
.frame {
  position: relative;
  width: min(100%, 18rem);
  aspect-ratio: 1;
  overflow: hidden;
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper-2);
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.picture {
  display: block;
  width: 100%;
  height: 100%;
}

.ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  box-shadow: 0 0 0 100vmax var(--scrim);
  pointer-events: none;
}

.zoom {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: min(100%, 18rem);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.zoom input {
  flex: 1;
  min-height: 44px;
  accent-color: var(--ink);
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
  text-align: center;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-3);
}
</style>
