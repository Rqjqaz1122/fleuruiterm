<script setup lang="ts">
import type { TerminalTab } from '@/domain/workspace';

defineProps<{
  tabs: TerminalTab[];
  activeTabId: string | null;
}>();

defineEmits<{
  activate: [tabId: string];
  close: [tabId: string];
  newTerminal: [];
}>();
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
          class="tab-button"
          role="tab"
          type="button"
          :aria-selected="tab.id === activeTabId"
          @click="$emit('activate', tab.id)"
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
