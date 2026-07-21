<script setup lang="ts">
import { computed } from 'vue';

import { locale } from '@/i18n/locale';
import { useAppUpdateStore, type AppUpdateStatus } from '@/stores/appUpdateStore';

const updateStore = useAppUpdateStore();
const labels = computed(() => (locale.value === 'zh-CN' ? zhLabels : enLabels));
const statusText = computed(() => {
  if (updateStore.status === 'available' && updateStore.availableVersion !== null) {
    return labels.value.available.replace('{version}', updateStore.availableVersion);
  }
  if (updateStore.status === 'error') {
    return updateStore.errorCode === 'INSTALL_FAILED'
      ? labels.value.installFailed
      : labels.value.checkFailed;
  }
  return labels.value.statuses[updateStore.status];
});
const releaseDateText = computed(() => {
  if (updateStore.releaseDate === null) {
    return '';
  }
  const date = new Date(updateStore.releaseDate);
  return Number.isNaN(date.getTime())
    ? updateStore.releaseDate
    : date.toLocaleDateString(locale.value);
});
const busy = computed(() => ['checking', 'downloading', 'installing'].includes(updateStore.status));

function checkForUpdate(): void {
  void updateStore.checkForUpdate();
}

function installUpdate(): void {
  void updateStore.installUpdate();
}
</script>

<template>
  <div class="settings-form-line software-update-card" data-testid="software-update-card">
    <div class="settings-form-copy software-update-copy">
      <strong>{{ labels.title }}</strong>
      <span>{{ labels.description }}</span>
      <span class="software-update-version">
        {{ labels.currentVersion }} {{ updateStore.currentVersion }}
      </span>
      <span class="software-update-status" :data-status="updateStore.status">
        {{ statusText }}
      </span>

      <div v-if="updateStore.status === 'available'" class="software-update-release">
        <span v-if="releaseDateText">{{ labels.releaseDate }} {{ releaseDateText }}</span>
        <p v-if="updateStore.releaseNotes">{{ updateStore.releaseNotes }}</p>
      </div>

      <div v-if="updateStore.status === 'downloading'" class="software-update-progress-row">
        <div
          class="software-update-progress"
          role="progressbar"
          :aria-label="labels.downloading"
          :aria-valuemin="0"
          :aria-valuemax="100"
          :aria-valuenow="updateStore.downloadProgressPercent ?? undefined"
        >
          <span
            :style="{
              width: `${updateStore.downloadProgressPercent ?? 16}%`,
            }"
          />
        </div>
        <strong v-if="updateStore.downloadProgressPercent !== null">
          {{ updateStore.downloadProgressPercent }}%
        </strong>
      </div>
    </div>

    <div class="settings-control software-update-actions">
      <button
        v-if="updateStore.status === 'available'"
        class="settings-reset-button is-primary"
        data-testid="install-update"
        type="button"
        @click="installUpdate"
      >
        {{ labels.install }}
      </button>
      <button
        v-else-if="updateStore.status !== 'unsupported'"
        class="settings-reset-button"
        data-testid="check-update"
        type="button"
        :disabled="busy"
        @click="checkForUpdate"
      >
        {{
          updateStore.status === 'checking'
            ? labels.checking
            : updateStore.status === 'upToDate'
              ? labels.checkAgain
              : updateStore.status === 'downloading'
                ? labels.downloading
                : updateStore.status === 'installing'
                  ? labels.installing
                  : labels.check
        }}
      </button>
    </div>
  </div>
</template>

<script lang="ts">
const enLabels = {
  title: 'Software updates',
  description: 'Keep FleurTerm secure and receive the latest terminal improvements.',
  currentVersion: 'Current version',
  available: 'Version {version} is available',
  releaseDate: 'Released',
  check: 'Check for updates',
  checkAgain: 'Check again',
  checking: 'Checking…',
  downloading: 'Downloading…',
  installing: 'Installing…',
  install: 'Download and install',
  checkFailed: 'Unable to check for updates',
  installFailed: 'Unable to install the update',
  statuses: {
    idle: 'Updates have not been checked yet',
    checking: 'Checking for updates',
    upToDate: 'FleurTerm is up to date',
    available: 'An update is available',
    downloading: 'Downloading update',
    installing: 'Installing update and preparing to restart',
    error: 'Update failed',
    unsupported: 'Update checks are only available in the desktop app',
  } satisfies Record<AppUpdateStatus, string>,
} as const;

const zhLabels = {
  title: '软件更新',
  description: '保持 FleurTerm 安全并获取最新的终端改进。',
  currentVersion: '当前版本',
  available: '发现新版本 {version}',
  releaseDate: '发布日期',
  check: '检查更新',
  checkAgain: '再次检查',
  checking: '正在检查…',
  downloading: '正在下载…',
  installing: '正在安装…',
  install: '下载并安装',
  checkFailed: '无法检查更新',
  installFailed: '无法安装更新',
  statuses: {
    idle: '尚未检查更新',
    checking: '正在检查更新',
    upToDate: 'FleurTerm 已是最新版本',
    available: '发现可用更新',
    downloading: '正在下载更新',
    installing: '正在安装更新并准备重启',
    error: '更新失败',
    unsupported: '仅桌面应用支持检查更新',
  } satisfies Record<AppUpdateStatus, string>,
} as const;
</script>
