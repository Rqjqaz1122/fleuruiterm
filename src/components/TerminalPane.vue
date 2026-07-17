<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

import type { SplitDirection } from '@/domain/workspace';
import { SessionClient } from '@/services/sessionClient';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { TerminalAdapter } from '@/terminal/terminalAdapter';
import { TABBY_DEFAULT_SCROLLBACK_LINES } from '@/terminal/terminalConfig';

const props = defineProps<{
  paneId: string;
  sessionId: string;
  focused: boolean;
}>();

defineEmits<{
  split: [paneId: string, direction: SplitDirection];
  close: [paneId: string];
  focus: [paneId: string];
}>();

const store = useWorkspaceStore();
const terminalElement = ref<HTMLElement | null>(null);
const terminalError = ref<string | null>(null);
let adapter: TerminalAdapter | null = null;
let unsubscribe: (() => void) | null = null;
let disposed = false;

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
    :class="{ focused }"
    :aria-label="`Terminal ${paneId}`"
    @pointerdown="$emit('focus', paneId)"
    @focusin="$emit('focus', paneId)"
  >
    <div class="pane-toolbar">
      <span class="pane-title">Local · {{ sessionId.slice(0, 8) }}</span>
      <div class="pane-actions">
        <button
          class="icon-button"
          data-testid="split-horizontal"
          type="button"
          aria-label="Split horizontally"
          @click="$emit('split', paneId, 'horizontal')"
        >
          ▭
        </button>
        <button
          class="icon-button"
          data-testid="split-vertical"
          type="button"
          aria-label="Split vertically"
          @click="$emit('split', paneId, 'vertical')"
        >
          ▯
        </button>
        <button
          class="icon-button"
          type="button"
          aria-label="Close pane"
          @click="$emit('close', paneId)"
        >
          ×
        </button>
      </div>
    </div>
    <p v-if="terminalError" class="pane-error" role="alert">{{ terminalError }}</p>
    <div ref="terminalElement" class="terminal-surface" />
  </section>
</template>
