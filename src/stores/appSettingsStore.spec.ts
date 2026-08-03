import { beforeEach, describe, expect, it } from 'vitest';

import {
  defaultAiSettings,
  defaultAppearanceSettings,
  defaultStartupSettings,
  defaultTerminalSettings,
  defaultUpdateSettings,
  sanitizeUpdateSettings,
  useAppSettingsStore,
} from './appSettingsStore';

describe('app settings store', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppSettingsStore().replaceRuntimeSettings({
      ai: defaultAiSettings,
      appearance: defaultAppearanceSettings,
      shortcuts: {},
      startup: defaultStartupSettings,
      terminal: defaultTerminalSettings,
      update: defaultUpdateSettings,
    });
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

  it('applies a complete settings patch and sanitizes bounded appearance values', () => {
    const settings = useAppSettingsStore();

    settings.updateApplicationSettings({
      ai: {
        model: 'gpt-5.1',
        streamingEnabled: false,
      },
      appearance: {
        themeMode: 'light',
        palettes: {
          light: { terminalForeground: '#123456', terminalMuted: '#abcdef' },
        },
        transparency: { enabled: true, opacity: 130, blur: -4 },
      },
      shortcuts: {
        'new-terminal': { key: 'j', modifier: 'primary', shift: true },
      },
      startup: { openTerminalOnStartup: true },
      terminal: { fontSize: 18, cursorBlink: false },
      update: { automaticDownloadEnabled: true },
    });

    expect(settings.startupSettings.value.openTerminalOnStartup).toBe(true);
    expect(settings.appearanceSettings.value).toMatchObject({
      themeMode: 'light',
      palettes: {
        light: { terminalForeground: '#123456', terminalMuted: '#abcdef' },
      },
      transparency: { enabled: true, opacity: 100, blur: 0 },
    });
    expect(settings.terminalSettings.value).toMatchObject({ fontSize: 18, cursorBlink: false });
    expect(settings.aiSettings.value).toMatchObject({
      model: 'gpt-5.1',
      streamingEnabled: false,
    });
    expect(settings.shortcutSettings.value['new-terminal']).toEqual({
      key: 'j',
      modifier: 'primary',
      shift: true,
    });
    expect(settings.updateSettings.value.automaticDownloadEnabled).toBe(true);
  });

  it('rejects AI-managed patches that contain the endpoint or token', () => {
    const settings = useAppSettingsStore();
    settings.updateAiSettings({
      baseUrl: 'https://original.example.com/v1',
      token: 'original-token',
    });

    expect(() =>
      settings.updateApplicationSettings({
        ai: {
          baseUrl: 'https://blocked.example.com/v1',
          token: 'blocked-token',
        },
      }),
    ).toThrow('AI cannot modify the read-only setting');
    expect(settings.aiSettings.value.baseUrl).toBe('https://original.example.com/v1');
    expect(settings.aiSettings.value.token).toBe('original-token');
  });
});
