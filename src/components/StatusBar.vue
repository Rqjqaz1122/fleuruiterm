<script setup lang="ts">
import type { SessionSnapshot } from '@/domain/session';
import { t, type TranslationKey } from '@/i18n/locale';

defineProps<{ snapshot: SessionSnapshot | null }>();

const sessionStateKeyByState = {
  created: 'status.created',
  starting: 'status.starting',
  ready: 'status.ready',
  closing: 'status.closing',
  closed: 'status.closed',
  failed: 'status.failed',
} as const satisfies Record<NonNullable<SessionSnapshot['state']>, TranslationKey>;
</script>

<template>
  <footer class="status-bar" :aria-label="t('status.aria')">
    <span class="status-item">
      <span class="status-dot" :class="snapshot?.state ?? 'closed'" aria-hidden="true" />
      {{ snapshot ? t(sessionStateKeyByState[snapshot.state]) : t('status.noSession') }}
    </span>
    <span>{{ snapshot?.shell ?? t('status.localShell') }}</span>
    <span class="status-spacer" />
  </footer>
</template>
