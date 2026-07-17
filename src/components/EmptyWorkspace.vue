<script setup lang="ts">
defineProps<{ pending: boolean }>();
defineEmits<{ create: [] }>();
</script>

<template>
  <div class="empty-workspace">
    <div class="empty-icon" aria-hidden="true">›_</div>
    <h1>Start a local terminal</h1>
    <p>Open your default shell in a secure, native FleurTerm session.</p>
    <button
      class="primary-action"
      data-testid="new-terminal"
      type="button"
      :disabled="pending"
      @click="$emit('create')"
    >
      {{ pending ? 'Opening…' : 'New local terminal' }}
    </button>
  </div>
</template>
