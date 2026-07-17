<script setup lang="ts">
import { ref } from 'vue';

import { beginTabDrag, draggedTab, finishTabDrag } from '@/composables/tabDrag';
import { SETTINGS_TAB_ID, type AppTab } from '@/domain/appTab';
import type { TabDropPlacement } from '@/domain/workspace';
import { t } from '@/i18n/locale';

const props = defineProps<{
  tabs: AppTab[];
  activeTabId: string | null;
}>();

const emit = defineEmits<{
  activate: [tabId: string];
  close: [tabId: string];
  newTerminal: [];
  openSettings: [];
  reorder: [sourceTabId: string, targetTabId: string, placement: TabDropPlacement];
  dragHover: [tabId: string];
}>();

const dropTargetTabId = ref<string | null>(null);
const dropPlacement = ref<TabDropPlacement | null>(null);

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

function onTabDragStart(event: DragEvent, tab: AppTab): void {
  beginTabDrag(tab);
  if (event.dataTransfer !== null) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', tab.id);
  }
}

function onTabDragOver(event: DragEvent, targetTabId: string): void {
  if (draggedTab.value === null || draggedTab.value.id === targetTabId) {
    return;
  }
  event.preventDefault();
  const targetElement = event.currentTarget as HTMLElement;
  const rectangle = targetElement.getBoundingClientRect();
  dropTargetTabId.value = targetTabId;
  dropPlacement.value = event.clientX <= rectangle.left + rectangle.width / 2 ? 'before' : 'after';
  if (event.dataTransfer !== null) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function onTabDrop(event: DragEvent, targetTabId: string): void {
  const sourceTab = draggedTab.value;
  const placement = dropPlacement.value;
  if (sourceTab === null || sourceTab.id === targetTabId || placement === null) {
    clearTabDropIndicators();
    return;
  }
  event.preventDefault();
  emit('reorder', sourceTab.id, targetTabId, placement);
  clearTabDropIndicators();
}

function onTabDragEnter(targetTab: AppTab): void {
  const sourceTab = draggedTab.value;
  if (
    sourceTab?.kind === 'terminal' &&
    targetTab.kind === 'terminal' &&
    sourceTab.id !== targetTab.id
  ) {
    emit('dragHover', targetTab.id);
  }
}

function onTabDragLeave(event: DragEvent): void {
  const tabItem = event.currentTarget as HTMLElement;
  const nextTarget = event.relatedTarget;
  if (!(nextTarget instanceof Node) || !tabItem.contains(nextTarget)) {
    clearTabDropIndicators();
  }
}

function onTabDragEnd(): void {
  clearTabDropIndicators();
  finishTabDrag();
}

function clearTabDropIndicators(): void {
  dropTargetTabId.value = null;
  dropPlacement.value = null;
}
</script>

<template>
  <nav class="terminal-tabs" :aria-label="t('tabs.openTabs')" data-tauri-drag-region>
    <span class="window-control-space" aria-hidden="true" data-tauri-drag-region />
    <TransitionGroup name="tab-shift" tag="div" class="tab-list" role="tablist">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-item"
        :class="{
          active: tab.id === activeTabId,
          dragging: draggedTab?.id === tab.id,
          'drop-before': dropTargetTabId === tab.id && dropPlacement === 'before',
          'drop-after': dropTargetTabId === tab.id && dropPlacement === 'after',
        }"
        :data-tab-id="tab.id"
        draggable="true"
        @dragstart="onTabDragStart($event, tab)"
        @dragover="onTabDragOver($event, tab.id)"
        @dragenter="onTabDragEnter(tab)"
        @dragleave="onTabDragLeave"
        @drop="onTabDrop($event, tab.id)"
        @dragend="onTabDragEnd"
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
          :aria-label="`${t('tabs.close')} ${tab.title}`"
          @click.stop="$emit('close', tab.id)"
        >
          ×
        </button>
      </div>
    </TransitionGroup>
    <button
      class="icon-button add-tab"
      type="button"
      :aria-label="t('tabs.newTerminal')"
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
      :aria-label="t('tabs.openSettings')"
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
