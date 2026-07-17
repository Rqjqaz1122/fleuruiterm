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
      <div class="start-brand-mark" aria-hidden="true">›_</div>
      <h1 id="start-page-title">FleurTerm</h1>
      <p class="start-brand-caption">{{ t('start.caption') }}</p>

      <div class="start-action-list" :aria-label="t('start.getStarted')">
        <div
          class="start-action start-action-static"
          data-testid="profiles-entry"
          aria-disabled="true"
        >
          <span class="start-action-icon" aria-hidden="true">⌘</span>
          <span>
            <strong>{{ t('start.profiles') }}</strong>
            <small>{{ t('start.profilesDescription') }}</small>
          </span>
        </div>
        <button
          class="start-action"
          data-testid="start-new-terminal"
          type="button"
          :disabled="pending"
          @click="$emit('createTerminal')"
        >
          <span class="start-action-icon" aria-hidden="true">›_</span>
          <span>
            <strong>{{ pending ? t('start.opening') : t('start.newTerminal') }}</strong>
            <small>{{ t('start.newTerminalDescription') }}</small>
          </span>
        </button>
        <div
          class="start-action start-action-static"
          data-testid="recent-entry"
          aria-disabled="true"
        >
          <span class="start-action-icon" aria-hidden="true">◷</span>
          <span>
            <strong>{{ t('start.recent') }}</strong>
            <small>{{ t('start.recentDescription') }}</small>
          </span>
        </div>
        <button
          class="start-action"
          data-testid="start-settings"
          type="button"
          @click="$emit('openSettings')"
        >
          <span class="start-action-icon" aria-hidden="true">⚙</span>
          <span>
            <strong>{{ t('start.settings') }}</strong>
            <small>{{ t('start.settingsDescription') }}</small>
          </span>
        </button>
      </div>
    </div>
  </section>
</template>
