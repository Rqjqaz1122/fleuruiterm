<script setup lang="ts">
import { SETTINGS_TAB_ID, type AppTab } from '@/domain/appTab';

const props = defineProps<{
  tabs: AppTab[];
  activeTabId: string | null;
}>();

const emit = defineEmits<{
  activate: [tabId: string];
  close: [tabId: string];
  newTerminal: [];
  openSettings: [];
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
  document.getElementById(`app-tab-${targetTab.id}`)?.focus();
}
</script>

<template>
  <nav class="terminal-tabs" aria-label="Open tabs" data-tauri-drag-region>
    <span class="window-control-space" aria-hidden="true" data-tauri-drag-region />
    <div class="tab-list" role="tablist">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-item"
        :class="{ active: tab.id === activeTabId }"
        :data-tab-id="tab.id"
      >
        <button
          :id="`app-tab-${tab.id}`"
          class="tab-button"
          role="tab"
          type="button"
          :tabindex="tab.id === activeTabId ? 0 : -1"
          :aria-selected="tab.id === activeTabId"
          :aria-controls="tab.panelId"
          @click="$emit('activate', tab.id)"
          @keydown="handleTabKey($event, tab.id)"
        >
          <span v-if="tab.kind === 'terminal'" class="status-dot" aria-hidden="true" />
          <span v-else class="settings-tab-icon" aria-hidden="true">⚙</span>
          <span class="tab-label">{{ tab.title }}</span>
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
    <span class="tabbar-drag-region" aria-hidden="true" data-tauri-drag-region />
    <button
      class="icon-button tabbar-settings"
      :class="{ active: activeTabId === SETTINGS_TAB_ID }"
      data-testid="tabbar-settings"
      type="button"
      aria-label="Open settings"
      :aria-pressed="activeTabId === SETTINGS_TAB_ID"
      @click="$emit('openSettings')"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path
          d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.1 4.9-1.6 1.2c-.2.6-.4 1.1-.7 1.6l.3 2a1 1 0 0 1-.5 1l-1.8 1a1 1 0 0 1-1.1-.1l-1.6-1.2a9 9 0 0 1-1.8 0l-1.6 1.2a1 1 0 0 1-1.1.1l-1.8-1a1 1 0 0 1-.5-1l.3-2a8 8 0 0 1-.8-1.6l-1.5-1.2a1 1 0 0 1-.4-1.1v-2a1 1 0 0 1 .4-1l1.5-1.3c.2-.6.5-1.1.8-1.6l-.3-2a1 1 0 0 1 .5-1l1.8-1a1 1 0 0 1 1.1.1l1.6 1.2a9 9 0 0 1 1.8 0l1.6-1.2a1 1 0 0 1 1.1-.1l1.8 1a1 1 0 0 1 .5 1l-.3 2c.3.5.5 1 .7 1.6l1.6 1.2a1 1 0 0 1 .4 1v2a1 1 0 0 1-.4 1.1Z"
        />
      </svg>
    </button>
  </nav>
</template>
