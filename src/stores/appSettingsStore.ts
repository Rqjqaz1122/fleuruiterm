import { computed, ref } from 'vue';

import {
  sanitizeShortcutSettings,
  type AppCommand,
  type ShortcutBinding,
  type ShortcutSettings,
} from '@/services/appShortcuts';

export type SupportedAppLocale = 'en-US' | 'zh-CN';
export type AiProvider = 'none' | 'openai' | 'anthropic' | 'local' | 'custom';
export type AiCommandPolicy = 'ask' | 'suggest' | 'auto' | 'fullAccess';

export interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  scrollback: number;
  scrollOnInput: boolean;
  cursorBlink: boolean;
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
}

export interface LanguageOption {
  value: SupportedAppLocale;
  label: string;
  nativeLabel: string;
}

const RUNTIME_SETTINGS_STORAGE_KEY = 'fleurterm.runtimeSettings';

export const defaultTerminalSettings: TerminalSettings = {
  fontFamily: 'Source Code Pro, JetBrains Mono, Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.35,
  scrollback: 25_000,
  scrollOnInput: true,
  cursorBlink: true,
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

export function useAppSettingsStore() {
  return {
    aiSettings,
    languageOptions,
    shortcutSettings,
    terminalSettings,
    resetShortcutSettings,
    serializeRuntimeSettings,
    replaceRuntimeSettings,
    updateAiSettings,
    updateShortcutSetting,
    updateTerminalSettings,
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
  terminal?: Partial<TerminalSettings>;
  ai?: Partial<AiSettings>;
  shortcuts?: unknown;
}): void {
  terminalSettings.value = sanitizeTerminalSettings(settings.terminal ?? terminalSettings.value);
  aiSettings.value = sanitizeAiSettings(settings.ai ?? aiSettings.value);
  if (Object.prototype.hasOwnProperty.call(settings, 'shortcuts')) {
    shortcutSettings.value = sanitizeShortcutSettings(settings.shortcuts);
  }
  persistRuntimeSettings();
}

function serializeRuntimeSettings(): {
  terminal: TerminalSettings;
  ai: AiSettings;
  shortcuts: ShortcutSettings;
} {
  return {
    terminal: { ...terminalSettings.value },
    ai: { ...aiSettings.value },
    shortcuts: Object.fromEntries(
      Object.entries(shortcutSettings.value).map(([shortcutId, binding]) => [
        shortcutId,
        binding === null ? null : { ...binding },
      ]),
    ),
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

function readRuntimeSettings(): {
  terminal?: Partial<TerminalSettings>;
  ai?: Partial<AiSettings>;
  shortcuts?: unknown;
} {
  if (typeof localStorage === 'undefined') {
    return {};
  }
  try {
    const stored = localStorage.getItem(RUNTIME_SETTINGS_STORAGE_KEY);
    return stored
      ? (JSON.parse(stored) as {
          terminal?: Partial<TerminalSettings>;
          ai?: Partial<AiSettings>;
          shortcuts?: unknown;
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
