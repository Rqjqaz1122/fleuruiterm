<script setup lang="ts">
import type { SessionSnapshot } from '@/domain/session';

defineProps<{ snapshot: SessionSnapshot | null }>();
</script>

<template>
  <footer class="status-bar">
    <span class="status-item">
      <span class="status-dot" :class="snapshot?.state ?? 'closed'" aria-hidden="true" />
      {{ snapshot?.state ?? 'No session' }}
    </span>
    <span>{{ snapshot?.shell ?? 'Local shell' }}</span>
    <span class="status-spacer" />
  </footer>
</template>
