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
  adapter = new TerminalAdapter({
    sessionId: props.sessionId,
    initialSequence: store.nextOutputSequence(props.sessionId),
    sessionClient,
    createTerminal: () =>
      new Terminal({
        cursorBlink: true,
        fontFamily: 'JetBrains Mono, SFMono-Regular, Consolas, monospace',
        fontSize: 13,
        scrollback: TABBY_DEFAULT_SCROLLBACK_LINES,
        theme: {
          background: '#181a1a',
          foreground: '#d7d7d3',
          cursor: '#8fd8e8',
          cursorAccent: '#181a1a',
          selectionBackground: '#8fd8e840',
          black: '#202222',
          brightBlack: '#666a67',
          white: '#d7d7d3',
          brightWhite: '#f1f2ee',
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
