<script setup lang="ts">
import { t } from '@/i18n/locale';

defineProps<{ pending: boolean }>();

defineEmits<{
  createTerminal: [];
  openSettings: [];
}>();
</script>

<template>
  <section class="start-page" aria-labelledby="start-page-title">
    <div class="start-page-content">
      <div class="start-brand-mark" aria-hidden="true" />
      <h1 id="start-page-title">FleurTerm</h1>

      <div class="start-action-list" :aria-label="t('start.getStarted')">
        <button
          class="start-action"
          data-testid="profiles-entry"
          type="button"
          @click="$emit('openSettings')"
        >
          <span class="start-action-icon" aria-hidden="true" />
          <span>
            <strong>{{ t('start.profiles') }}</strong>
            <small>{{ t('start.profilesDescription') }}</small>
          </span>
        </button>
        <button
          class="start-action"
          data-testid="start-new-terminal"
          type="button"
          :disabled="pending"
          @click="$emit('createTerminal')"
        >
          <span class="start-action-icon" aria-hidden="true" />
          <span>
            <strong>{{ pending ? t('start.opening') : t('start.newTerminal') }}</strong>
            <small>{{ t('start.newTerminalDescription') }}</small>
          </span>
        </button>
        <button
          class="start-action"
          data-testid="recent-entry"
          type="button"
          @click="$emit('openSettings')"
        >
          <span class="start-action-icon" aria-hidden="true" />
          <span>
            <strong>{{ t('start.recent') }}</strong>
            <small>{{ t('start.recentDescription') }}</small>
          </span>
        </button>
      </div>

      <footer class="start-page-footer">
        <button
          class="link-button"
          data-testid="start-settings"
          type="button"
          @click="$emit('openSettings')"
        >
          {{ t('start.settings') }}
        </button>
        <span class="version-text">v0.1.0</span>
      </footer>
    </div>
  </section>
</template>
