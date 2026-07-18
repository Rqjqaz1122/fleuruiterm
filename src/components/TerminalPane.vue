<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { draggedTab, finishTabDrag } from '@/composables/tabDrag';
import { resolvePaneDropPosition } from '@/domain/tabDrag';
import type { PaneDropPosition, SplitDirection } from '@/domain/workspace';
import { t } from '@/i18n/locale';
import { SessionClient } from '@/services/sessionClient';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { TerminalAdapter } from '@/terminal/terminalAdapter';
import { TABBY_DEFAULT_SCROLLBACK_LINES } from '@/terminal/terminalConfig';

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
const terminalElement = ref<HTMLElement | null>(null);
const terminalError = ref<string | null>(null);
const visibleTerminalError = computed(() =>
  terminalError.value === null ? null : t('error.terminalBridge'),
);
const tabDropPosition = ref<PaneDropPosition | null>(null);
let adapter: TerminalAdapter | null = null;
let unsubscribe: (() => void) | null = null;
let disposed = false;

function cssVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
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
  const monoFont = cssVar(
    styles,
    '--font-mono',
    'Source Code Pro, JetBrains Mono, Consolas, monospace',
  );

  adapter = new TerminalAdapter({
    sessionId: props.sessionId,
    initialSequence: store.nextOutputSequence(props.sessionId),
    sessionClient,
    createTerminal: () =>
      new Terminal({
        cursorBlink: true,
        fontFamily: monoFont,
        fontSize: 13,
        lineHeight: 1.35,
        scrollback: TABBY_DEFAULT_SCROLLBACK_LINES,
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
  unsubscribe = store.subscribeToSession(props.sessionId, (chunk) => adapter?.acceptChunk(chunk));
});

onBeforeUnmount(() => {
  disposed = true;
  unsubscribe?.();
  adapter?.dispose();
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
    <div ref="terminalElement" class="terminal-surface" />
  </section>
</template>
