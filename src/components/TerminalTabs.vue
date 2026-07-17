<script setup lang="ts">
import type { TerminalTab } from '@/domain/workspace';

const props = defineProps<{
  tabs: TerminalTab[];
  activeTabId: string | null;
}>();

const emit = defineEmits<{
  activate: [tabId: string];
  close: [tabId: string];
  newTerminal: [];
}>();

function handleTabKey(event: KeyboardEvent, tabId: string): void {
  const currentIndex = props.tabs.findIndex((tab) => tab.id === tabId);
  if (currentIndex < 0 || props.tabs.length === 0) {
    return;
  }
  let targetIndex: number;
  switch (event.key) {
    case 'ArrowLeft':
      targetIndex = (currentIndex - 1 + props.tabs.length) % props.tabs.length;
      break;
    case 'ArrowRight':
      targetIndex = (currentIndex + 1) % props.tabs.length;
      break;
    case 'Home':
      targetIndex = 0;
      break;
    case 'End':
      targetIndex = props.tabs.length - 1;
      break;
    default:
      return;
  }
  const targetTab = props.tabs[targetIndex];
  if (targetTab === undefined) {
    return;
  }
  event.preventDefault();
  emit('activate', targetTab.id);
  document.getElementById(`terminal-tab-${targetTab.id}`)?.focus();
}
</script>

<template>
  <nav class="terminal-tabs" aria-label="Open terminals">
    <div class="tab-list" role="tablist">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-item"
        :class="{ active: tab.id === activeTabId }"
      >
        <button
          :id="`terminal-tab-${tab.id}`"
          class="tab-button"
          role="tab"
          type="button"
          :tabindex="tab.id === activeTabId ? 0 : -1"
          :aria-selected="tab.id === activeTabId"
          :aria-controls="`terminal-panel-${tab.id}`"
          @click="$emit('activate', tab.id)"
          @keydown="handleTabKey($event, tab.id)"
        >
          <span class="status-dot" aria-hidden="true" />
          {{ tab.title }}
        </button>
        <button
          class="icon-button tab-close"
          type="button"
          :aria-label="`Close ${tab.title}`"
          @click.stop="$emit('close', tab.id)"
        >
          ×
        </button>
      </div>
    </div>
    <button
      class="icon-button add-tab"
      type="button"
      aria-label="New terminal"
      @click="$emit('newTerminal')"
    >
      ＋
    </button>
  </nav>
</template>
