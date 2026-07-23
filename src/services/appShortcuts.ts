export type AppCommand =
  | 'new-terminal'
  | 'close-tab'
  | 'next-tab'
  | 'previous-tab'
  | 'open-settings'
  | 'toggle-ai'
  | 'clear-terminal';

export type ShortcutId = AppCommand;
export type ShortcutGroup = 'workspace' | 'terminal';
export type ShortcutPlatform = 'macos' | 'default';
export type ShortcutModifier = 'primary' | 'control' | 'alt';

export interface ShortcutBinding {
  key: string;
  modifier: ShortcutModifier;
  shift?: boolean;
}

export type ShortcutSettings = Partial<Record<AppCommand, ShortcutBinding | null>>;

export interface AppShortcutDefinition {
  id: ShortcutId;
  group: ShortcutGroup;
  defaultBinding: ShortcutBinding;
  editable: boolean;
}

export const APP_SHORTCUTS: readonly AppShortcutDefinition[] = [
  applicationShortcut('new-terminal', 'workspace', 't'),
  applicationShortcut('close-tab', 'workspace', 'w'),
  applicationShortcut('next-tab', 'workspace', 'Tab', 'control'),
  applicationShortcut('previous-tab', 'workspace', 'Tab', 'control', true),
  applicationShortcut('open-settings', 'workspace', ','),
  applicationShortcut('toggle-ai', 'workspace', 'a', 'primary', true),
  applicationShortcut('clear-terminal', 'terminal', 'k'),
];

const EDITABLE_SHORTCUT_IDS = new Set<AppCommand>(
  APP_SHORTCUTS.filter((shortcutDefinition) => shortcutDefinition.editable).map(
    (shortcutDefinition) => shortcutDefinition.id as AppCommand,
  ),
);

export function resolveAppShortcut(
  event: KeyboardEvent,
  settings: ShortcutSettings = {},
  platform: ShortcutPlatform = inferShortcutPlatform(),
): AppCommand | null {
  if (event.repeat || event.isComposing) {
    return null;
  }
  const shortcutDefinition = APP_SHORTCUTS.find((candidate) => {
    if (!candidate.editable) {
      return false;
    }
    const binding = resolveShortcutBinding(candidate.id as AppCommand, settings);
    return binding !== null && matchesBinding(binding, event, platform);
  });
  return shortcutDefinition === undefined ? null : (shortcutDefinition.id as AppCommand);
}

export function resolveShortcutBinding(
  shortcutId: AppCommand,
  settings: ShortcutSettings,
): ShortcutBinding | null {
  if (Object.prototype.hasOwnProperty.call(settings, shortcutId)) {
    return settings[shortcutId] ?? null;
  }
  return shortcutDefinition(shortcutId).defaultBinding;
}

export function captureShortcutBinding(
  event: KeyboardEvent,
  platform: ShortcutPlatform,
): ShortcutBinding | null {
  const key = normalizeKey(event.key);
  if (isModifierKey(key)) {
    return null;
  }
  const modifier = eventModifier(event, platform);
  if (modifier === null || (!event.metaKey && !event.ctrlKey && !event.altKey)) {
    return null;
  }
  return {
    key,
    modifier,
    ...(event.shiftKey ? { shift: true } : {}),
  };
}

export function findShortcutConflict(
  shortcutId: AppCommand,
  binding: ShortcutBinding,
  settings: ShortcutSettings,
  platform: ShortcutPlatform,
): AppCommand | null {
  for (const candidate of APP_SHORTCUTS) {
    if (!candidate.editable || candidate.id === shortcutId) {
      continue;
    }
    const candidateId = candidate.id as AppCommand;
    const candidateBinding = resolveShortcutBinding(candidateId, settings);
    if (
      candidateBinding !== null &&
      physicalBindingKey(candidateBinding, platform) === physicalBindingKey(binding, platform)
    ) {
      return candidateId;
    }
  }
  return null;
}

export function formatShortcutKeys(binding: ShortcutBinding, platform: ShortcutPlatform): string[] {
  const modifier = formatModifier(binding.modifier, platform);
  return [
    modifier,
    ...(binding.shift ? [platform === 'macos' ? '⇧' : 'Shift'] : []),
    formatKey(binding.key),
  ];
}

export function sanitizeShortcutSettings(raw: unknown): ShortcutSettings {
  if (!isRecord(raw)) {
    return {};
  }
  const settings: ShortcutSettings = {};
  for (const [shortcutId, value] of Object.entries(raw)) {
    if (!isAppCommand(shortcutId)) {
      continue;
    }
    if (value === null) {
      settings[shortcutId] = null;
      continue;
    }
    if (!isRecord(value)) {
      continue;
    }
    const key = typeof value.key === 'string' ? normalizeKey(value.key) : '';
    if (!key || isModifierKey(key) || !isShortcutModifier(value.modifier)) {
      continue;
    }
    settings[shortcutId] = {
      key,
      modifier: value.modifier,
      ...(value.shift === true ? { shift: true } : {}),
    };
  }
  return settings;
}

function applicationShortcut(
  id: AppCommand,
  group: ShortcutGroup,
  key: string,
  modifier: ShortcutModifier = 'primary',
  shift = false,
): AppShortcutDefinition {
  return {
    id,
    group,
    defaultBinding: { key, modifier, ...(shift ? { shift: true } : {}) },
    editable: true,
  };
}

function shortcutDefinition(shortcutId: AppCommand): AppShortcutDefinition {
  const definition = APP_SHORTCUTS.find((candidate) => candidate.id === shortcutId);
  if (definition === undefined) {
    throw new Error(`Unknown application shortcut: ${shortcutId}`);
  }
  return definition;
}

function matchesBinding(
  binding: ShortcutBinding,
  event: KeyboardEvent,
  platform: ShortcutPlatform,
): boolean {
  const expectedMeta = binding.modifier === 'primary' && platform === 'macos';
  const expectedControl =
    binding.modifier === 'control' || (binding.modifier === 'primary' && platform === 'default');
  const expectedAlt = binding.modifier === 'alt';
  return (
    normalizeKey(event.key) === binding.key &&
    event.metaKey === expectedMeta &&
    event.ctrlKey === expectedControl &&
    event.altKey === expectedAlt &&
    event.shiftKey === Boolean(binding.shift)
  );
}

function eventModifier(event: KeyboardEvent, platform: ShortcutPlatform): ShortcutModifier | null {
  const modifierCount = Number(event.metaKey) + Number(event.ctrlKey) + Number(event.altKey);
  if (modifierCount !== 1) {
    return null;
  }
  if (event.metaKey) {
    return platform === 'macos' ? 'primary' : null;
  }
  if (event.ctrlKey) {
    return platform === 'macos' ? 'control' : 'primary';
  }
  return event.altKey ? 'alt' : null;
}

function physicalBindingKey(binding: ShortcutBinding, platform: ShortcutPlatform): string {
  return [
    formatModifier(binding.modifier, platform),
    binding.shift ? 'shift' : '',
    binding.key,
  ].join(':');
}

function formatModifier(modifier: ShortcutModifier, platform: ShortcutPlatform): string {
  switch (modifier) {
    case 'primary':
      return platform === 'macos' ? '⌘' : 'Ctrl';
    case 'control':
      return platform === 'macos' ? '⌃' : 'Ctrl';
    case 'alt':
      return platform === 'macos' ? '⌥' : 'Alt';
  }
}

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

function formatKey(key: string): string {
  if (key === 'Tab') {
    return 'Tab';
  }
  if (key === ',') {
    return ',';
  }
  return key.length === 1 ? key.toUpperCase() : key;
}

function isModifierKey(key: string): boolean {
  return key === 'Meta' || key === 'Control' || key === 'Alt' || key === 'Shift';
}

function isShortcutModifier(value: unknown): value is ShortcutModifier {
  return value === 'primary' || value === 'control' || value === 'alt';
}

function isAppCommand(value: string): value is AppCommand {
  return EDITABLE_SHORTCUT_IDS.has(value as AppCommand);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inferShortcutPlatform(): ShortcutPlatform {
  if (typeof navigator === 'undefined') {
    return 'default';
  }
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? 'macos' : 'default';
}
