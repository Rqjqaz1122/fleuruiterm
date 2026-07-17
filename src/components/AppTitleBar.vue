<script setup lang="ts">
defineProps<{ settingsActive: boolean }>();
defineEmits<{ openSettings: [] }>();
</script>

<template>
  <header class="app-title-bar" data-tauri-drag-region>
    <span class="title-bar-control-space" aria-hidden="true" data-tauri-drag-region />
    <span class="title-bar-name" data-tauri-drag-region>FleurTerm</span>
    <button
      class="icon-button title-bar-settings"
      :class="{ active: settingsActive }"
      data-testid="titlebar-settings"
      type="button"
      aria-label="Open settings"
      :aria-pressed="settingsActive"
      @click="$emit('openSettings')"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path
          d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.1 4.9-1.6 1.2c-.2.6-.4 1.1-.7 1.6l.3 2a1 1 0 0 1-.5 1l-1.8 1a1 1 0 0 1-1.1-.1l-1.6-1.2a9 9 0 0 1-1.8 0l-1.6 1.2a1 1 0 0 1-1.1.1l-1.8-1a1 1 0 0 1-.5-1l.3-2a8 8 0 0 1-.8-1.6l-1.5-1.2a1 1 0 0 1-.4-1.1v-2a1 1 0 0 1 .4-1l1.5-1.3c.2-.6.5-1.1.8-1.6l-.3-2a1 1 0 0 1 .5-1l1.8-1a1 1 0 0 1 1.1.1l1.6 1.2a9 9 0 0 1 1.8 0l1.6-1.2a1 1 0 0 1 1.1-.1l1.8 1a1 1 0 0 1 .5 1l-.3 2c.3.5.5 1 .7 1.6l1.6 1.2a1 1 0 0 1 .4 1v2a1 1 0 0 1-.4 1.1Z"
        />
      </svg>
    </button>
  </header>
</template>
