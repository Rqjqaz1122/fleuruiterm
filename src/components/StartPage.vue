<script setup lang="ts">
import { t } from '@/i18n/locale';
import { contextMenu, type ContextMenuEntry } from '@/services/contextMenu';

import appLogoUrl from '../../src-tauri/icons/app-icon-source.png';

const props = withDefaults(
  defineProps<{
    pending: boolean;
    version?: string;
  }>(),
  {
    version: 'Development',
  },
);

const emit = defineEmits<{
  createTerminal: [];
  openSettings: [];
}>();

function openStartPageContextMenu(event: MouseEvent): void {
  event.stopPropagation();
  const entries: ContextMenuEntry[] = [
    {
      kind: 'action',
      id: 'new-terminal',
      label: t('contextMenu.newTerminal'),
      disabled: props.pending,
      run: () => emit('createTerminal'),
    },
    {
      kind: 'action',
      id: 'open-settings',
      label: t('contextMenu.openSettings'),
      run: () => emit('openSettings'),
    },
  ];
  contextMenu.openAt(event, entries);
}
</script>

<template>
  <section
    class="start-page"
    aria-labelledby="start-page-title"
    @contextmenu="openStartPageContextMenu"
  >
    <div class="start-page-main">
      <div class="start-page-content">
        <header class="start-brand">
          <img
            class="start-brand-logo"
            data-testid="start-logo"
            :src="appLogoUrl"
            alt="FleurTerm"
            draggable="false"
          />
          <h1 id="start-page-title">FleurTerm</h1>
        </header>

        <nav class="start-menu" :aria-label="t('start.getStarted')">
          <button
            class="start-menu-action"
            data-testid="start-new-terminal"
            type="button"
            :disabled="pending"
            @click="$emit('createTerminal')"
          >
            <svg class="start-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 4v16M4 12h16" />
            </svg>
            <span>{{ pending ? t('start.opening') : t('start.newTerminal') }}</span>
          </button>

          <button
            class="start-menu-action"
            data-testid="profiles-entry"
            type="button"
            @click="$emit('openSettings')"
          >
            <svg class="start-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="6" width="15" height="13" rx="2" />
              <path d="M7 6V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1" />
            </svg>
            <span>{{ t('start.profiles') }}</span>
          </button>

          <button
            class="start-menu-action"
            data-testid="recent-entry"
            type="button"
            @click="$emit('openSettings')"
          >
            <svg class="start-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5M12 7v5l3 2" />
            </svg>
            <span>{{ t('start.recent') }}</span>
          </button>

          <button
            class="start-menu-action"
            data-testid="start-settings"
            type="button"
            @click="$emit('openSettings')"
          >
            <svg class="start-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
            </svg>
            <span>{{ t('start.settings') }}</span>
          </button>
        </nav>
      </div>
    </div>

    <footer class="start-page-footer">
      <div class="start-footer-meta" aria-hidden="true">
        <span class="start-footer-item">
          <svg viewBox="0 0 24 24">
            <path d="M6 3h12l3 5-9 13L3 8l3-5Z" />
            <path d="m3 8 9 4 9-4M12 12V3" />
          </svg>
          FleurUI
        </span>
        <span class="start-footer-item">
          <i />
          {{ t('status.ready') }}
        </span>
      </div>
      <span class="start-version" data-testid="start-version">{{
        version === 'Development' || version === '—' ? version : 'v' + version
      }}</span>
    </footer>
  </section>
</template>
