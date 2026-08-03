import { computed, ref } from 'vue';

import {
  sanitizeShortcutSettings,
  type AppCommand,
  type ShortcutBinding,
  type ShortcutSettings,
} from '@/services/appShortcuts';
import { applyApplicationAppearance } from '@/services/applicationAppearance';
import { validateAiManagedSettingsPatch } from '@/services/aiSettingsAccessPolicy';

export type SupportedAppLocale = 'en-US' | 'zh-CN';
export type AiProvider = 'none' | 'openai' | 'anthropic' | 'local' | 'custom';
export type AiCommandPolicy = 'ask' | 'suggest' | 'auto' | 'fullAccess';
export const AI_REASONING_EFFORTS = ['xhigh', 'high', 'medium', 'low'] as const;
export type AiReasoningEffort = (typeof AI_REASONING_EFFORTS)[number];
export type ThemeMode = 'system' | 'dark' | 'light';
export type ThemeTone = 'dark' | 'light';

export interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  scrollback: number;
  scrollOnInput: boolean;
  cursorBlink: boolean;
}

export interface UpdateSettings {
  automaticDownloadEnabled: boolean;
}

export interface AiSettings {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  token: string;
  tokenHeaderName: string;
  tokenPrefix: string;
  streamingEnabled: boolean;
  contextEnabled: boolean;
  includeWorkingDirectory: boolean;
  commandPolicy: AiCommandPolicy;
  reasoningEffort: AiReasoningEffort;
}

export interface StartupSettings {
  openTerminalOnStartup: boolean;
}

export interface TerminalColorPalette {
  terminalForeground: string;
  terminalMuted: string;
}

export interface AppearanceSettings {
  themeMode: ThemeMode;
  palettes: Record<ThemeTone, TerminalColorPalette>;
  transparency: {
    enabled: boolean;
    opacity: number;
    blur: number;
  };
}

export interface AppearanceSettingsPatch {
  themeMode?: unknown;
  palettes?: Partial<Record<ThemeTone, Partial<TerminalColorPalette>>>;
  transparency?: Partial<AppearanceSettings['transparency']>;
}

export interface ApplicationSettingsPatch {
  locale?: SupportedAppLocale;
  startup?: Partial<StartupSettings>;
  appearance?: AppearanceSettingsPatch;
  terminal?: Partial<TerminalSettings>;
  ai?: Partial<AiSettings>;
  shortcuts?: unknown;
  update?: Partial<UpdateSettings>;
}

export interface LanguageOption {
  value: SupportedAppLocale;
  label: string;
  nativeLabel: string;
}

const RUNTIME_SETTINGS_STORAGE_KEY = 'fleurterm.runtimeSettings';
const LEGACY_THEME_STORAGE_KEY = 'fleurterm.theme';
const LEGACY_WINDOW_STORAGE_KEY = 'fleurterm.window';

export const defaultTerminalSettings: TerminalSettings = {
  fontFamily: 'Source Code Pro, JetBrains Mono, Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.35,
  scrollback: 25_000,
  scrollOnInput: true,
  cursorBlink: true,
};

export const defaultUpdateSettings: UpdateSettings = {
  automaticDownloadEnabled: false,
};

export const defaultAiSettings: AiSettings = {
  provider: 'none',
  baseUrl: '',
  model: '',
  token: '',
  tokenHeaderName: 'Authorization',
  tokenPrefix: 'Bearer',
  streamingEnabled: true,
  contextEnabled: false,
  includeWorkingDirectory: true,
  commandPolicy: 'ask',
  reasoningEffort: 'medium',
};

export const defaultStartupSettings: StartupSettings = {
  openTerminalOnStartup: false,
};

export const defaultAppearanceSettings: AppearanceSettings = {
  themeMode: 'dark',
  palettes: {
    dark: {
      terminalForeground: '#eef3f8',
      terminalMuted: '#8a98a8',
    },
    light: {
      terminalForeground: '#1f2937',
      terminalMuted: '#667085',
    },
  },
  transparency: {
    enabled: false,
    opacity: 100,
    blur: 0,
  },
};

export function defaultsForAiProvider(
  provider: AiProvider,
): Pick<AiSettings, 'baseUrl' | 'tokenHeaderName' | 'tokenPrefix'> {
  return {
    baseUrl: defaultBaseUrlForProvider(provider),
    tokenHeaderName: defaultTokenHeaderNameForProvider(provider),
    tokenPrefix: defaultTokenPrefixForProvider(provider),
  };
}

const languageOptions = computed<LanguageOption[]>(() => [
  { value: 'en-US', label: 'English', nativeLabel: 'English' },
  { value: 'zh-CN', label: 'Chinese', nativeLabel: '简体中文' },
]);

const terminalSettings = ref<TerminalSettings>(loadTerminalSettings());
const aiSettings = ref<AiSettings>(loadAiSettings());
const shortcutSettings = ref<ShortcutSettings>(loadShortcutSettings());
const updateSettings = ref<UpdateSettings>(loadUpdateSettings());
const startupSettings = ref<StartupSettings>(loadStartupSettings());
const appearanceSettings = ref<AppearanceSettings>(loadAppearanceSettings());
applyApplicationAppearance(appearanceSettings.value);

export function useAppSettingsStore() {
  return {
    aiSettings,
    appearanceSettings,
    languageOptions,
    shortcutSettings,
    startupSettings,
    terminalSettings,
    updateSettings,
    resetShortcutSettings,
    serializeRuntimeSettings,
    replaceRuntimeSettings,
    updateAiSettings,
    updateAppearanceSettings,
    updateApplicationSettings,
    updateShortcutSetting,
    updateStartupSettings,
    updateTerminalSettings,
    updateUpdateSettings,
  };
}

export function sanitizeTerminalSettings(raw: Partial<TerminalSettings> = {}): TerminalSettings {
  return {
    fontFamily: normalizeString(raw.fontFamily, defaultTerminalSettings.fontFamily),
    fontSize: clampNumber(raw.fontSize, 10, 24, defaultTerminalSettings.fontSize),
    lineHeight: clampNumber(raw.lineHeight, 1, 1.8, defaultTerminalSettings.lineHeight),
    scrollback: clampNumber(raw.scrollback, 1_000, 100_000, defaultTerminalSettings.scrollback),
    scrollOnInput:
      typeof raw.scrollOnInput === 'boolean'
        ? raw.scrollOnInput
        : defaultTerminalSettings.scrollOnInput,
    cursorBlink:
      typeof raw.cursorBlink === 'boolean' ? raw.cursorBlink : defaultTerminalSettings.cursorBlink,
  };
}

export function sanitizeAiSettings(raw: Partial<AiSettings> = {}): AiSettings {
  const provider = isAiProvider(raw.provider) ? raw.provider : defaultAiSettings.provider;
  return {
    provider,
    baseUrl: hasOwn(raw, 'baseUrl')
      ? normalizeOptionalString(raw.baseUrl)
      : defaultBaseUrlForProvider(provider),
    model: normalizeOptionalString(raw.model),
    token: normalizeOptionalString(raw.token),
    tokenHeaderName:
      normalizeOptionalString(raw.tokenHeaderName) || defaultTokenHeaderNameForProvider(provider),
    tokenPrefix:
      raw.tokenPrefix === ''
        ? ''
        : normalizeOptionalString(raw.tokenPrefix) || defaultTokenPrefixForProvider(provider),
    streamingEnabled:
      typeof raw.streamingEnabled === 'boolean'
        ? raw.streamingEnabled
        : defaultAiSettings.streamingEnabled,
    contextEnabled:
      typeof raw.contextEnabled === 'boolean'
        ? raw.contextEnabled
        : defaultAiSettings.contextEnabled,
    includeWorkingDirectory:
      typeof raw.includeWorkingDirectory === 'boolean'
        ? raw.includeWorkingDirectory
        : defaultAiSettings.includeWorkingDirectory,
    commandPolicy: isAiCommandPolicy(raw.commandPolicy)
      ? raw.commandPolicy
      : defaultAiSettings.commandPolicy,
    reasoningEffort: isAiReasoningEffort(raw.reasoningEffort)
      ? raw.reasoningEffort
      : defaultAiSettings.reasoningEffort,
  };
}

export function sanitizeUpdateSettings(raw: unknown = {}): UpdateSettings {
  const automaticDownloadEnabled = isRecord(raw) ? raw.automaticDownloadEnabled : undefined;
  return {
    automaticDownloadEnabled:
      typeof automaticDownloadEnabled === 'boolean'
        ? automaticDownloadEnabled
        : defaultUpdateSettings.automaticDownloadEnabled,
  };
}

export function sanitizeStartupSettings(raw: Partial<StartupSettings> = {}): StartupSettings {
  return {
    openTerminalOnStartup:
      typeof raw.openTerminalOnStartup === 'boolean'
        ? raw.openTerminalOnStartup
        : defaultStartupSettings.openTerminalOnStartup,
  };
}

export function sanitizeAppearanceSettings(
  raw: AppearanceSettingsPatch = {},
  fallback: AppearanceSettings = defaultAppearanceSettings,
): AppearanceSettings {
  return {
    themeMode: isThemeMode(raw.themeMode) ? raw.themeMode : fallback.themeMode,
    palettes: {
      dark: sanitizeTerminalPalette(raw.palettes?.dark, fallback.palettes.dark),
      light: sanitizeTerminalPalette(raw.palettes?.light, fallback.palettes.light),
    },
    transparency: {
      enabled:
        typeof raw.transparency?.enabled === 'boolean'
          ? raw.transparency.enabled
          : fallback.transparency.enabled,
      opacity: clampNumber(raw.transparency?.opacity, 0, 100, fallback.transparency.opacity),
      blur: clampNumber(raw.transparency?.blur, 0, 32, fallback.transparency.blur),
    },
  };
}

function updateTerminalSettings(patch: Partial<TerminalSettings>): void {
  terminalSettings.value = sanitizeTerminalSettings({ ...terminalSettings.value, ...patch });
  persistRuntimeSettings();
}

function updateAiSettings(patch: Partial<AiSettings>): void {
  aiSettings.value = sanitizeAiSettings({ ...aiSettings.value, ...patch });
  persistRuntimeSettings();
}

function updateUpdateSettings(patch: Partial<UpdateSettings>): void {
  updateSettings.value = sanitizeUpdateSettings({ ...updateSettings.value, ...patch });
  persistRuntimeSettings();
}

function updateStartupSettings(patch: Partial<StartupSettings>): void {
  startupSettings.value = sanitizeStartupSettings({ ...startupSettings.value, ...patch });
  persistRuntimeSettings();
}

function updateAppearanceSettings(patch: AppearanceSettingsPatch): void {
  appearanceSettings.value = sanitizeAppearanceSettings(patch, appearanceSettings.value);
  applyApplicationAppearance(appearanceSettings.value);
  persistRuntimeSettings();
}

function updateApplicationSettings(patch: ApplicationSettingsPatch): void {
  validateAiManagedSettingsPatch(patch.ai);
  applyStartupSettingsPatch(patch.startup);
  applyAppearanceSettingsPatch(patch.appearance);
  applyTerminalSettingsPatch(patch.terminal);
  applyAiSettingsPatch(patch.ai);
  applyShortcutSettingsPatch(patch);
  applyUpdateSettingsPatch(patch.update);
  persistRuntimeSettings();
}

function applyStartupSettingsPatch(patch: Partial<StartupSettings> | undefined): void {
  if (patch === undefined) {
    return;
  }
  startupSettings.value = sanitizeStartupSettings({ ...startupSettings.value, ...patch });
}

function applyAppearanceSettingsPatch(patch: AppearanceSettingsPatch | undefined): void {
  if (patch === undefined) {
    return;
  }
  appearanceSettings.value = sanitizeAppearanceSettings(patch, appearanceSettings.value);
  applyApplicationAppearance(appearanceSettings.value);
}

function applyTerminalSettingsPatch(patch: Partial<TerminalSettings> | undefined): void {
  if (patch === undefined) {
    return;
  }
  terminalSettings.value = sanitizeTerminalSettings({ ...terminalSettings.value, ...patch });
}

function applyAiSettingsPatch(patch: Partial<AiSettings> | undefined): void {
  if (patch === undefined) {
    return;
  }
  aiSettings.value = sanitizeAiSettings({ ...aiSettings.value, ...patch });
}

function applyShortcutSettingsPatch(patch: ApplicationSettingsPatch): void {
  if (!hasOwn(patch, 'shortcuts')) {
    return;
  }
  shortcutSettings.value = sanitizeShortcutSettings(
    isRecord(patch.shortcuts) ? { ...shortcutSettings.value, ...patch.shortcuts } : patch.shortcuts,
  );
}

function applyUpdateSettingsPatch(patch: Partial<UpdateSettings> | undefined): void {
  if (patch === undefined) {
    return;
  }
  updateSettings.value = sanitizeUpdateSettings({ ...updateSettings.value, ...patch });
}

function updateShortcutSetting(shortcutId: AppCommand, binding: ShortcutBinding | null): void {
  shortcutSettings.value = {
    ...shortcutSettings.value,
    [shortcutId]: binding === null ? null : { ...binding },
  };
  persistRuntimeSettings();
}

function resetShortcutSettings(): void {
  shortcutSettings.value = {};
  persistRuntimeSettings();
}

function replaceRuntimeSettings(settings: {
  startup?: Partial<StartupSettings>;
  appearance?: AppearanceSettingsPatch;
  terminal?: Partial<TerminalSettings>;
  ai?: Partial<AiSettings>;
  shortcuts?: unknown;
  update?: Partial<UpdateSettings>;
}): void {
  startupSettings.value = sanitizeStartupSettings(settings.startup ?? startupSettings.value);
  appearanceSettings.value = sanitizeAppearanceSettings(
    settings.appearance ?? appearanceSettings.value,
    appearanceSettings.value,
  );
  applyApplicationAppearance(appearanceSettings.value);
  terminalSettings.value = sanitizeTerminalSettings(settings.terminal ?? terminalSettings.value);
  aiSettings.value = sanitizeAiSettings(settings.ai ?? aiSettings.value);
  updateSettings.value = sanitizeUpdateSettings(settings.update ?? updateSettings.value);
  if (Object.prototype.hasOwnProperty.call(settings, 'shortcuts')) {
    shortcutSettings.value = sanitizeShortcutSettings(settings.shortcuts);
  }
  persistRuntimeSettings();
}

function serializeRuntimeSettings(): {
  startup: StartupSettings;
  appearance: AppearanceSettings;
  terminal: TerminalSettings;
  ai: AiSettings;
  shortcuts: ShortcutSettings;
  update: UpdateSettings;
} {
  return {
    startup: { ...startupSettings.value },
    appearance: {
      themeMode: appearanceSettings.value.themeMode,
      palettes: {
        dark: { ...appearanceSettings.value.palettes.dark },
        light: { ...appearanceSettings.value.palettes.light },
      },
      transparency: { ...appearanceSettings.value.transparency },
    },
    terminal: { ...terminalSettings.value },
    ai: { ...aiSettings.value },
    shortcuts: Object.fromEntries(
      Object.entries(shortcutSettings.value).map(([shortcutId, binding]) => [
        shortcutId,
        binding === null ? null : { ...binding },
      ]),
    ),
    update: { ...updateSettings.value },
  };
}

function loadTerminalSettings(): TerminalSettings {
  return sanitizeTerminalSettings(readRuntimeSettings().terminal);
}

function loadAiSettings(): AiSettings {
  return sanitizeAiSettings(readRuntimeSettings().ai);
}

function loadShortcutSettings(): ShortcutSettings {
  return sanitizeShortcutSettings(readRuntimeSettings().shortcuts);
}

function loadUpdateSettings(): UpdateSettings {
  return sanitizeUpdateSettings(readRuntimeSettings().update);
}

function loadStartupSettings(): StartupSettings {
  return sanitizeStartupSettings(readRuntimeSettings().startup);
}

function loadAppearanceSettings(): AppearanceSettings {
  const runtimeAppearance = readRuntimeSettings().appearance;
  return runtimeAppearance === undefined
    ? readLegacyAppearanceSettings()
    : sanitizeAppearanceSettings(runtimeAppearance);
}

function readRuntimeSettings(): {
  startup?: Partial<StartupSettings>;
  appearance?: AppearanceSettingsPatch;
  terminal?: Partial<TerminalSettings>;
  ai?: Partial<AiSettings>;
  shortcuts?: unknown;
  update?: Partial<UpdateSettings>;
} {
  if (typeof localStorage === 'undefined') {
    return {};
  }
  try {
    const stored = localStorage.getItem(RUNTIME_SETTINGS_STORAGE_KEY);
    return stored
      ? (JSON.parse(stored) as {
          startup?: Partial<StartupSettings>;
          appearance?: AppearanceSettingsPatch;
          terminal?: Partial<TerminalSettings>;
          ai?: Partial<AiSettings>;
          shortcuts?: unknown;
          update?: Partial<UpdateSettings>;
        })
      : {};
  } catch {
    return {};
  }
}

function persistRuntimeSettings(): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(RUNTIME_SETTINGS_STORAGE_KEY, JSON.stringify(serializeRuntimeSettings()));
  localStorage.setItem(
    LEGACY_THEME_STORAGE_KEY,
    JSON.stringify({
      mode: appearanceSettings.value.themeMode,
      config: { palettes: appearanceSettings.value.palettes },
    }),
  );
  localStorage.setItem(
    LEGACY_WINDOW_STORAGE_KEY,
    JSON.stringify({ transparency: appearanceSettings.value.transparency }),
  );
}

function readLegacyAppearanceSettings(): AppearanceSettings {
  if (typeof localStorage === 'undefined') {
    return sanitizeAppearanceSettings();
  }
  try {
    const theme = JSON.parse(localStorage.getItem(LEGACY_THEME_STORAGE_KEY) ?? '{}') as {
      mode?: unknown;
      config?: { palettes?: AppearanceSettingsPatch['palettes'] };
    };
    const windowAppearance = JSON.parse(
      localStorage.getItem(LEGACY_WINDOW_STORAGE_KEY) ?? '{}',
    ) as { transparency?: AppearanceSettingsPatch['transparency'] };
    return sanitizeAppearanceSettings({
      themeMode: theme.mode,
      palettes: theme.config?.palettes,
      transparency: windowAppearance.transparency,
    });
  } catch {
    return sanitizeAppearanceSettings();
  }
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasOwn<T extends object>(source: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, minimum), maximum);
}

function isAiProvider(value: unknown): value is AiProvider {
  return (
    value === 'none' ||
    value === 'openai' ||
    value === 'anthropic' ||
    value === 'local' ||
    value === 'custom'
  );
}

function isAiCommandPolicy(value: unknown): value is AiCommandPolicy {
  return value === 'ask' || value === 'suggest' || value === 'auto' || value === 'fullAccess';
}

export function isAiReasoningEffort(value: unknown): value is AiReasoningEffort {
  return AI_REASONING_EFFORTS.some((reasoningEffort) => reasoningEffort === value);
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'dark' || value === 'light';
}

function sanitizeTerminalPalette(
  raw: Partial<TerminalColorPalette> | undefined,
  fallback: TerminalColorPalette,
): TerminalColorPalette {
  return {
    terminalForeground: normalizeHexColor(raw?.terminalForeground) ?? fallback.terminalForeground,
    terminalMuted: normalizeHexColor(raw?.terminalMuted) ?? fallback.terminalMuted,
  };
}

function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toLowerCase() : null;
}

function defaultBaseUrlForProvider(provider: AiProvider): string {
  switch (provider) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'anthropic':
      return 'https://api.anthropic.com';
    case 'local':
      return 'http://localhost:11434/v1';
    case 'custom':
    case 'none':
      return '';
  }
}

function defaultTokenHeaderNameForProvider(provider: AiProvider): string {
  return provider === 'anthropic' ? 'x-api-key' : 'Authorization';
}

function defaultTokenPrefixForProvider(provider: AiProvider): string {
  return provider === 'anthropic' ? '' : 'Bearer';
}
