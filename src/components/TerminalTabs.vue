<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window';
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
  openRecent: [];
  openSettings: [];
  reorder: [sourceTabId: string, targetTabId: string, placement: TabDropPlacement];
  dragHover: [tabId: string];
}>();

const dropTargetTabId = ref<string | null>(null);
const dropPlacement = ref<TabDropPlacement | null>(null);
const tabBarElement = ref<HTMLElement | null>(null);
const activePointerDrag = ref<{
  tab: AppTab;
  pointerId: number;
  startX: number;
  started: boolean;
} | null>(null);
const suppressedClickTabId = ref<string | null>(null);

const POINTER_DRAG_THRESHOLD_PX = 4;

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
    event.dataTransfer.setData('application/x-fleurterm-tab', tab.id);
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

function onTabPointerDown(event: PointerEvent, tab: AppTab): void {
  if (event.button !== 0 || closestElement(event.target, '.tab-close') !== null) {
    return;
  }
  activePointerDrag.value = {
    tab,
    pointerId: event.pointerId,
    startX: event.clientX,
    started: false,
  };
  const currentTarget = event.currentTarget as HTMLElement;
  if (typeof currentTarget.setPointerCapture === 'function') {
    currentTarget.setPointerCapture(event.pointerId);
  }
}

function onTabPointerMove(event: PointerEvent): void {
  const pointerDrag = activePointerDrag.value;
  if (pointerDrag === null || pointerDrag.pointerId !== event.pointerId) {
    return;
  }
  if (!pointerDrag.started) {
    if (Math.abs(event.clientX - pointerDrag.startX) < POINTER_DRAG_THRESHOLD_PX) {
      return;
    }
    pointerDrag.started = true;
    suppressedClickTabId.value = pointerDrag.tab.id;
    beginTabDrag(pointerDrag.tab);
  }

  event.preventDefault();
  updatePointerDropTarget(event.clientX, pointerDrag.tab);
}

function onTabPointerUp(event: PointerEvent): void {
  const pointerDrag = activePointerDrag.value;
  if (pointerDrag === null || pointerDrag.pointerId !== event.pointerId) {
    return;
  }
  if (pointerDrag.started) {
    event.preventDefault();
    const targetTabId = dropTargetTabId.value;
    const placement = dropPlacement.value;
    if (targetTabId !== null && targetTabId !== pointerDrag.tab.id && placement !== null) {
      emit('reorder', pointerDrag.tab.id, targetTabId, placement);
    }
    window.setTimeout(() => {
      if (suppressedClickTabId.value === pointerDrag.tab.id) {
        suppressedClickTabId.value = null;
      }
    });
  } else {
    event.preventDefault();
    suppressedClickTabId.value = pointerDrag.tab.id;
    emit('activate', pointerDrag.tab.id);
    document.getElementById(`app-tab-${pointerDrag.tab.id}`)?.focus();
    window.setTimeout(() => {
      if (suppressedClickTabId.value === pointerDrag.tab.id) {
        suppressedClickTabId.value = null;
      }
    });
  }
  activePointerDrag.value = null;
  clearTabDropIndicators();
  finishTabDrag();
}

function onTabPointerCancel(event: PointerEvent): void {
  const pointerDrag = activePointerDrag.value;
  if (pointerDrag === null || pointerDrag.pointerId !== event.pointerId) {
    return;
  }
  activePointerDrag.value = null;
  suppressedClickTabId.value = null;
  clearTabDropIndicators();
  finishTabDrag();
}

function onTabClick(event: MouseEvent, tabId: string): void {
  if (suppressedClickTabId.value === tabId) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  emit('activate', tabId);
}

async function onTabBarPointerDown(event: PointerEvent): Promise<void> {
  if (event.button !== 0 || isInteractiveWindowChromeTarget(event.target)) {
    return;
  }
  await getCurrentWindow().startDragging();
}

async function onTabBarDoubleClick(event: MouseEvent): Promise<void> {
  if (event.button !== 0 || isInteractiveWindowChromeTarget(event.target)) {
    return;
  }
  await toggleMaximizeWindow();
}

async function minimizeWindow(): Promise<void> {
  await getCurrentWindow().minimize();
}

async function toggleMaximizeWindow(): Promise<void> {
  await getCurrentWindow().toggleMaximize();
}

async function closeWindow(): Promise<void> {
  await getCurrentWindow().close();
}

function clearTabDropIndicators(): void {
  dropTargetTabId.value = null;
  dropPlacement.value = null;
}

function updatePointerDropTarget(clientX: number, sourceTab: AppTab): void {
  const tabItems = Array.from(
    tabBarElement.value?.querySelectorAll<HTMLElement>('.tab-item[data-tab-id]') ?? [],
  );
  const candidate =
    tabItems.find((element) => {
      const rectangle = element.getBoundingClientRect();
      return clientX >= rectangle.left && clientX <= rectangle.right;
    }) ?? resolveNearestEdgeTab(tabItems, clientX);
  const targetTabId = candidate?.dataset.tabId ?? null;
  if (targetTabId === null || targetTabId === sourceTab.id) {
    clearTabDropIndicators();
    return;
  }

  const rectangle = candidate.getBoundingClientRect();
  const targetTab = props.tabs.find((tab) => tab.id === targetTabId);
  dropTargetTabId.value = targetTabId;
  dropPlacement.value = clientX <= rectangle.left + rectangle.width / 2 ? 'before' : 'after';
  if (sourceTab.kind === 'terminal' && targetTab?.kind === 'terminal') {
    emit('dragHover', targetTab.id);
  }
}

function resolveNearestEdgeTab(tabItems: HTMLElement[], clientX: number): HTMLElement | null {
  const firstTab = tabItems[0];
  const lastTab = tabItems[tabItems.length - 1];
  if (firstTab === undefined || lastTab === undefined) {
    return null;
  }
  if (clientX < firstTab.getBoundingClientRect().left) {
    return firstTab;
  }
  if (clientX > lastTab.getBoundingClientRect().right) {
    return lastTab;
  }
  return null;
}

function closestElement(target: EventTarget | null, selector: string): Element | null {
  return target instanceof Element ? target.closest(selector) : null;
}

function isInteractiveWindowChromeTarget(target: EventTarget | null): boolean {
  return (
    closestElement(
      target,
      '.tab-item, .tabbar-command, .window-controls, button, [role="button"], input, select, textarea, a',
    ) !== null
  );
}
</script>

<template>
  <nav
    ref="tabBarElement"
    class="terminal-tabs"
    :aria-label="t('tabs.openTabs')"
    @pointerdown="onTabBarPointerDown"
    @dblclick="onTabBarDoubleClick"
  >
    <div class="tabbar-actions">
      <button
        class="tabbar-command tabbar-command-square"
        type="button"
        :aria-label="t('tabs.newTerminal')"
        @click="$emit('newTerminal')"
      >
        +
      </button>
      <button class="tabbar-command" type="button" @click="$emit('openRecent')">
        {{ t('start.recent') }}
      </button>
    </div>

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
        draggable="false"
        @pointerdown="onTabPointerDown($event, tab)"
        @pointermove="onTabPointerMove"
        @pointerup="onTabPointerUp"
        @pointercancel="onTabPointerCancel"
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
          @click="onTabClick($event, tab.id)"
          @keydown="handleTabKey($event, tab.id)"
        >
          <span v-if="tab.kind === 'terminal'" class="status-dot" aria-hidden="true" />
          <span v-else class="settings-tab-icon" aria-hidden="true">S</span>
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

    <span class="tabbar-drag-region" aria-hidden="true" data-tauri-drag-region />
    <button
      class="tabbar-command tabbar-settings"
      :class="{ active: activeTabId === SETTINGS_TAB_ID }"
      data-testid="tabbar-settings"
      type="button"
      :aria-label="t('tabs.openSettings')"
      :aria-pressed="activeTabId === SETTINGS_TAB_ID"
      @click="$emit('openSettings')"
    >
      {{ t('tabs.settings') }}
    </button>
    <div class="window-controls">
      <button class="window-button" type="button" aria-label="Minimize window" @click="minimizeWindow">
        <span class="window-glyph minimize" />
      </button>
      <button
        class="window-button"
        type="button"
        aria-label="Maximize window"
        @click="toggleMaximizeWindow"
      >
        <span class="window-glyph maximize" />
      </button>
      <button class="window-button danger" type="button" aria-label="Close window" @click="closeWindow">
        <span class="window-glyph close" />
      </button>
    </div>
  </nav>
</template>
