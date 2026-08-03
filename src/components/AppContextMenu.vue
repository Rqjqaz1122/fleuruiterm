<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import {
  contextMenu,
  type ContextMenuActionEntry,
  type ContextMenuRequest,
} from '@/services/contextMenu';

const VIEWPORT_PADDING = 8;
const HANDLED_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape']);

const request = contextMenu.state;
const menuElement = ref<HTMLElement | null>(null);
const invokingElement = ref<HTMLElement | null>(null);
const left = ref(0);
const top = ref(0);
const maxWidth = ref(0);
const maxHeight = ref(0);
const menuStyle = computed(() => ({
  left: `${left.value}px`,
  top: `${top.value}px`,
  maxWidth: `${maxWidth.value}px`,
  maxHeight: `${maxHeight.value}px`,
  overflow: 'auto',
}));

watch(request, positionMenu, { flush: 'post', immediate: true });

onMounted(() => {
  window.addEventListener('pointerdown', closeFromOutsidePointer, true);
  window.addEventListener('scroll', closeFromWindowEvent, true);
  window.addEventListener('resize', closeFromWindowEvent);
  window.addEventListener('blur', closeFromWindowEvent);
});

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', closeFromOutsidePointer, true);
  window.removeEventListener('scroll', closeFromWindowEvent, true);
  window.removeEventListener('resize', closeFromWindowEvent);
  window.removeEventListener('blur', closeFromWindowEvent);
});

async function positionMenu(nextRequest: ContextMenuRequest | null): Promise<void> {
  if (nextRequest === null) {
    return;
  }

  captureInvoker(nextRequest);
  left.value = nextRequest.x;
  top.value = nextRequest.y;
  maxWidth.value = availableViewportSize(window.innerWidth);
  maxHeight.value = availableViewportSize(window.innerHeight);
  await nextTick();

  const element = menuElement.value;
  if (element === null || request.value !== nextRequest) {
    return;
  }

  const bounds = element.getBoundingClientRect();
  left.value = clampCoordinate(
    nextRequest.x,
    Math.min(bounds.width, maxWidth.value),
    window.innerWidth,
  );
  top.value = clampCoordinate(
    nextRequest.y,
    Math.min(bounds.height, maxHeight.value),
    window.innerHeight,
  );
  await nextTick();
  const firstEnabledAction = enabledActionButtons()[0];
  if (firstEnabledAction === undefined) {
    element.focus();
    return;
  }
  firstEnabledAction.focus();
}

function captureInvoker(nextRequest: ContextMenuRequest): void {
  const nextInvoker = nextRequest.invoker;
  if (nextInvoker === null || menuElement.value?.contains(nextInvoker)) {
    return;
  }
  invokingElement.value = nextInvoker;
}

function availableViewportSize(viewportSize: number): number {
  return Math.max(0, viewportSize - VIEWPORT_PADDING * 2);
}

function clampCoordinate(
  pointerCoordinate: number,
  menuSize: number,
  viewportSize: number,
): number {
  const maximumCoordinate = Math.max(VIEWPORT_PADDING, viewportSize - menuSize - VIEWPORT_PADDING);
  return Math.min(Math.max(pointerCoordinate, VIEWPORT_PADDING), maximumCoordinate);
}

function closeFromOutsidePointer(event: PointerEvent): void {
  const element = menuElement.value;
  if (element !== null && event.target instanceof Node && element.contains(event.target)) {
    return;
  }
  closeWithoutFocusRestore();
}

function closeFromWindowEvent(): void {
  closeWithoutFocusRestore();
}

function closeWithoutFocusRestore(): void {
  contextMenu.close();
  invokingElement.value = null;
}

async function runEntry(entry: ContextMenuActionEntry): Promise<void> {
  if (entry.disabled) {
    return;
  }

  let actionResult: void | Promise<void>;
  try {
    actionResult = entry.run();
  } catch (error) {
    closeWithoutFocusRestore();
    reportActionError(entry, error);
    return;
  }

  closeWithoutFocusRestore();
  try {
    await actionResult;
  } catch (error) {
    reportActionError(entry, error);
  }
}

function reportActionError(entry: ContextMenuActionEntry, error: unknown): void {
  console.error(`Context menu action failed: ${entry.id}`, error);
}

function handleKeyDown(event: KeyboardEvent): void {
  if (!HANDLED_KEYS.has(event.key)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();

  switch (event.key) {
    case 'ArrowDown':
      moveFocus(1);
      return;
    case 'ArrowUp':
      moveFocus(-1);
      return;
    case 'Home':
      focusBoundaryAction(0);
      return;
    case 'End':
      focusBoundaryAction(-1);
      return;
    case 'Enter':
    case ' ':
      runFocusedEntry();
      return;
    case 'Escape':
      closeAndRestoreFocus();
  }
}

function closeAndRestoreFocus(): void {
  const elementToRestore = invokingElement.value;
  contextMenu.close();
  invokingElement.value = null;
  void nextTick(() => {
    if (elementToRestore?.isConnected) {
      elementToRestore.focus();
    }
  });
}

function moveFocus(offset: number): void {
  const buttons = enabledActionButtons();
  if (buttons.length === 0) {
    return;
  }

  const currentIndex = buttons.findIndex((button) => button === document.activeElement);
  const nextIndex =
    currentIndex === -1
      ? offset > 0
        ? 0
        : buttons.length - 1
      : (currentIndex + offset + buttons.length) % buttons.length;
  buttons[nextIndex]?.focus();
}

function focusBoundaryAction(index: number): void {
  const buttons = enabledActionButtons();
  const resolvedIndex = index === -1 ? buttons.length - 1 : index;
  buttons[resolvedIndex]?.focus();
}

function runFocusedEntry(): void {
  const focusedElement = document.activeElement;
  if (!(focusedElement instanceof HTMLButtonElement) || focusedElement.disabled) {
    return;
  }

  const actionId = focusedElement.dataset.contextAction;
  const entry = request.value?.entries.find(
    (candidate): candidate is ContextMenuActionEntry =>
      candidate.kind === 'action' && candidate.id === actionId,
  );
  if (entry === undefined) {
    return;
  }

  void runEntry(entry);
}

function enabledActionButtons(): HTMLButtonElement[] {
  return Array.from(
    menuElement.value?.querySelectorAll<HTMLButtonElement>(
      '[data-context-action]:not(:disabled)',
    ) ?? [],
  );
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="request"
      ref="menuElement"
      class="app-context-menu"
      role="menu"
      tabindex="-1"
      :style="menuStyle"
      @keydown="handleKeyDown"
    >
      <template v-for="entry in request.entries" :key="entry.id">
        <div
          v-if="entry.kind === 'separator'"
          class="app-context-menu-separator"
          role="separator"
        />
        <button
          v-else
          class="app-context-menu-action"
          :class="{ danger: entry.danger }"
          type="button"
          role="menuitem"
          tabindex="-1"
          :data-context-action="entry.id"
          :disabled="entry.disabled"
          @click="runEntry(entry)"
        >
          {{ entry.label }}
        </button>
      </template>
    </div>
  </Teleport>
</template>
