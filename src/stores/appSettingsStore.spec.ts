import { beforeEach, describe, expect, it } from 'vitest';

import {
  defaultUpdateSettings,
  sanitizeUpdateSettings,
  useAppSettingsStore,
} from './appSettingsStore';

describe('appSettingsStore update settings', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppSettingsStore().replaceRuntimeSettings({ update: defaultUpdateSettings });
  });

  it('defaults automatic update downloads to disabled', () => {
    expect(sanitizeUpdateSettings()).toEqual({ automaticDownloadEnabled: false });
    expect(sanitizeUpdateSettings(null)).toEqual({ automaticDownloadEnabled: false });
    expect(sanitizeUpdateSettings({ automaticDownloadEnabled: 'enabled' as never })).toEqual({
      automaticDownloadEnabled: false,
    });
  });

  it('updates and serializes the automatic download preference', () => {
    const store = useAppSettingsStore();

    store.updateUpdateSettings({ automaticDownloadEnabled: true });

    expect(store.updateSettings.value).toEqual({ automaticDownloadEnabled: true });
    expect(store.serializeRuntimeSettings().update).toEqual({ automaticDownloadEnabled: true });
  });

  it('persists the automatic download preference with runtime settings', () => {
    const store = useAppSettingsStore();

    store.updateUpdateSettings({ automaticDownloadEnabled: true });

    expect(JSON.parse(localStorage.getItem('fleurterm.runtimeSettings') ?? '{}')).toMatchObject({
      update: { automaticDownloadEnabled: true },
    });
  });
});
