<script setup lang="ts">
import { formatCode } from '@reviewer2/shared';
import { computed, nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { roomLink } from '../room';
import { toast } from '../toast';
import QrCode from './QrCode.vue';
import UiButton from './UiButton.vue';
import UiSheet from './UiSheet.vue';

// Ways to bring people into a room: the share sheet where there is one (it needs HTTPS), the
// clipboard, and a QR code. When neither the share sheet nor the clipboard works, as in some
// in-app browsers and on plain http, the link is shown selected, ready to copy by hand.
const props = defineProps<{ code: string }>();
const { t } = useI18n();

const link = computed(() => roomLink(props.code));
const screenLink = computed(() => `/room/${props.code}/screen`);
const number = computed(() => formatCode(props.code));
const canShare = typeof navigator.share === 'function';
const showQr = ref(false);
const showLink = ref(false);
const linkInput = ref<HTMLInputElement | null>(null);

async function share() {
  try {
    await navigator.share({ title: t('room.shareTitle'), url: link.value });
  } catch (error) {
    if ((error as DOMException).name !== 'AbortError') await copy();
  }
}

async function copy() {
  try {
    await navigator.clipboard.writeText(link.value);
    toast('room.copied');
  } catch {
    showLink.value = true;
    await nextTick();
    linkInput.value?.select();
  }
}
</script>

<template>
  <div class="share">
    <UiButton v-if="canShare" size="small" @click="share">{{ t('room.share') }}</UiButton>
    <UiButton v-else size="small" @click="copy">{{ t('room.copyLink') }}</UiButton>
    <UiButton size="small" @click="showQr = true">{{ t('room.qr') }}</UiButton>
    <a class="screen" :href="screenLink" target="_blank" rel="noopener">{{ t('room.screen') }}</a>

    <UiSheet :open="showQr" :title="t('room.qr')" @close="showQr = false">
      <div class="qr">
        <QrCode :text="link" :label="t('room.qrHint', { code: number })" />
        <p class="hint">{{ t('room.qrHint', { code: number }) }}</p>
        <p class="link">{{ link }}</p>
        <p class="hint">{{ t('room.screenHint') }}</p>
      </div>
    </UiSheet>

    <UiSheet :open="showLink" :title="t('room.copyLink')" @close="showLink = false">
      <p class="hint">{{ t('room.selectLink') }}</p>
      <input ref="linkInput" class="manual" :value="link" readonly @focus="linkInput?.select()" />
    </UiSheet>
  </div>
</template>

<style scoped>
.share {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.screen {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 var(--space-2);
  font-size: var(--text-sm);
}

.qr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  text-align: center;
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.link {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  word-break: break-all;
}

.manual {
  width: 100%;
  min-height: 48px;
  margin-top: var(--space-3);
  padding: 0 var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-control);
  font: inherit;
  font-size: 16px;
}
</style>
