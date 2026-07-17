<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

import type { SplitDirection } from '@/domain/workspace';
import { SessionClient } from '@/services/sessionClient';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { TerminalAdapter } from '@/terminal/terminalAdapter';

const props = defineProps<{
  paneId: string;
  sessionId: string;
  focused: boolean;
}>();

defineEmits<{
  split: [direction: SplitDirection];
  close: [];
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
        scrollback: 10_000,
        theme: {
          background: '#0b0f17',
          foreground: '#d8dee9',
          cursor: '#b48cff',
          selectionBackground: '#49536b80',
        },
      }),
    createFitAddon: () => new FitAddon(),
    createResizeObserver: (callback) => new ResizeObserver(callback),
    onError: (error) => {
      terminalError.value = error.message;
    },
  });
  unsubscribe = store.subscribeToSession(props.sessionId, (chunk) => adapter?.acceptChunk(chunk));
  adapter.open(element);
});

onBeforeUnmount(() => {
  disposed = true;
  unsubscribe?.();
  adapter?.dispose();
});
</script>

<template>
  <section class="terminal-pane" :class="{ focused }" :aria-label="`Terminal ${paneId}`">
    <div class="pane-toolbar">
      <span class="pane-title">Local · {{ sessionId.slice(0, 8) }}</span>
      <div class="pane-actions">
        <button
          class="icon-button"
          data-testid="split-horizontal"
          type="button"
          aria-label="Split horizontally"
          @click="$emit('split', 'horizontal')"
        >
          ▭
        </button>
        <button
          class="icon-button"
          data-testid="split-vertical"
          type="button"
          aria-label="Split vertically"
          @click="$emit('split', 'vertical')"
        >
          ▯
        </button>
        <button class="icon-button" type="button" aria-label="Close pane" @click="$emit('close')">
          ×
        </button>
      </div>
    </div>
    <p v-if="terminalError" class="pane-error" role="alert">{{ terminalError }}</p>
    <div ref="terminalElement" class="terminal-surface" />
  </section>
</template>
