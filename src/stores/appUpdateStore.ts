import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import {
  appUpdaterClient,
  type AppUpdaterClient,
  type AvailableAppUpdate,
} from '@/services/appUpdater';

export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'upToDate'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'error'
  | 'unsupported';

export type AppUpdateErrorCode = 'CHECK_FAILED' | 'INSTALL_FAILED';

export function createAppUpdateStore(client: AppUpdaterClient, storeId = 'appUpdate') {
  return defineStore(storeId, () => {
    const status = ref<AppUpdateStatus>(client.available ? 'idle' : 'unsupported');
    const currentVersion = ref('—');
    const update = ref<AvailableAppUpdate | null>(null);
    const downloadedBytes = ref(0);
    const totalBytes = ref<number | null>(null);
    const errorCode = ref<AppUpdateErrorCode | null>(null);
    let versionPromise: Promise<void> | null = null;
    let checkPromise: Promise<void> | null = null;
    let installPromise: Promise<void> | null = null;
    let startupCheckRequested = false;

    const availableVersion = computed(() => update.value?.version ?? null);
    const releaseDate = computed(() => update.value?.date ?? null);
    const releaseNotes = computed(() => update.value?.body ?? null);
    const downloadProgressPercent = computed(() => {
      const total = totalBytes.value;
      if (total === null || total <= 0) {
        return null;
      }
      return Math.min(100, Math.round((downloadedBytes.value / total) * 100));
    });

    async function checkForUpdate(): Promise<void> {
      if (checkPromise !== null) {
        return checkPromise;
      }
      const pendingCheck = performCheck();
      checkPromise = pendingCheck;
      try {
        await pendingCheck;
      } finally {
        if (checkPromise === pendingCheck) {
          checkPromise = null;
        }
      }
    }

    async function checkAtStartup(): Promise<void> {
      if (startupCheckRequested) {
        return checkPromise ?? Promise.resolve();
      }
      startupCheckRequested = true;
      await checkForUpdate();
    }

    async function installUpdate(): Promise<void> {
      if (installPromise !== null || update.value === null) {
        return installPromise ?? Promise.resolve();
      }
      const pendingInstall = performInstall(update.value);
      installPromise = pendingInstall;
      try {
        await pendingInstall;
      } finally {
        if (installPromise === pendingInstall) {
          installPromise = null;
        }
      }
    }

    async function performCheck(): Promise<void> {
      errorCode.value = null;
      await loadCurrentVersion();
      if (!client.available) {
        status.value = 'unsupported';
        return;
      }
      status.value = 'checking';
      try {
        update.value = await client.check();
        status.value = update.value === null ? 'upToDate' : 'available';
      } catch {
        update.value = null;
        errorCode.value = 'CHECK_FAILED';
        status.value = 'error';
      }
    }

    async function performInstall(availableUpdate: AvailableAppUpdate): Promise<void> {
      errorCode.value = null;
      downloadedBytes.value = 0;
      totalBytes.value = null;
      status.value = 'downloading';
      try {
        await availableUpdate.downloadAndInstall((progress) => {
          downloadedBytes.value = progress.downloadedBytes;
          totalBytes.value = progress.totalBytes;
        });
        status.value = 'installing';
        await client.restart();
      } catch {
        errorCode.value = 'INSTALL_FAILED';
        status.value = 'error';
      }
    }

    async function loadCurrentVersion(): Promise<void> {
      if (versionPromise !== null) {
        return versionPromise;
      }
      versionPromise = client.currentVersion().then((version) => {
        currentVersion.value = version;
      });
      await versionPromise;
    }

    return {
      availableVersion,
      checkAtStartup,
      checkForUpdate,
      currentVersion,
      downloadedBytes,
      downloadProgressPercent,
      errorCode,
      installUpdate,
      releaseDate,
      releaseNotes,
      status,
      totalBytes,
    };
  });
}

export const useAppUpdateStore = createAppUpdateStore(appUpdaterClient);
