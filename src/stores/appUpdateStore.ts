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
  | 'readyToRestart'
  | 'installing'
  | 'error'
  | 'unsupported';

export type AppUpdateErrorCode = 'CHECK_FAILED' | 'INSTALL_FAILED' | 'RESTART_FAILED';

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
    let preparePromise: Promise<void> | null = null;
    let restartPromise: Promise<void> | null = null;
    let installPromise: Promise<void> | null = null;
    let updateInstalled = false;
    let startupCheckRequested = false;
    let beforeRestart: () => Promise<boolean> = async () => true;
    let restartFailureHandler: () => void = () => undefined;

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
      if (installPromise !== null) {
        return installPromise ?? Promise.resolve();
      }
      const pendingInstall = performManualInstall();
      installPromise = pendingInstall;
      try {
        await pendingInstall;
      } finally {
        if (installPromise === pendingInstall) {
          installPromise = null;
        }
      }
    }

    async function prepareUpdate(): Promise<void> {
      if (preparePromise !== null) {
        return preparePromise;
      }
      const availableUpdate = update.value;
      if (availableUpdate === null || status.value !== 'available') {
        return;
      }
      const pendingPreparation = performPreparation(availableUpdate);
      preparePromise = pendingPreparation;
      try {
        await pendingPreparation;
      } finally {
        if (preparePromise === pendingPreparation) {
          preparePromise = null;
        }
      }
    }

    async function restartToApplyUpdate(): Promise<void> {
      if (restartPromise !== null) {
        return restartPromise;
      }
      const availableUpdate = update.value;
      if (availableUpdate === null || status.value !== 'readyToRestart') {
        return;
      }
      const pendingRestart = performRestart(availableUpdate);
      restartPromise = pendingRestart;
      try {
        await pendingRestart;
      } finally {
        if (restartPromise === pendingRestart) {
          restartPromise = null;
        }
      }
    }

    function setBeforeRestart(handler: () => Promise<boolean>): void {
      beforeRestart = handler;
    }

    function setRestartFailureHandler(handler: () => void): void {
      restartFailureHandler = handler;
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
        updateInstalled = false;
        status.value = update.value === null ? 'upToDate' : 'available';
      } catch {
        update.value = null;
        errorCode.value = 'CHECK_FAILED';
        status.value = 'error';
      }
    }

    async function performManualInstall(): Promise<void> {
      await prepareUpdate();
      await restartToApplyUpdate();
    }

    async function performPreparation(availableUpdate: AvailableAppUpdate): Promise<void> {
      errorCode.value = null;
      downloadedBytes.value = 0;
      totalBytes.value = null;
      updateInstalled = false;
      status.value = 'downloading';
      try {
        await availableUpdate.download((progress) => {
          downloadedBytes.value = progress.downloadedBytes;
          totalBytes.value = progress.totalBytes;
        });
        status.value = 'readyToRestart';
      } catch {
        errorCode.value = 'INSTALL_FAILED';
        status.value = 'error';
      }
    }

    async function performRestart(availableUpdate: AvailableAppUpdate): Promise<void> {
      let restartPrepared = false;
      let failureCode: AppUpdateErrorCode = 'RESTART_FAILED';
      errorCode.value = null;
      status.value = 'installing';
      try {
        if (!(await beforeRestart())) {
          throw new Error('Application state could not be saved before restart');
        }
        restartPrepared = true;
        if (!updateInstalled) {
          failureCode = 'INSTALL_FAILED';
          await availableUpdate.install();
          updateInstalled = true;
        }
        failureCode = 'RESTART_FAILED';
        await client.restart();
      } catch {
        if (restartPrepared) {
          restartFailureHandler();
        }
        errorCode.value = failureCode;
        status.value = 'readyToRestart';
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
      prepareUpdate,
      releaseDate,
      releaseNotes,
      restartToApplyUpdate,
      setBeforeRestart,
      setRestartFailureHandler,
      status,
      totalBytes,
    };
  });
}

export const useAppUpdateStore = createAppUpdateStore(appUpdaterClient);
