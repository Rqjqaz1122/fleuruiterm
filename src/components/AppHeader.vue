<script setup lang="ts">
defineProps<{ pending: boolean }>();
defineEmits<{ newTerminal: [] }>();
</script>

<template>
  <header class="app-header">
    <div class="brand-lockup">
      <span class="brand-mark" aria-hidden="true">›_</span>
      <div>
        <strong>FleurTerm</strong>
        <span>by FleurUI</span>
      </div>
    </div>
    <button
      class="primary-action"
      data-testid="new-terminal"
      type="button"
      :disabled="pending"
      @click="$emit('newTerminal')"
    >
      <span aria-hidden="true">＋</span>
      New terminal
    </button>
  </header>
</template>
