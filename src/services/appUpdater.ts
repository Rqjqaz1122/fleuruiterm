import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type DownloadEvent } from '@tauri-apps/plugin-updater';

const DEVELOPMENT_VERSION_LABEL = 'Development';

export type NativeDownloadEvent = DownloadEvent;

export interface NativeUpdateLike {
  version: string;
  date?: string;
  body?: string;
  downloadAndInstall(onEvent?: (event: NativeDownloadEvent) => void): Promise<void>;
}

export interface AppUpdaterRuntime {
  available: boolean;
  getVersion(): Promise<string>;
  check(): Promise<NativeUpdateLike | null>;
  relaunch(): Promise<void>;
}

export interface UpdateDownloadProgress {
  downloadedBytes: number;
  totalBytes: number | null;
}

export interface AvailableAppUpdate {
  version: string;
  date: string | null;
  body: string | null;
  downloadAndInstall(onProgress: (progress: UpdateDownloadProgress) => void): Promise<void>;
}

export interface AppUpdaterClient {
  readonly available: boolean;
  currentVersion(): Promise<string>;
  check(): Promise<AvailableAppUpdate | null>;
  restart(): Promise<void>;
}

const tauriRuntime: AppUpdaterRuntime = {
  available:
    typeof window !== 'undefined' &&
    '__TAURI_INTERNALS__' in window &&
    import.meta.env.VITE_UPDATER_ENABLED === 'true',
  getVersion,
  check,
  relaunch,
};

export function createAppUpdaterClient(
  runtime: AppUpdaterRuntime = tauriRuntime,
): AppUpdaterClient {
  return {
    available: runtime.available,
    async currentVersion(): Promise<string> {
      return runtime.available ? runtime.getVersion() : DEVELOPMENT_VERSION_LABEL;
    },
    async check(): Promise<AvailableAppUpdate | null> {
      if (!runtime.available) {
        return null;
      }
      const nativeUpdate = await runtime.check();
      return nativeUpdate === null ? null : normalizeAvailableUpdate(nativeUpdate);
    },
    async restart(): Promise<void> {
      if (runtime.available) {
        await runtime.relaunch();
      }
    },
  };
}

function normalizeAvailableUpdate(nativeUpdate: NativeUpdateLike): AvailableAppUpdate {
  return {
    version: nativeUpdate.version,
    date: nativeUpdate.date ?? null,
    body: nativeUpdate.body ?? null,
    async downloadAndInstall(onProgress): Promise<void> {
      let downloadedBytes = 0;
      let totalBytes: number | null = null;
      await nativeUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            downloadedBytes = 0;
            totalBytes = event.data.contentLength ?? null;
            break;
          case 'Progress':
            downloadedBytes += event.data.chunkLength;
            break;
          case 'Finished':
            downloadedBytes = totalBytes ?? downloadedBytes;
            break;
        }
        onProgress({ downloadedBytes, totalBytes });
      });
    },
  };
}

export const appUpdaterClient = createAppUpdaterClient();
