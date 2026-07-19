<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { draggedTab, finishTabDrag } from '@/composables/tabDrag';
import { resolvePaneDropPosition } from '@/domain/tabDrag';
import type { PaneDropPosition, SplitDirection } from '@/domain/workspace';
import { t } from '@/i18n/locale';
import { SessionClient } from '@/services/sessionClient';
import { useAppSettingsStore } from '@/stores/appSettingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { TerminalAdapter } from '@/terminal/terminalAdapter';

const props = defineProps<{
  tabId: string;
  paneId: string;
  sessionId: string;
  focused: boolean;
}>();

const emit = defineEmits<{
  split: [paneId: string, direction: SplitDirection];
  close: [paneId: string];
  focus: [paneId: string];
  dropTab: [sourceTabId: string, targetPaneId: string, position: PaneDropPosition];
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
const tabDropPosition = ref<PaneDropPosition | null>(null);
let adapter: TerminalAdapter | null = null;
let unsubscribe: (() => void) | null = null;
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

function cssVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
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

function onTerminalDragOver(event: DragEvent): void {
  if (draggedTab.value?.kind !== 'terminal' || draggedTab.value.id === props.tabId) {
    return;
  }
  event.preventDefault();
  const terminalPane = event.currentTarget as HTMLElement;
  tabDropPosition.value = resolvePaneDropPosition(
    terminalPane.getBoundingClientRect(),
    event.clientX,
    event.clientY,
  );
  if (event.dataTransfer !== null) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function onTerminalDragLeave(event: DragEvent): void {
  const terminalPane = event.currentTarget as HTMLElement;
  const nextTarget = event.relatedTarget;
  if (!(nextTarget instanceof Node) || !terminalPane.contains(nextTarget)) {
    tabDropPosition.value = null;
  }
}

function onTerminalDrop(event: DragEvent): void {
  const sourceTab = draggedTab.value;
  const position = tabDropPosition.value;
  if (sourceTab?.kind !== 'terminal' || sourceTab.id === props.tabId || position === null) {
    return;
  }
  event.preventDefault();
  emit('dropTab', sourceTab.id, props.paneId, position);
  tabDropPosition.value = null;
  finishTabDrag();
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
  const styles = window.getComputedStyle(document.documentElement);
  const terminalBackground = cssVar(styles, '--color-terminal', '#121212');
  const foreground = cssVar(styles, '--color-text', '#eef3f8');
  const muted = cssVar(styles, '--color-text-muted', 'rgb(255 255 255 / 50%)');
  const accent = cssVar(styles, '--color-accent', '#4fadff');
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
        theme: {
          background: terminalBackground,
          foreground,
          cursor: accent,
          cursorAccent: terminalBackground,
          selectionBackground: 'rgba(79, 173, 255, 0.28)',
          black: '#000000',
          red: '#d9534f',
          green: '#5cb85c',
          yellow: '#f0ad4e',
          blue: '#4fadff',
          magenta: '#b68cff',
          cyan: '#5bc0de',
          white: foreground,
          brightBlack: muted,
          brightRed: '#ff6b66',
          brightGreen: '#7bd87b',
          brightYellow: '#ffd166',
          brightBlue: '#78c3ff',
          brightMagenta: '#d0a3ff',
          brightCyan: '#7de3f3',
          brightWhite: '#ffffff',
        },
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
  adapter?.dispose();
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
    :class="[{ focused }, tabDropPosition ? `tab-drop-${tabDropPosition}` : null]"
    :aria-label="`${t('pane.terminal')} ${paneId}`"
    @pointerdown="$emit('focus', paneId)"
    @focusin="$emit('focus', paneId)"
    @dragover="onTerminalDragOver"
    @dragleave="onTerminalDragLeave"
    @drop="onTerminalDrop"
  >
    <div v-if="tabDropPosition" class="tab-drop-overlay" aria-hidden="true" />
    <div class="pane-toolbar">
      <span class="pane-title">{{ t('pane.local') }} · {{ sessionId.slice(0, 8) }}</span>
      <div class="pane-actions">
        <button
          class="icon-button"
          data-testid="split-horizontal"
          type="button"
          :aria-label="t('pane.splitHorizontal')"
          @click="$emit('split', paneId, 'horizontal')"
        >
          ▭
        </button>
        <button
          class="icon-button"
          data-testid="split-vertical"
          type="button"
          :aria-label="t('pane.splitVertical')"
          @click="$emit('split', paneId, 'vertical')"
        >
          ▯
        </button>
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
