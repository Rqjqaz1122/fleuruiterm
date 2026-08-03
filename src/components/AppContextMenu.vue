<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import {
  contextMenu,
  type ContextMenuActionEntry,
  type ContextMenuRequest,
} from '@/services/contextMenu';

const VIEWPORT_PADDING = 8;

const request = contextMenu.state;
const menuElement = ref<HTMLElement | null>(null);
const left = ref(0);
const top = ref(0);
const menuStyle = computed(() => ({
  left: `${left.value}px`,
  top: `${top.value}px`,
}));

watch(request, positionMenu, { flush: 'post' });

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

  left.value = nextRequest.x;
  top.value = nextRequest.y;
  await nextTick();

  const element = menuElement.value;
  if (element === null || request.value !== nextRequest) {
    return;
  }

  const bounds = element.getBoundingClientRect();
  left.value = clampCoordinate(nextRequest.x, bounds.width, window.innerWidth);
  top.value = clampCoordinate(nextRequest.y, bounds.height, window.innerHeight);
  await nextTick();
  element.focus();
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
  contextMenu.close();
}

function closeFromWindowEvent(): void {
  contextMenu.close();
}

function runEntry(entry: ContextMenuActionEntry): void {
  if (entry.disabled) {
    return;
  }

  try {
    void entry.run();
  } finally {
    contextMenu.close();
  }
}

function handleKeyDown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'ArrowDown':
      moveFocus(event, 1);
      return;
    case 'ArrowUp':
      moveFocus(event, -1);
      return;
    case 'Home':
      focusBoundaryAction(event, 0);
      return;
    case 'End':
      focusBoundaryAction(event, -1);
      return;
    case 'Enter':
    case ' ':
      runFocusedEntry(event);
      return;
    case 'Escape':
      event.preventDefault();
      contextMenu.close();
  }
}

function moveFocus(event: KeyboardEvent, offset: number): void {
  event.preventDefault();
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

function focusBoundaryAction(event: KeyboardEvent, index: number): void {
  event.preventDefault();
  const buttons = enabledActionButtons();
  const resolvedIndex = index === -1 ? buttons.length - 1 : index;
  buttons[resolvedIndex]?.focus();
}

function runFocusedEntry(event: KeyboardEvent): void {
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

  event.preventDefault();
  runEntry(entry);
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
