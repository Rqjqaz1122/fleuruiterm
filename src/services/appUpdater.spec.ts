import { describe, expect, it, vi } from 'vitest';

import {
  createAppUpdaterClient,
  type AppUpdaterRuntime,
  type NativeDownloadEvent,
} from './appUpdater';

describe('appUpdaterClient', () => {
  it('degrades safely outside the Tauri runtime', async () => {
    const runtime = createRuntime({ available: false });
    const client = createAppUpdaterClient(runtime);

    expect(client.available).toBe(false);
    await expect(client.currentVersion()).resolves.toBe('Development');
    await expect(client.check()).resolves.toBeNull();
    expect(runtime.check).not.toHaveBeenCalled();
  });

  it('normalizes an available native update', async () => {
    const download = vi.fn(async () => undefined);
    const install = vi.fn(async () => undefined);
    const runtime = createRuntime({
      check: vi.fn(async () => ({
        version: '0.2.0',
        date: '2026-07-21T12:00:00Z',
        body: 'New terminal features',
        download,
        install,
      })),
    });
    const client = createAppUpdaterClient(runtime);

    const update = await client.check();

    expect(update).toMatchObject({
      version: '0.2.0',
      date: '2026-07-21T12:00:00Z',
      body: 'New terminal features',
    });
  });

  it('reports cumulative download progress', async () => {
    const nativeEvents: NativeDownloadEvent[] = [
      { event: 'Started', data: { contentLength: 100 } },
      { event: 'Progress', data: { chunkLength: 35 } },
      { event: 'Progress', data: { chunkLength: 65 } },
      { event: 'Finished' },
    ];
    const runtime = createRuntime({
      check: vi.fn(async () => ({
        version: '0.2.0',
        download: vi.fn(async (onEvent) => {
          nativeEvents.forEach((event) => onEvent?.(event));
        }),
        install: vi.fn(async () => undefined),
      })),
    });
    const client = createAppUpdaterClient(runtime);
    const update = await client.check();
    const progress = vi.fn();

    await update?.download(progress);

    expect(progress.mock.calls.map(([value]) => value)).toEqual([
      { downloadedBytes: 0, totalBytes: 100 },
      { downloadedBytes: 35, totalBytes: 100 },
      { downloadedBytes: 100, totalBytes: 100 },
      { downloadedBytes: 100, totalBytes: 100 },
    ]);
  });

  it('keeps download and installation as separate updater operations', async () => {
    const download = vi.fn(async () => undefined);
    const install = vi.fn(async () => undefined);
    const runtime = createRuntime({
      check: vi.fn(async () => ({ version: '0.2.0', download, install })),
    });
    const client = createAppUpdaterClient(runtime);
    const update = await client.check();

    await update?.download(vi.fn());

    expect(download).toHaveBeenCalledOnce();
    expect(install).not.toHaveBeenCalled();

    await update?.install();

    expect(install).toHaveBeenCalledOnce();
  });

  it('delegates application restart to the process plugin', async () => {
    const runtime = createRuntime();
    const client = createAppUpdaterClient(runtime);

    await client.restart();

    expect(runtime.relaunch).toHaveBeenCalledOnce();
  });
});

function createRuntime(patch: Partial<AppUpdaterRuntime> = {}): AppUpdaterRuntime {
  return {
    available: true,
    check: vi.fn(async () => null),
    getVersion: vi.fn(async () => '0.1.0'),
    relaunch: vi.fn(async () => undefined),
    ...patch,
  };
}
