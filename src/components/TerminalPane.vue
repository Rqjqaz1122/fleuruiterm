<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { t } from '@/i18n/locale';
import { SessionClient } from '@/services/sessionClient';
import { terminalEditingActions } from '@/services/terminalEditingActions';
import { useAppSettingsStore } from '@/stores/appSettingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { TerminalAdapter } from '@/terminal/terminalAdapter';
import {
  createTerminalTheme,
  TERMINAL_THEME_CHANGED_EVENT,
  type TerminalThemeTone,
} from '@/terminal/terminalTheme';

const props = defineProps<{
  tabId: string;
  paneId: string;
  sessionId: string;
  focused: boolean;
}>();

defineEmits<{
  close: [paneId: string];
  focus: [paneId: string];
}>();

const store = useWorkspaceStore();
const appSettings = useAppSettingsStore();
const { terminalSettings } = appSettings;
const terminalElement = ref<HTMLElement | null>(null);
const scrollbarTrackElement = ref<HTMLElement | null>(null);
const terminalScrollbarVisible = ref(false);
const terminalScrollbarThumbStyle = ref<Record<string, string>>({
  height: '0px',
  transform: 'translateY(0px)',
});
const terminalError = ref<string | null>(null);
const visibleTerminalError = computed(() =>
  terminalError.value === null ? null : t('error.terminalBridge'),
);
let adapter: TerminalAdapter | null = null;
let unsubscribe: (() => void) | null = null;
let unregisterEditingActions: (() => void) | null = null;
let disposed = false;
let terminalViewport: HTMLElement | null = null;
let scrollbarUpdateFrame: number | null = null;
let scrollbarResizeObserver: ResizeObserver | null = null;
let scrollbarDragState: {
  startY: number;
  startScrollTop: number;
  maxScroll: number;
  maxThumbTravel: number;
} | null = null;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function currentTerminalTheme() {
  const styles = window.getComputedStyle(document.documentElement);
  const tone: TerminalThemeTone =
    document.documentElement.dataset.themeTone === 'light' ? 'light' : 'dark';
  return createTerminalTheme(styles, tone);
}

function updateOpenTerminalTheme(): void {
  adapter?.updateTheme(currentTerminalTheme());
}

function handleViewportScroll(): void {
  scheduleTerminalScrollbarUpdate();
}

function bindTerminalViewport(): HTMLElement | null {
  const nextViewport = terminalElement.value?.querySelector<HTMLElement>('.xterm-viewport') ?? null;
  if (terminalViewport === nextViewport) {
    return terminalViewport;
  }
  terminalViewport?.removeEventListener('scroll', handleViewportScroll);
  terminalViewport = nextViewport;
  terminalViewport?.addEventListener('scroll', handleViewportScroll, { passive: true });
  return terminalViewport;
}

function scheduleTerminalScrollbarUpdate(): void {
  if (scrollbarUpdateFrame !== null) {
    return;
  }
  scrollbarUpdateFrame = window.requestAnimationFrame(() => {
    scrollbarUpdateFrame = null;
    updateTerminalScrollbar();
  });
}

function updateTerminalScrollbar(): void {
  const viewport = bindTerminalViewport();
  const track = scrollbarTrackElement.value;
  if (viewport === null || track === null) {
    terminalScrollbarVisible.value = false;
    return;
  }

  const maxScroll = viewport.scrollHeight - viewport.clientHeight;
  if (maxScroll <= 1) {
    terminalScrollbarVisible.value = false;
    return;
  }

  const trackHeight = track.clientHeight;
  const thumbHeight = Math.max(
    34,
    Math.round((viewport.clientHeight / viewport.scrollHeight) * trackHeight),
  );
  const maxThumbTravel = Math.max(0, trackHeight - thumbHeight);
  const thumbTop =
    maxScroll <= 0 ? 0 : Math.round((viewport.scrollTop / maxScroll) * maxThumbTravel);

  terminalScrollbarVisible.value = true;
  terminalScrollbarThumbStyle.value = {
    height: `${thumbHeight}px`,
    transform: `translateY(${thumbTop}px)`,
  };
}

function onTerminalScrollbarTrackPointerDown(event: PointerEvent): void {
  if (event.target !== event.currentTarget) {
    return;
  }
  const viewport = bindTerminalViewport();
  const track = scrollbarTrackElement.value;
  if (viewport === null || track === null) {
    return;
  }
  const maxScroll = viewport.scrollHeight - viewport.clientHeight;
  if (maxScroll <= 1) {
    return;
  }
  const trackRect = track.getBoundingClientRect();
  const thumbHeight = Number.parseFloat(terminalScrollbarThumbStyle.value.height) || 34;
  const maxThumbTravel = Math.max(1, track.clientHeight - thumbHeight);
  const nextThumbTop = clamp(event.clientY - trackRect.top - thumbHeight / 2, 0, maxThumbTravel);
  viewport.scrollTop = (nextThumbTop / maxThumbTravel) * maxScroll;
  scheduleTerminalScrollbarUpdate();
}

function onTerminalScrollbarThumbPointerDown(event: PointerEvent): void {
  event.preventDefault();
  event.stopPropagation();
  const viewport = bindTerminalViewport();
  const track = scrollbarTrackElement.value;
  if (viewport === null || track === null) {
    return;
  }
  const maxScroll = viewport.scrollHeight - viewport.clientHeight;
  const thumbHeight = Number.parseFloat(terminalScrollbarThumbStyle.value.height) || 34;
  scrollbarDragState = {
    startY: event.clientY,
    startScrollTop: viewport.scrollTop,
    maxScroll,
    maxThumbTravel: Math.max(1, track.clientHeight - thumbHeight),
  };
  window.addEventListener('pointermove', handleTerminalScrollbarDrag);
  window.addEventListener('pointerup', stopTerminalScrollbarDrag);
}

function handleTerminalScrollbarDrag(event: PointerEvent): void {
  const viewport = bindTerminalViewport();
  if (viewport === null || scrollbarDragState === null) {
    return;
  }
  const deltaY = event.clientY - scrollbarDragState.startY;
  viewport.scrollTop =
    scrollbarDragState.startScrollTop +
    (deltaY / scrollbarDragState.maxThumbTravel) * scrollbarDragState.maxScroll;
  scheduleTerminalScrollbarUpdate();
}

function stopTerminalScrollbarDrag(): void {
  scrollbarDragState = null;
  window.removeEventListener('pointermove', handleTerminalScrollbarDrag);
  window.removeEventListener('pointerup', stopTerminalScrollbarDrag);
}

onMounted(async () => {
  const element = terminalElement.value;
  if (element === null) {
    return;
  }
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
  ]);
  if (disposed) {
    return;
  }
  const sessionClient = new SessionClient();
  const monoFont = terminalSettings.value.fontFamily;

  adapter = new TerminalAdapter({
    sessionId: props.sessionId,
    initialSequence: store.nextOutputSequence(props.sessionId),
    sessionClient,
    scrollOnInput: terminalSettings.value.scrollOnInput,
    createTerminal: () =>
      new Terminal({
        cursorBlink: terminalSettings.value.cursorBlink,
        fontFamily: monoFont,
        fontSize: terminalSettings.value.fontSize,
        lineHeight: terminalSettings.value.lineHeight,
        scrollback: terminalSettings.value.scrollback,
        theme: currentTerminalTheme(),
      }),
    createFitAddon: () => new FitAddon(),
    createResizeObserver: (callback) => new ResizeObserver(callback),
    frameScheduler: {
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
    },
    onError: (error) => {
      terminalError.value = error.message;
    },
  });
  adapter.open(element);
  unregisterEditingActions = terminalEditingActions.register(props.paneId, {
    getSelection: () => adapter?.getSelection() ?? '',
    paste: (text) => adapter?.paste(text),
    selectAll: () => adapter?.selectAll(),
  });
  window.addEventListener(TERMINAL_THEME_CHANGED_EVENT, updateOpenTerminalTheme);
  scrollbarResizeObserver = new ResizeObserver(scheduleTerminalScrollbarUpdate);
  scrollbarResizeObserver.observe(element);
  scheduleTerminalScrollbarUpdate();
  window.requestAnimationFrame(scheduleTerminalScrollbarUpdate);
  unsubscribe = store.subscribeToSession(props.sessionId, async (chunk) => {
    await adapter?.acceptChunk(chunk);
    scheduleTerminalScrollbarUpdate();
  });
});

onBeforeUnmount(() => {
  disposed = true;
  unsubscribe?.();
  unregisterEditingActions?.();
  unregisterEditingActions = null;
  adapter?.dispose();
  window.removeEventListener(TERMINAL_THEME_CHANGED_EVENT, updateOpenTerminalTheme);
  terminalViewport?.removeEventListener('scroll', handleViewportScroll);
  terminalViewport = null;
  scrollbarResizeObserver?.disconnect();
  if (scrollbarUpdateFrame !== null) {
    window.cancelAnimationFrame(scrollbarUpdateFrame);
    scrollbarUpdateFrame = null;
  }
  stopTerminalScrollbarDrag();
});
</script>

<template>
  <section
    class="terminal-pane"
    :class="{ focused }"
    :aria-label="`${t('pane.terminal')} ${paneId}`"
    @pointerdown="$emit('focus', paneId)"
    @focusin="$emit('focus', paneId)"
  >
    <div class="pane-toolbar">
      <span class="pane-title">{{ t('pane.local') }} · {{ sessionId.slice(0, 8) }}</span>
      <div class="pane-actions">
        <button
          class="icon-button"
          type="button"
          :aria-label="t('pane.close')"
          @click="$emit('close', paneId)"
        >
          ×
        </button>
      </div>
    </div>
    <p v-if="visibleTerminalError" class="pane-error" role="alert">
      {{ visibleTerminalError }}
    </p>
    <div class="terminal-surface-frame">
      <div ref="terminalElement" class="terminal-surface" />
      <div
        ref="scrollbarTrackElement"
        class="terminal-scrollbar"
        :class="{ 'is-visible': terminalScrollbarVisible }"
        aria-hidden="true"
        @pointerdown="onTerminalScrollbarTrackPointerDown"
      >
        <div
          class="terminal-scrollbar-thumb"
          :style="terminalScrollbarThumbStyle"
          @pointerdown="onTerminalScrollbarThumbPointerDown"
        />
      </div>
    </div>
  </section>
</template>
