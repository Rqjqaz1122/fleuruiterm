import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppUpdaterClient, AvailableAppUpdate } from '@/services/appUpdater';

import { createAppUpdateStore } from './appUpdateStore';

describe('appUpdateStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('reports unsupported outside the desktop runtime', async () => {
    const client = createClient({ available: false });
    const store = createAppUpdateStore(client)();

    await store.checkForUpdate();

    expect(store.status).toBe('unsupported');
    expect(store.currentVersion).toBe('Development');
    expect(client.check).not.toHaveBeenCalled();
  });

  it('reports that the installed version is current', async () => {
    const client = createClient();
    const store = createAppUpdateStore(client)();

    await store.checkForUpdate();

    expect(store.status).toBe('upToDate');
    expect(store.currentVersion).toBe('0.1.0');
  });

  it('retains available update metadata', async () => {
    const update = createUpdate({
      version: '0.2.0',
      date: '2026-07-21T12:00:00Z',
      body: 'New terminal features',
    });
    const client = createClient({ check: vi.fn(async () => update) });
    const store = createAppUpdateStore(client)();

    await store.checkForUpdate();

    expect(store.status).toBe('available');
    expect(store.availableVersion).toBe('0.2.0');
    expect(store.releaseDate).toBe('2026-07-21T12:00:00Z');
    expect(store.releaseNotes).toBe('New terminal features');
  });

  it('deduplicates simultaneous and repeated startup checks', async () => {
    let resolveCheck: ((update: AvailableAppUpdate | null) => void) | undefined;
    const client = createClient({
      check: vi.fn(
        () =>
          new Promise<AvailableAppUpdate | null>((resolve) => {
            resolveCheck = resolve;
          }),
      ),
    });
    const store = createAppUpdateStore(client)();

    const firstCheck = store.checkAtStartup();
    const duplicateCheck = store.checkAtStartup();
    await vi.waitFor(() => expect(client.check).toHaveBeenCalledOnce());
    resolveCheck?.(null);
    await Promise.all([firstCheck, duplicateCheck]);
    await store.checkAtStartup();

    expect(client.check).toHaveBeenCalledOnce();
  });

  it('downloads, installs, and restarts an available update', async () => {
    const update = createUpdate({
      downloadAndInstall: vi.fn(async (onProgress) => {
        onProgress({ downloadedBytes: 25, totalBytes: 100 });
        onProgress({ downloadedBytes: 100, totalBytes: 100 });
      }),
    });
    const client = createClient({ check: vi.fn(async () => update) });
    const store = createAppUpdateStore(client)();
    await store.checkForUpdate();

    await store.installUpdate();

    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(store.downloadedBytes).toBe(100);
    expect(store.downloadProgressPercent).toBe(100);
    expect(store.status).toBe('installing');
    expect(client.restart).toHaveBeenCalledOnce();
  });

  it('flushes application state before an updater restart', async () => {
    const update = createUpdate();
    const client = createClient({ check: vi.fn(async () => update) });
    const store = createAppUpdateStore(client)();
    const beforeRestart = vi.fn(async () => true);
    store.setBeforeRestart(beforeRestart);
    await store.checkForUpdate();

    await store.installUpdate();

    expect(beforeRestart).toHaveBeenCalledOnce();
    expect(beforeRestart.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(client.restart).mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it('does not restart after the application state flush is rejected', async () => {
    const update = createUpdate();
    const client = createClient({ check: vi.fn(async () => update) });
    const store = createAppUpdateStore(client)();
    store.setBeforeRestart(async () => false);
    await store.checkForUpdate();

    await store.installUpdate();

    expect(client.restart).not.toHaveBeenCalled();
    expect(store.status).toBe('error');
    expect(store.errorCode).toBe('INSTALL_FAILED');
  });

  it('notifies the application when relaunch fails after a successful flush', async () => {
    const update = createUpdate();
    const client = createClient({
      check: vi.fn(async () => update),
      restart: vi.fn(async () => {
        throw new Error('relaunch failed');
      }),
    });
    const store = createAppUpdateStore(client)();
    const restartFailureHandler = vi.fn();
    store.setBeforeRestart(async () => true);
    store.setRestartFailureHandler(restartFailureHandler);
    await store.checkForUpdate();

    await store.installUpdate();

    expect(restartFailureHandler).toHaveBeenCalledOnce();
    expect(store.status).toBe('error');
  });

  it('uses stable error codes for check and install failures', async () => {
    const failingCheckClient = createClient({
      check: vi.fn(async () => {
        throw new Error('/Users/example/private/path');
      }),
    });
    const checkStore = createAppUpdateStore(failingCheckClient)();

    await checkStore.checkForUpdate();

    expect(checkStore.status).toBe('error');
    expect(checkStore.errorCode).toBe('CHECK_FAILED');

    setActivePinia(createPinia());
    const failingUpdate = createUpdate({
      downloadAndInstall: vi.fn(async () => {
        throw new Error('secret internal error');
      }),
    });
    const installClient = createClient({ check: vi.fn(async () => failingUpdate) });
    const installStore = createAppUpdateStore(installClient)();
    await installStore.checkForUpdate();

    await installStore.installUpdate();

    expect(installStore.status).toBe('error');
    expect(installStore.errorCode).toBe('INSTALL_FAILED');
  });
});

function createClient(patch: Partial<AppUpdaterClient> = {}): AppUpdaterClient {
  const available = patch.available ?? true;
  return {
    available,
    currentVersion: vi.fn(async () => (available ? '0.1.0' : 'Development')),
    check: vi.fn(async () => null),
    restart: vi.fn(async () => undefined),
    ...patch,
  };
}

function createUpdate(patch: Partial<AvailableAppUpdate> = {}): AvailableAppUpdate {
  return {
    version: '0.2.0',
    date: null,
    body: null,
    downloadAndInstall: vi.fn(async () => undefined),
    ...patch,
  };
}
