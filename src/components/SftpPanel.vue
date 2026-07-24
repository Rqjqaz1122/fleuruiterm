<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { t, type TranslationKey } from '@/i18n/locale';
import { SftpClient, SftpClientError, type SftpDirectoryEntry } from '@/services/sftpClient';

type PanelState = 'connecting' | 'ready' | 'failed';

const props = defineProps<{
  terminalSessionId: string;
  client?: SftpClient;
}>();

const emit = defineEmits<{
  close: [];
}>();

const client = props.client ?? new SftpClient();
const panelState = ref<PanelState>('connecting');
const sftpSessionId = ref<string | null>(null);
const currentPath = ref('/');
const entries = ref<SftpDirectoryEntry[]>([]);
const loadingDirectory = ref(false);
const transferActive = ref(false);
const transferMessage = ref<string | null>(null);
const errorMessage = ref<string | null>(null);
let disposed = false;
let listingRequest = 0;

const operationBusy = computed(
  () => panelState.value === 'connecting' || loadingDirectory.value || transferActive.value,
);
const breadcrumbs = computed(() => {
  const segments = currentPath.value.split('/').filter(Boolean);
  return [
    { label: '/', path: '/' },
    ...segments.map((label, index) => ({
      label,
      path: `/${segments.slice(0, index + 1).join('/')}`,
    })),
  ];
});

onMounted(connect);

onBeforeUnmount(() => {
  disposed = true;
  listingRequest += 1;
  void closeBackendSession();
});

async function connect(): Promise<void> {
  panelState.value = 'connecting';
  errorMessage.value = null;
  await closeBackendSession();
  try {
    const opened = await client.open(props.terminalSessionId);
    if (disposed) {
      await client.close(opened.sftpSessionId);
      return;
    }
    sftpSessionId.value = opened.sftpSessionId;
    currentPath.value = opened.path;
    panelState.value = 'ready';
    await loadDirectory(opened.path);
  } catch (error) {
    if (!disposed) {
      panelState.value = 'failed';
      errorMessage.value = visibleError(error);
    }
  }
}

async function loadDirectory(path: string): Promise<void> {
  const sessionId = sftpSessionId.value;
  if (sessionId === null) {
    return;
  }
  const request = ++listingRequest;
  loadingDirectory.value = true;
  errorMessage.value = null;
  try {
    const result = await client.listDirectory(sessionId, path);
    if (disposed || request !== listingRequest) {
      return;
    }
    currentPath.value = result.path;
    entries.value = result.entries;
  } catch (error) {
    if (!disposed && request === listingRequest) {
      errorMessage.value = visibleError(error);
    }
  } finally {
    if (request === listingRequest) {
      loadingDirectory.value = false;
    }
  }
}

function openEntry(entry: SftpDirectoryEntry): void {
  if (entry.kind === 'directory' && !operationBusy.value) {
    void loadDirectory(entry.path);
  }
}

function openParentDirectory(): void {
  if (currentPath.value === '/' || operationBusy.value) {
    return;
  }
  const parentEnd = currentPath.value.lastIndexOf('/');
  void loadDirectory(parentEnd <= 0 ? '/' : currentPath.value.slice(0, parentEnd));
}

async function uploadFiles(): Promise<void> {
  const sessionId = sftpSessionId.value;
  if (sessionId === null || operationBusy.value) {
    return;
  }
  transferActive.value = true;
  try {
    transferMessage.value = t('sftp.uploading');
    errorMessage.value = null;
    const transferred = await client.uploadFiles(sessionId, currentPath.value);
    if (!transferred || disposed) {
      return;
    }
    transferMessage.value = t('sftp.uploadComplete');
    await loadDirectory(currentPath.value);
  } catch (error) {
    if (!disposed) {
      errorMessage.value = visibleError(error);
    }
  } finally {
    transferMessage.value = null;
    transferActive.value = false;
  }
}

async function downloadFile(entry: SftpDirectoryEntry): Promise<void> {
  const sessionId = sftpSessionId.value;
  if (sessionId === null || entry.kind !== 'file' || operationBusy.value) {
    return;
  }
  transferActive.value = true;
  try {
    transferMessage.value = t('sftp.downloading');
    errorMessage.value = null;
    const transferred = await client.downloadFile(sessionId, entry.path, entry.name);
    if (!transferred || disposed) {
      return;
    }
    transferMessage.value = t('sftp.downloadComplete');
  } catch (error) {
    if (!disposed) {
      errorMessage.value = visibleError(error);
    }
  } finally {
    transferMessage.value = null;
    transferActive.value = false;
  }
}

async function requestClose(): Promise<void> {
  await closeBackendSession();
  emit('close');
}

async function closeBackendSession(): Promise<void> {
  const sessionId = sftpSessionId.value;
  sftpSessionId.value = null;
  if (sessionId !== null) {
    await client.close(sessionId).catch(() => undefined);
  }
}

function visibleError(error: unknown): string {
  if (error instanceof SftpClientError) {
    return t(sftpErrorMessageKey(error.code));
  }
  return error instanceof Error ? error.message : t('sftp.failed');
}

function sftpErrorMessageKey(code: string): TranslationKey {
  const errorMessageKeys: Partial<Record<string, TranslationKey>> = {
    SFTP_AUTHENTICATION_FAILED: 'sftp.errorAuthentication',
    SFTP_HOST_KEY_UNKNOWN: 'sftp.errorUnknownHostKey',
    SFTP_HOST_KEY_MISMATCH: 'sftp.errorHostKeyMismatch',
    SFTP_CONNECTION_FAILED: 'sftp.errorConnection',
    SFTP_SESSION_NOT_FOUND: 'sftp.errorSession',
    SFTP_REMOTE_OPERATION_FAILED: 'sftp.errorRemote',
    SFTP_LOCAL_FILE_FAILED: 'sftp.errorLocal',
  };
  return errorMessageKeys[code] ?? 'sftp.failed';
}

function formatSize(size: number | null): string {
  if (size === null) {
    return '—';
  }
  if (size < 1024) {
    return `${size} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatModified(timestamp: number | null): string {
  return timestamp === null ? '—' : new Date(timestamp * 1000).toLocaleString();
}
</script>

<template>
  <section class="sftp-panel" :aria-label="t('sftp.title')" @pointerdown.stop>
    <header class="sftp-header">
      <div class="sftp-heading">
        <strong>{{ t('sftp.title') }}</strong>
        <nav v-if="panelState === 'ready'" class="sftp-breadcrumbs" aria-label="Path">
          <button
            v-for="crumb in breadcrumbs"
            :key="crumb.path"
            type="button"
            :disabled="operationBusy || crumb.path === currentPath"
            @click="loadDirectory(crumb.path)"
          >
            {{ crumb.label }}
          </button>
        </nav>
      </div>
      <div class="sftp-actions">
        <button
          type="button"
          :title="t('sftp.parent')"
          :aria-label="t('sftp.parent')"
          :disabled="operationBusy || currentPath === '/'"
          @click="openParentDirectory"
        >
          ↑
        </button>
        <button
          type="button"
          :title="t('sftp.refresh')"
          :aria-label="t('sftp.refresh')"
          :disabled="operationBusy || panelState !== 'ready'"
          @click="loadDirectory(currentPath)"
        >
          ↻
        </button>
        <button
          data-testid="sftp-upload"
          type="button"
          :disabled="operationBusy || panelState !== 'ready'"
          @click="uploadFiles"
        >
          ↑ {{ t('sftp.upload') }}
        </button>
        <button
          data-testid="sftp-close"
          class="sftp-close"
          type="button"
          :aria-label="t('sftp.close')"
          @click="requestClose"
        >
          ×
        </button>
      </div>
    </header>

    <div v-if="panelState === 'connecting'" class="sftp-state">{{ t('sftp.connecting') }}</div>
    <div v-else-if="panelState === 'failed'" class="sftp-state sftp-state-error" role="alert">
      <span>{{ errorMessage || t('sftp.failed') }}</span>
      <button type="button" @click="connect">{{ t('sftp.retry') }}</button>
    </div>
    <template v-else>
      <p v-if="errorMessage" class="sftp-inline-error" role="alert">{{ errorMessage }}</p>
      <p v-if="transferMessage" class="sftp-transfer-status">{{ transferMessage }}</p>
      <div class="sftp-table-header" aria-hidden="true">
        <span>{{ t('sftp.name') }}</span>
        <span>{{ t('sftp.size') }}</span>
        <span>{{ t('sftp.modified') }}</span>
        <span>{{ t('sftp.permissions') }}</span>
        <span />
      </div>
      <div v-if="loadingDirectory" class="sftp-state">{{ t('sftp.loading') }}</div>
      <div v-else-if="entries.length === 0" class="sftp-state">{{ t('sftp.empty') }}</div>
      <div v-else class="sftp-entry-list">
        <div v-for="entry in entries" :key="entry.path" class="sftp-entry-row">
          <button
            class="sftp-entry-name"
            :class="{ 'is-directory': entry.kind === 'directory' }"
            :data-testid="`sftp-entry-${entry.name}`"
            type="button"
            :disabled="entry.kind !== 'directory' || operationBusy"
            @click="openEntry(entry)"
          >
            <span class="sftp-entry-icon" aria-hidden="true">{{
              entry.kind === 'directory' ? '▰' : '·'
            }}</span>
            <span>{{ entry.name }}</span>
          </button>
          <span>{{ formatSize(entry.size) }}</span>
          <span>{{ formatModified(entry.modifiedAt) }}</span>
          <span class="sftp-permissions">{{ entry.permissions || '—' }}</span>
          <button
            v-if="entry.kind === 'file'"
            :data-testid="`sftp-download-${entry.name}`"
            type="button"
            :disabled="operationBusy"
            @click="downloadFile(entry)"
          >
            {{ t('sftp.download') }}
          </button>
          <span v-else />
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.sftp-panel {
  display: flex;
  min-height: 220px;
  max-height: min(42vh, 420px);
  flex: 0 1 36vh;
  flex-direction: column;
  overflow: hidden;
  color: var(--color-text);
  background: var(--terminal-bg);
  border-top: 1px solid var(--color-border);
}

.sftp-header,
.sftp-heading,
.sftp-actions,
.sftp-breadcrumbs {
  display: flex;
  align-items: center;
}

.sftp-header {
  min-height: 40px;
  justify-content: space-between;
  gap: 16px;
  padding: 0 12px 0 16px;
  background: var(--color-surface);
}

.sftp-heading {
  min-width: 0;
  gap: 14px;
}

.sftp-heading strong {
  color: var(--color-accent);
  font-size: 12px;
  letter-spacing: 0.04em;
}

.sftp-breadcrumbs {
  min-width: 0;
  overflow: hidden;
}

.sftp-breadcrumbs button {
  overflow: hidden;
  max-width: 150px;
  padding: 4px 6px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sftp-breadcrumbs button + button::before {
  margin-right: 8px;
  color: var(--color-text-muted);
  content: '/';
}

.sftp-actions {
  flex-shrink: 0;
  gap: 4px;
}

.sftp-panel button {
  min-height: 26px;
  color: var(--color-text-muted);
  font: inherit;
  background: transparent;
  border: 0;
  border-radius: var(--radius-small);
  cursor: pointer;
  transition:
    color var(--transition-fast),
    background var(--transition-fast);
}

.sftp-panel button:hover:not(:disabled),
.sftp-panel button:focus-visible {
  color: var(--color-text);
  background: var(--color-surface-hover);
}

.sftp-panel button:focus-visible {
  outline: 1px solid var(--color-accent);
  outline-offset: 1px;
}

.sftp-panel button:disabled {
  cursor: default;
  opacity: 0.48;
}

.sftp-actions button {
  padding: 4px 8px;
}

.sftp-actions .sftp-close {
  padding-inline: 9px;
  font-size: 18px;
}

.sftp-table-header,
.sftp-entry-row {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) 90px 190px 120px 76px;
  align-items: center;
  column-gap: 12px;
  padding: 0 16px;
}

.sftp-table-header {
  min-height: 30px;
  color: var(--color-text-muted);
  font-size: 11px;
  background: color-mix(in srgb, var(--color-surface) 72%, transparent);
}

.sftp-entry-list {
  overflow: auto;
  flex: 1;
  padding: 4px 0 10px;
}

.sftp-entry-row {
  min-height: 36px;
  color: var(--color-text-muted);
  font-size: 12px;
  border-radius: var(--radius-medium);
  margin: 0 8px;
  padding-inline: 8px;
}

.sftp-entry-row:hover {
  color: var(--color-text);
  background: var(--color-surface-hover-soft);
}

.sftp-entry-name {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  text-align: left;
}

.sftp-entry-name:disabled {
  color: inherit;
  opacity: 1;
}

.sftp-entry-name span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sftp-entry-name.is-directory {
  color: var(--color-text);
}

.sftp-entry-icon {
  color: var(--color-accent);
}

.sftp-permissions {
  font-family: var(--font-mono);
}

.sftp-state {
  display: grid;
  min-height: 120px;
  flex: 1;
  place-content: center;
  gap: 12px;
  color: var(--color-text-muted);
  font-size: 12px;
  text-align: center;
}

.sftp-state-error,
.sftp-inline-error {
  color: var(--color-danger);
}

.sftp-inline-error,
.sftp-transfer-status {
  margin: 0;
  padding: 7px 16px;
  font-size: 12px;
  background: color-mix(in srgb, var(--color-danger) 8%, transparent);
}

.sftp-transfer-status {
  color: var(--color-text-muted);
  background: transparent;
}

@media (max-width: 900px) {
  .sftp-table-header,
  .sftp-entry-row {
    grid-template-columns: minmax(180px, 1fr) 80px 150px 64px;
  }

  .sftp-table-header span:nth-child(4),
  .sftp-entry-row > :nth-child(4) {
    display: none;
  }
}
</style>
