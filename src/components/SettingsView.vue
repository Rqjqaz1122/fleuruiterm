<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import AppDialog from '@/components/AppDialog.vue';
import AppSelect from '@/components/AppSelect.vue';
import SoftwareUpdateCard from '@/components/SoftwareUpdateCard.vue';
import { locale, setLocale, t, type AppLocale } from '@/i18n/locale';
import {
  APP_SHORTCUTS,
  captureShortcutBinding,
  findShortcutConflict,
  formatShortcutKeys,
  resolveShortcutBinding,
  sanitizeShortcutSettings,
  type AppCommand,
  type AppShortcutDefinition,
  type ShortcutBinding,
  type ShortcutPlatform,
  type ShortcutSettings,
} from '@/services/appShortcuts';
import { detectDesktopPlatform } from '@/services/desktopPlatform';
import {
  CONNECTIONS_STORAGE_KEY,
  notifySavedConnectionProfilesChanged,
} from '@/services/connectionProfiles';
import { settingsClient } from '@/services/settingsClient';
import {
  defaultTerminalSettings,
  defaultAppearanceSettings,
  defaultsForAiProvider,
  sanitizeAiSettings,
  sanitizeTerminalSettings,
  sanitizeUpdateSettings,
  useAppSettingsStore,
  type AiCommandPolicy,
  type AiProvider,
  type AiSettings,
  type TerminalColorPalette,
  type TerminalSettings,
  type ThemeMode,
  type ThemeTone,
  type StartupSettings,
  type UpdateSettings,
} from '@/stores/appSettingsStore';

type SettingsSectionId =
  'general' | 'appearance' | 'terminal' | 'connections' | 'hotkeys' | 'ai' | 'advanced';
interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  title: string;
  iconPath: string;
}
type ConnectionMethod = 'ssh' | 'telnet' | 'serial' | 'local';
type AuthMethod = 'auto' | 'password' | 'publicKey' | 'agent' | 'keyboardInteractive';
type SessionEndBehavior = 'auto' | 'keep' | 'reconnect' | 'close';
type ColorScheme = 'auto' | 'green' | 'amber' | 'blue' | 'monochrome';
type ConnectionDialogIntent = 'create' | 'edit';
type ConnectionFormTabId = 'general' | 'authentication' | 'ports' | 'advanced';

export interface WorkbenchConnection {
  id: string;
  name: string;
  group: string;
  icon: string;
  color: string;
  method: ConnectionMethod;
  host: string;
  user: string;
  port: number;
  status: 'online' | 'warning' | 'offline';
  latency: string;
  lastSeen: 'justNow' | 'twoMinutes' | 'fiveMinutes' | 'idle';
  tags: string[];
  shell: string;
  adapter: string;
  fingerprint: string;
  disableDynamicTitle: boolean;
  behaviorOnSessionEnd: SessionEndBehavior;
  clearServiceMessagesOnConnect: boolean;
  authMethod: AuthMethod;
  password: string;
  hasPassword: boolean;
  privateKeys: string[];
  loginScripts: string;
  terminalColorScheme: ColorScheme;
  forwardedPorts: string[];
  cwd: string;
  serialPath: string;
  baudRate: number;
}

type ConnectionDraft = Omit<
  WorkbenchConnection,
  'id' | 'status' | 'latency' | 'lastSeen' | 'tags' | 'adapter'
>;
type WindowAppearanceConfig = { transparency: { enabled: boolean; opacity: number; blur: number } };
type ThemeConfigFile = {
  palettes: Record<ThemeTone, TerminalColorPalette>;
};
type AdvancedAiSettings = Omit<AiSettings, 'token'>;

const RECENT_CONNECTIONS_STORAGE_KEY = 'fleurterm.recentConnections';
const THEME_STORAGE_KEY = 'fleurterm.theme';
const WINDOW_STORAGE_KEY = 'fleurterm.window';
const COMMON_TERMINAL_FONT_OPTIONS = [
  { value: 'Source Code Pro, monospace', label: 'Source Code Pro' },
  { value: 'JetBrains Mono, monospace', label: 'JetBrains Mono' },
  { value: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace', label: 'SF Mono' },
  { value: 'Menlo, Monaco, Consolas, monospace', label: 'Menlo' },
  { value: 'Monaco, Consolas, monospace', label: 'Monaco' },
  { value: 'Cascadia Code, Consolas, monospace', label: 'Cascadia Code' },
  { value: 'Fira Code, monospace', label: 'Fira Code' },
  { value: 'Consolas, monospace', label: 'Consolas' },
];

const emit = defineEmits<{
  openConnection: [connection: WorkbenchConnection];
}>();

const defaultTheme: ThemeConfigFile = {
  palettes: {
    dark: { ...defaultAppearanceSettings.palettes.dark },
    light: { ...defaultAppearanceSettings.palettes.light },
  },
};
const defaultWindowAppearance: WindowAppearanceConfig = {
  transparency: { ...defaultAppearanceSettings.transparency },
};
const connectionTextInputAttributes = {
  autocomplete: 'off',
  autocapitalize: 'none',
  autocorrect: 'off',
  spellcheck: false,
} as const;
const defaultLocalConnection: WorkbenchConnection = {
  id: 'local-shell',
  name: 'Local Shell',
  group: 'default',
  icon: 'fas fa-desktop',
  color: '#000000',
  method: 'local',
  host: 'localhost',
  user: 'local',
  port: 0,
  status: 'online',
  latency: '--',
  lastSeen: 'justNow',
  tags: [],
  shell: '',
  adapter: 'local',
  fingerprint: '',
  disableDynamicTitle: false,
  behaviorOnSessionEnd: 'auto',
  clearServiceMessagesOnConnect: false,
  authMethod: 'auto',
  password: '',
  hasPassword: false,
  privateKeys: [],
  loginScripts: '',
  terminalColorScheme: 'auto',
  forwardedPorts: [],
  cwd: '',
  serialPath: '',
  baudRate: 115200,
};

const selectedSectionId = ref<SettingsSectionId>('general');
const collapsedGroups = ref<Record<string, boolean>>({});
const connectionFilter = ref('');
const settingsReady = ref(!settingsClient.available);
const appSettings = useAppSettingsStore();
if (hasLegacyAppearanceSettings()) {
  appSettings.updateAppearanceSettings({
    themeMode: loadThemeMode(),
    palettes: loadThemeConfig().palettes,
    transparency: loadWindowAppearance().transparency,
  });
}
const {
  aiSettings,
  appearanceSettings,
  shortcutSettings,
  startupSettings,
  terminalSettings,
  updateSettings,
} = appSettings;
const connections = ref<WorkbenchConnection[]>(loadConnections());
const recentConnectionIds = ref<string[]>(loadRecentConnectionIds(connections.value));
const themeMode = computed<ThemeMode>({
  get: () => appearanceSettings.value.themeMode,
  set: (nextThemeMode) => appSettings.updateAppearanceSettings({ themeMode: nextThemeMode }),
});
const configTheme = computed<ThemeConfigFile>({
  get: () => ({ palettes: appearanceSettings.value.palettes }),
  set: (nextTheme) => appSettings.updateAppearanceSettings({ palettes: nextTheme.palettes }),
});
const terminalPaletteTone = ref<ThemeTone>(themeMode.value === 'light' ? 'light' : 'dark');
const windowAppearance = computed<WindowAppearanceConfig>({
  get: () => ({ transparency: appearanceSettings.value.transparency }),
  set: (nextWindowAppearance) =>
    appSettings.updateAppearanceSettings({
      transparency: nextWindowAppearance.transparency,
    }),
});
const settingsEditorValue = ref('');
const settingsEditorStatus = ref<{ kind: 'success' | 'error'; message: string } | null>(null);
const dialogIntent = ref<ConnectionDialogIntent | null>(null);
const editingConnectionId = ref<string | null>(null);
const draft = ref<ConnectionDraft>(createEmptyDraft());
const activeFormTab = ref<ConnectionFormTabId>('general');
const privateKeyInput = ref('');
const passwordDialogOpen = ref(false);
const passwordValue = ref('');
const passwordChanged = ref(false);
const credentialPersistenceError = ref('');
const recordingShortcutId = ref<AppCommand | null>(null);
const shortcutError = ref('');
const selectedLocale = computed<AppLocale>({
  get: () => locale.value,
  set: (nextLocale) => setLocale(nextLocale),
});

function toggleAutomaticUpdateDownloads(): void {
  appSettings.updateUpdateSettings({
    automaticDownloadEnabled: !updateSettings.value.automaticDownloadEnabled,
  });
}

const labels = computed(() => (selectedLocale.value === 'zh-CN' ? zhLabels : enLabels));
const shortcutPlatform: ShortcutPlatform =
  detectDesktopPlatform() === 'macos' ? 'macos' : 'default';
const shortcutGroups = computed(() =>
  (['workspace', 'terminal'] as const).map((group) => ({
    id: group,
    label: labels.value.hotkeyGroups[group],
    shortcuts: APP_SHORTCUTS.filter((shortcutDefinition) => shortcutDefinition.group === group),
  })),
);
const terminalPalette = computed(() => configTheme.value.palettes[terminalPaletteTone.value]);
const terminalPreviewStyle = computed<Record<string, string>>(() => ({
  '--terminal-preview-bg': terminalPaletteTone.value === 'light' ? '#ffffff' : '#202020',
  '--terminal-preview-fg': terminalPalette.value.terminalForeground,
  '--terminal-preview-muted': terminalPalette.value.terminalMuted,
}));
const languageOptions = computed(() =>
  appSettings.languageOptions.value.map((option) => ({
    value: option.value,
    label: `${option.label} / ${option.nativeLabel}`,
  })),
);
const terminalFontOptions = computed(() => {
  const options = [
    {
      value: defaultTerminalSettings.fontFamily,
      label: labels.value.terminalFontDefault,
    },
    ...COMMON_TERMINAL_FONT_OPTIONS,
    { value: 'monospace', label: labels.value.terminalFontSystem },
  ];
  const configuredFont = terminalSettings.value.fontFamily;
  return options.some((option) => option.value === configuredFont)
    ? options
    : [{ value: configuredFont, label: configuredFont }, ...options];
});
const sections = computed<SettingsSection[]>(() => [
  {
    id: 'general',
    label: labels.value.nav.general,
    title: labels.value.languageCardTitle,
    iconPath: 'M4 5h16v14H4V5Zm0 4h16',
  },
  {
    id: 'appearance',
    label: labels.value.nav.appearance,
    title: labels.value.appearanceCardTitle,
    iconPath:
      'M12 3a9 9 0 1 0 0 18h1.4a2.1 2.1 0 0 0 0-4.2H12a1.8 1.8 0 0 1 0-3.6h2.4A6.6 6.6 0 0 0 12 3Z',
  },
  {
    id: 'terminal',
    label: labels.value.nav.terminal,
    title: labels.value.terminalSectionTitle,
    iconPath: 'm5 7 5 5-5 5m7 0h7',
  },
  {
    id: 'connections',
    label: labels.value.nav.connections,
    title: labels.value.connectionsSectionTitle,
    iconPath: 'M5 6h14v4H5V6Zm0 8h14v4H5v-4Zm3-6h.01M8 16h.01',
  },
  {
    id: 'hotkeys',
    label: labels.value.nav.hotkeys,
    title: labels.value.hotkeysSectionTitle,
    iconPath: 'M4 7h16v10H4V7Zm3 3h.01M10 10h.01M13 10h.01M16 10h.01M8 14h8',
  },
  {
    id: 'ai',
    label: labels.value.nav.ai,
    title: labels.value.aiSectionTitle,
    iconPath:
      'm12 3 1.35 4.65L18 9l-4.65 1.35L12 15l-1.35-4.65L6 9l4.65-1.35L12 3Zm6 11 .7 2.3L21 17l-2.3.7L18 20l-.7-2.3L15 17l2.3-.7L18 14Z',
  },
  {
    id: 'advanced',
    label: labels.value.nav.advanced,
    title: labels.value.configTitle,
    iconPath: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  },
]);
const activeSection = computed(
  () =>
    sections.value.find((section) => section.id === selectedSectionId.value) ?? sections.value[0],
);
const connectionGroups = computed(() =>
  Array.from(new Set(connections.value.map((connection) => connection.group))).sort((left, right) =>
    left.localeCompare(right),
  ),
);
const groupedConnections = computed(() => {
  const normalizedFilter = connectionFilter.value.trim().toLowerCase();
  return connectionGroups.value
    .map((group) => ({
      group,
      items: connections.value.filter((connection) => {
        if (connection.group !== group) {
          return false;
        }
        if (!normalizedFilter) {
          return true;
        }
        return [
          connection.group,
          connection.name,
          connection.user,
          connection.host,
          connection.method,
          methodLabel(connection.method),
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedFilter);
      }),
    }))
    .filter((group) => group.items.length > 0);
});
const showDialog = computed(() => dialogIntent.value !== null);
const editingConnection = computed(() =>
  editingConnectionId.value === null
    ? null
    : (connections.value.find((connection) => connection.id === editingConnectionId.value) ?? null),
);
const supportsPorts = computed(
  () => draft.value.method === 'ssh' || draft.value.method === 'telnet',
);
const supportsAdvanced = computed(
  () => draft.value.method === 'ssh' || draft.value.method === 'telnet',
);
const supportsAuth = computed(
  () => draft.value.method === 'ssh' || draft.value.method === 'telnet',
);
const showsPasswordTools = computed(() =>
  ['auto', 'password', 'keyboardInteractive'].includes(draft.value.authMethod),
);
const showsPrivateKeyTools = computed(
  () => draft.value.authMethod === 'auto' || draft.value.authMethod === 'publicKey',
);
const formTabs = computed<Array<{ id: ConnectionFormTabId; label: string }>>(() => [
  { id: 'general', label: labels.value.dialog.tabs.general },
  { id: 'authentication', label: labels.value.dialog.tabs.authentication },
  { id: 'ports', label: labels.value.dialog.tabs.ports },
  { id: 'advanced', label: labels.value.dialog.tabs.advanced },
]);
const aiProviderOptions = computed(() =>
  aiProviders.map((provider) => ({
    value: provider,
    label: labels.value.aiProviderOptions[provider],
  })),
);
const aiCommandPolicyOptions = computed(() =>
  aiCommandPolicies.map((policy) => ({
    value: policy,
    label: labels.value.aiPolicyOptions[policy],
  })),
);
const draftEndpoint = computed(() => {
  if (draft.value.method === 'local') {
    return draft.value.cwd.trim() || 'localhost';
  }
  if (draft.value.method === 'serial') {
    return draft.value.serialPath.trim() || labels.value.connectionMeta.serialDevice;
  }
  const user = draft.value.user.trim() || labels.value.connectionMeta.defaultUser;
  const host = draft.value.host.trim() || 'host';
  const port = draft.value.port > 0 ? `:${draft.value.port}` : '';
  return `${user}@${host}${port}`;
});
const draftIdentity = computed(
  () => draft.value.name.trim() || labels.value.dialog.unnamedConnection,
);

watch(
  [
    connections,
    recentConnectionIds,
    selectedLocale,
    startupSettings,
    themeMode,
    configTheme,
    windowAppearance,
    terminalSettings,
    aiSettings,
    shortcutSettings,
    updateSettings,
  ],
  () => {
    if (!settingsReady.value) {
      return;
    }
    persistAll();
    settingsEditorValue.value = buildSettingsEditorValue();
  },
  { deep: true, immediate: true },
);

watch(themeMode, (mode) => {
  if (mode === 'dark' || mode === 'light') {
    terminalPaletteTone.value = mode;
  }
});

if (settingsClient.available) {
  void hydrateSettings();
}

if (typeof window !== 'undefined') {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (recordingShortcutId.value !== null) {
      recordShortcut(event);
      return;
    }
    if (event.key === 'Escape') {
      if (passwordDialogOpen.value) {
        closePasswordDialog();
      } else {
        closeDialog();
      }
    }
  };
  window.addEventListener('keydown', handleKeyDown);
  onBeforeUnmount(() => window.removeEventListener('keydown', handleKeyDown));
}

async function hydrateSettings(): Promise<void> {
  const payload = await settingsClient.load();
  const savedLocale = payload?.settings?.locale;
  const workbench = payload?.settings?.workbench as
    { connections?: WorkbenchConnection[]; recentConnectionIds?: string[] } | undefined;
  const theme = payload?.settings?.theme as
    { mode?: ThemeMode; config?: ThemeConfigFile } | undefined;
  const windowConfig = payload?.settings?.window as WindowAppearanceConfig | undefined;
  const startupConfig = payload?.settings?.startup as Partial<StartupSettings> | undefined;
  const terminalConfig = payload?.settings?.terminal as Partial<TerminalSettings> | undefined;
  const aiConfig = payload?.settings?.ai as Partial<AiSettings> | undefined;
  const shortcutConfig = payload?.settings?.shortcuts;
  const updateConfig = payload?.settings?.update as Partial<UpdateSettings> | undefined;

  if (savedLocale === 'en-US' || savedLocale === 'zh-CN') {
    setLocale(savedLocale);
  }
  appSettings.replaceRuntimeSettings({
    startup: startupConfig,
    appearance: {
      ...(isThemeMode(theme?.mode) ? { themeMode: theme.mode } : {}),
      ...(theme?.config ? { palettes: normalizeThemeConfig(theme.config).palettes } : {}),
      ...(windowConfig
        ? { transparency: sanitizeWindowAppearance(windowConfig).transparency }
        : {}),
    },
    terminal: terminalConfig,
    ai: aiConfig,
    shortcuts: shortcutConfig,
    update: updateConfig,
  });
  if (Array.isArray(workbench?.connections)) {
    connections.value = normalizeConnectionList(workbench.connections);
  }
  if (Array.isArray(workbench?.recentConnectionIds)) {
    recentConnectionIds.value = workbench.recentConnectionIds.filter((id) =>
      connections.value.some((connection) => connection.id === id),
    );
  }

  settingsReady.value = true;
}

function selectSection(sectionId: SettingsSectionId): void {
  selectedSectionId.value = sectionId;
  settingsEditorStatus.value = null;
}

function toggleGroup(group: string): void {
  collapsedGroups.value = {
    ...collapsedGroups.value,
    [group]: !collapsedGroups.value[group],
  };
}

function openConnection(connection: WorkbenchConnection): void {
  if (connection.hasPassword && !connection.password) {
    void loadStoredPasswordAndOpen(connection);
    return;
  }
  emitConnection(connection);
}

async function loadStoredPasswordAndOpen(connection: WorkbenchConnection): Promise<void> {
  try {
    const passwords = await settingsClient.loadPasswords([connection.id]);
    const password = passwords[connection.id];
    if (!password) {
      openPasswordReplacement(connection, labels.value.dialog.credentialPasswordNotFound);
      return;
    }
    emitConnection({ ...connection, password });
  } catch {
    openPasswordReplacement(connection, labels.value.dialog.credentialOperationFailed);
  }
}

function openPasswordReplacement(connection: WorkbenchConnection, message: string): void {
  startEditConnection(connection.id);
  credentialPersistenceError.value = message;
  passwordValue.value = '';
  passwordDialogOpen.value = true;
}

function emitConnection(connection: WorkbenchConnection): void {
  recentConnectionIds.value = [
    connection.id,
    ...recentConnectionIds.value.filter((connectionId) => connectionId !== connection.id),
  ].slice(0, 8);
  emit('openConnection', connection);
}

function startCreateConnection(): void {
  dialogIntent.value = 'create';
  editingConnectionId.value = null;
  draft.value = createEmptyDraft();
  activeFormTab.value = 'general';
  privateKeyInput.value = '';
  passwordChanged.value = false;
  credentialPersistenceError.value = '';
}

function startEditConnection(connectionId: string): void {
  const connection = connections.value.find((candidate) => candidate.id === connectionId);
  if (!connection) {
    return;
  }
  dialogIntent.value = 'edit';
  editingConnectionId.value = connectionId;
  draft.value = createDraftFromConnection(connection);
  activeFormTab.value = 'general';
  privateKeyInput.value = '';
  passwordChanged.value = false;
  credentialPersistenceError.value = '';
}

function closeDialog(): void {
  dialogIntent.value = null;
  editingConnectionId.value = null;
  passwordDialogOpen.value = false;
  passwordValue.value = '';
  passwordChanged.value = false;
  credentialPersistenceError.value = '';
}

function updateDraft<Key extends keyof ConnectionDraft>(
  key: Key,
  value: ConnectionDraft[Key],
): void {
  const nextDraft = { ...draft.value, [key]: value };
  if (key === 'method') {
    const method = value as ConnectionMethod;
    if (method === 'local') {
      nextDraft.port = 0;
    } else if (method === 'serial') {
      nextDraft.port = 0;
    } else if (method === 'telnet' && (!nextDraft.port || nextDraft.port === 22)) {
      nextDraft.port = 23;
    } else if (method === 'ssh' && (!nextDraft.port || nextDraft.port === 23)) {
      nextDraft.port = 22;
    }
  }
  draft.value = nextDraft;
}

function navigateConnectionFormTabs(event: KeyboardEvent, currentTabId: ConnectionFormTabId): void {
  const navigationKeys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!navigationKeys.includes(event.key)) {
    return;
  }

  const tabs = formTabs.value;
  const currentIndex = tabs.findIndex((tab) => tab.id === currentTabId);
  if (currentIndex < 0) {
    return;
  }

  let nextIndex = currentIndex;
  switch (event.key) {
    case 'ArrowLeft':
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      break;
    case 'ArrowRight':
      nextIndex = (currentIndex + 1) % tabs.length;
      break;
    case 'Home':
      nextIndex = 0;
      break;
    case 'End':
      nextIndex = tabs.length - 1;
      break;
  }

  event.preventDefault();
  activeFormTab.value = tabs[nextIndex].id;
  const tabButtons = (
    event.currentTarget as HTMLButtonElement
  ).parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  tabButtons?.item(nextIndex).focus();
}

function saveDraft(): void {
  void saveDraftAfterCredentialPersistence();
}

async function saveDraftAfterCredentialPersistence(): Promise<void> {
  if (!isDraftValid(draft.value)) {
    return;
  }
  const normalized = normalizeDraft(draft.value);
  const savedId = editingConnectionId.value ?? uniqueConnectionId(normalized);
  const nextConnection: WorkbenchConnection = {
    ...defaultLocalConnection,
    ...normalized,
    id: savedId,
    adapter: normalized.method,
    status: 'online',
    latency: '--',
    lastSeen: 'justNow',
    tags: [],
    hasPassword: normalized.hasPassword,
    password: normalized.password,
  };

  const applyDraft = (): void => {
    connections.value =
      editingConnectionId.value === null
        ? [...connections.value, nextConnection]
        : connections.value.map((connection) =>
            connection.id === editingConnectionId.value
              ? { ...connection, ...nextConnection }
              : connection,
          );
    closeDialog();
  };

  if (!passwordChanged.value) {
    applyDraft();
    return;
  }

  if (!settingsClient.available) {
    void persistPassword(savedId, normalized.password);
    applyDraft();
    return;
  }

  const persistAndApplyDraft = async (): Promise<void> => {
    await persistPassword(savedId, normalized.password);
    applyDraft();
  };

  try {
    await persistAndApplyDraft();
  } catch {
    credentialPersistenceError.value = labels.value.dialog.credentialOperationFailed;
  }
}

function deleteConnection(connectionId: string): void {
  if (connectionId === defaultLocalConnection.id) {
    return;
  }
  const connection = connections.value.find((candidate) => candidate.id === connectionId);
  const removeConnection = async (): Promise<void> => {
    if (connection?.hasPassword) {
      await settingsClient.deletePassword(connectionId);
    }
    connections.value = connections.value.filter((candidate) => candidate.id !== connectionId);
    recentConnectionIds.value = recentConnectionIds.value.filter((id) => id !== connectionId);
    closeDialog();
  };
  void removeConnection().catch(() => {
    credentialPersistenceError.value = labels.value.dialog.credentialOperationFailed;
  });
}

function addPrivateKey(): void {
  const nextKey = privateKeyInput.value.trim();
  if (!nextKey || draft.value.privateKeys.includes(nextKey)) {
    return;
  }
  updateDraft('privateKeys', [...draft.value.privateKeys, nextKey]);
  privateKeyInput.value = '';
}

function openPasswordDialog(): void {
  if (draft.value.hasPassword && !draft.value.password && editingConnectionId.value !== null) {
    const connectionId = editingConnectionId.value;
    void settingsClient
      .loadPasswords([connectionId])
      .then((passwords) => {
        passwordValue.value = passwords[connectionId] ?? '';
        passwordDialogOpen.value = true;
      })
      .catch(() => {
        credentialPersistenceError.value = labels.value.dialog.credentialOperationFailed;
      });
    return;
  }
  passwordValue.value = draft.value.password;
  passwordDialogOpen.value = true;
}

function confirmPassword(): void {
  const password = passwordValue.value;
  updateDraft('password', password);
  updateDraft('hasPassword', Boolean(password.trim()));
  passwordChanged.value = true;
  closePasswordDialog();
}

function closePasswordDialog(): void {
  passwordDialogOpen.value = false;
  passwordValue.value = '';
}

function forgetPassword(): void {
  updateDraft('password', '');
  updateDraft('hasPassword', false);
  passwordValue.value = '';
  passwordChanged.value = true;
}

function resetTerminalColors(): void {
  const tone = terminalPaletteTone.value;
  configTheme.value = {
    palettes: {
      ...configTheme.value.palettes,
      [tone]: { ...defaultTheme.palettes[tone] },
    },
  };
}

function updateThemePaletteColor(colorKey: keyof TerminalColorPalette, value: string): void {
  const normalized = normalizeHexColor(value);
  if (!normalized) {
    return;
  }
  const tone = terminalPaletteTone.value;
  configTheme.value = {
    palettes: {
      ...configTheme.value.palettes,
      [tone]: {
        ...configTheme.value.palettes[tone],
        [colorKey]: normalized,
      },
    },
  };
}

function updateWindowTransparency(
  nextTransparency: Partial<WindowAppearanceConfig['transparency']>,
): void {
  windowAppearance.value = sanitizeWindowAppearance({
    transparency: {
      ...windowAppearance.value.transparency,
      ...nextTransparency,
    },
  });
}

function updateTerminalSetting<Key extends keyof TerminalSettings>(
  key: Key,
  value: TerminalSettings[Key],
): void {
  appSettings.updateTerminalSettings({ [key]: value } as Partial<TerminalSettings>);
}

function resetTerminalSettings(): void {
  appSettings.updateTerminalSettings(defaultTerminalSettings);
}

function shortcutBindingFor(shortcutDefinition: AppShortcutDefinition): ShortcutBinding | null {
  return shortcutDefinition.editable
    ? resolveShortcutBinding(shortcutDefinition.id as AppCommand, shortcutSettings.value)
    : shortcutDefinition.defaultBinding;
}

function shortcutKeysFor(shortcutDefinition: AppShortcutDefinition): string[] {
  const binding = shortcutBindingFor(shortcutDefinition);
  return binding === null ? [] : formatShortcutKeys(binding, shortcutPlatform);
}

function beginShortcutRecording(shortcutDefinition: AppShortcutDefinition): void {
  if (!shortcutDefinition.editable) {
    return;
  }
  recordingShortcutId.value = shortcutDefinition.id as AppCommand;
  shortcutError.value = '';
}

function recordShortcut(event: KeyboardEvent): void {
  const shortcutId = recordingShortcutId.value;
  if (shortcutId === null) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.key === 'Escape') {
    recordingShortcutId.value = null;
    shortcutError.value = '';
    return;
  }
  const binding = captureShortcutBinding(event, shortcutPlatform);
  if (binding === null) {
    shortcutError.value = labels.value.shortcutInvalid;
    return;
  }
  const conflictId = findShortcutConflict(
    shortcutId,
    binding,
    shortcutSettings.value,
    shortcutPlatform,
  );
  if (conflictId !== null) {
    shortcutError.value = labels.value.shortcutConflict.replace(
      '{action}',
      labels.value.hotkeyActions[conflictId],
    );
    return;
  }
  appSettings.updateShortcutSetting(shortcutId, binding);
  recordingShortcutId.value = null;
  shortcutError.value = '';
}

function removeShortcut(shortcutDefinition: AppShortcutDefinition): void {
  if (!shortcutDefinition.editable) {
    return;
  }
  appSettings.updateShortcutSetting(shortcutDefinition.id as AppCommand, null);
  recordingShortcutId.value = null;
  shortcutError.value = '';
}

function resetShortcutSettings(): void {
  appSettings.resetShortcutSettings();
  recordingShortcutId.value = null;
  shortcutError.value = '';
}

function updateAiSetting<Key extends keyof AiSettings>(key: Key, value: AiSettings[Key]): void {
  appSettings.updateAiSettings({ [key]: value } as Partial<AiSettings>);
}

function updateAiProvider(provider: AiProvider): void {
  appSettings.updateAiSettings({
    provider,
    ...defaultsForAiProvider(provider),
  });
}

function resetSettingsEditor(): void {
  settingsEditorValue.value = buildSettingsEditorValue();
  settingsEditorStatus.value = null;
}

function applySettingsEditor(): void {
  try {
    const parsed = parseSettingsEditorValue(settingsEditorValue.value);
    setLocale(parsed.locale);
    appSettings.replaceRuntimeSettings({
      startup: parsed.startup,
      appearance: {
        themeMode: parsed.theme.mode,
        palettes: parsed.theme.config.palettes,
        transparency: parsed.window.transparency,
      },
      terminal: parsed.terminal,
      ai: parsed.ai,
      shortcuts: parsed.shortcuts,
      update: parsed.update,
    });
    connections.value = normalizeConnectionList(parsed.workbench.connections);
    recentConnectionIds.value = parsed.workbench.recentConnectionIds.filter((connectionId) =>
      connections.value.some((connection) => connection.id === connectionId),
    );
    settingsEditorStatus.value = { kind: 'success', message: labels.value.configEditorSaved };
  } catch (error) {
    settingsEditorStatus.value = {
      kind: 'error',
      message: `${labels.value.configEditorError} ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function createEmptyDraft(): ConnectionDraft {
  return {
    name: '',
    group: 'default',
    icon: 'fas fa-desktop',
    color: '#000000',
    method: 'ssh',
    host: '',
    user: '',
    port: 22,
    shell: '',
    fingerprint: '',
    disableDynamicTitle: false,
    behaviorOnSessionEnd: 'auto',
    clearServiceMessagesOnConnect: false,
    authMethod: 'auto',
    password: '',
    hasPassword: false,
    privateKeys: [],
    loginScripts: '',
    terminalColorScheme: 'auto',
    forwardedPorts: [],
    cwd: '',
    serialPath: '',
    baudRate: 115200,
  };
}

function createDraftFromConnection(connection: WorkbenchConnection): ConnectionDraft {
  return {
    name: connection.name,
    group: connection.group,
    icon: connection.icon,
    color: connection.color,
    method: connection.method,
    host: connection.method === 'serial' ? '' : connection.host,
    user: connection.user,
    port: connection.port || (connection.method === 'telnet' ? 23 : 22),
    shell: connection.shell,
    fingerprint: connection.fingerprint,
    disableDynamicTitle: connection.disableDynamicTitle,
    behaviorOnSessionEnd: connection.behaviorOnSessionEnd,
    clearServiceMessagesOnConnect: connection.clearServiceMessagesOnConnect,
    authMethod: connection.authMethod,
    password: connection.password,
    hasPassword: connection.hasPassword,
    privateKeys: [...connection.privateKeys],
    loginScripts: connection.loginScripts,
    terminalColorScheme: connection.terminalColorScheme,
    forwardedPorts: [...connection.forwardedPorts],
    cwd: connection.cwd,
    serialPath: connection.serialPath,
    baudRate: connection.baudRate,
  };
}

function normalizeDraft(rawDraft: ConnectionDraft): ConnectionDraft {
  return {
    ...rawDraft,
    name: rawDraft.name.trim(),
    group: rawDraft.group.trim() || 'default',
    icon: rawDraft.icon.trim() || 'fas fa-desktop',
    color: normalizeHexColor(rawDraft.color) ?? '#000000',
    host: rawDraft.method === 'local' ? 'localhost' : rawDraft.host.trim(),
    user: rawDraft.method === 'local' ? rawDraft.user.trim() || 'local' : rawDraft.user.trim(),
    port:
      rawDraft.method === 'local' || rawDraft.method === 'serial' ? 0 : Number(rawDraft.port) || 22,
    shell: rawDraft.shell.trim(),
    fingerprint: rawDraft.fingerprint.trim(),
    password: rawDraft.password.trim(),
    hasPassword: Boolean(rawDraft.hasPassword || rawDraft.password.trim()),
    privateKeys: rawDraft.privateKeys.map((key) => key.trim()).filter(Boolean),
    loginScripts: rawDraft.loginScripts.trim(),
    forwardedPorts: rawDraft.forwardedPorts.map((port) => port.trim()).filter(Boolean),
    cwd: rawDraft.cwd.trim(),
    serialPath: rawDraft.serialPath.trim(),
    baudRate: Number(rawDraft.baudRate) || 115200,
  };
}

function isDraftValid(candidate: ConnectionDraft): boolean {
  if (!candidate.name.trim()) {
    return false;
  }
  if (candidate.method === 'local') {
    return Boolean(candidate.shell.trim() || candidate.name.trim());
  }
  if (candidate.method === 'serial') {
    return Boolean(candidate.serialPath.trim() && candidate.baudRate);
  }
  return Boolean(candidate.host.trim() && candidate.user.trim());
}

function normalizeConnectionList(rawConnections: WorkbenchConnection[]): WorkbenchConnection[] {
  const normalized = rawConnections
    .filter((connection) => connection && typeof connection === 'object')
    .map((connection) => ({
      ...defaultLocalConnection,
      ...connection,
      id: String(connection.id || uniqueConnectionId(connection)),
      color: normalizeHexColor(connection.color) ?? '#000000',
      method: isConnectionMethod(connection.method) ? connection.method : 'ssh',
      authMethod: isAuthMethod(connection.authMethod) ? connection.authMethod : 'auto',
      behaviorOnSessionEnd: isSessionEndBehavior(connection.behaviorOnSessionEnd)
        ? connection.behaviorOnSessionEnd
        : 'auto',
      terminalColorScheme: isColorScheme(connection.terminalColorScheme)
        ? connection.terminalColorScheme
        : 'auto',
      port:
        Number(connection.port) ||
        (connection.method === 'local' || connection.method === 'serial' ? 0 : 22),
      privateKeys: Array.isArray(connection.privateKeys) ? connection.privateKeys : [],
      forwardedPorts: Array.isArray(connection.forwardedPorts) ? connection.forwardedPorts : [],
      tags: Array.isArray(connection.tags) ? connection.tags : [],
      cwd: connection.cwd ?? '',
      serialPath: connection.serialPath ?? '',
      baudRate: Number(connection.baudRate) || 115200,
    }));
  return normalized.some((connection) => connection.id === defaultLocalConnection.id)
    ? normalized
    : [defaultLocalConnection, ...normalized];
}

function methodLabel(method: ConnectionMethod): string {
  return labels.value.connectionMeta.methods[method];
}

function connectionEndpoint(connection: WorkbenchConnection): string {
  if (connection.method === 'local') {
    return connection.cwd || connection.host || 'localhost';
  }
  if (connection.method === 'serial') {
    return connection.serialPath || connection.host || labels.value.connectionMeta.serialDevice;
  }
  return connection.port > 0 ? `${connection.host}:${connection.port}` : connection.host;
}

function connectionIdentity(connection: WorkbenchConnection): string {
  if (connection.method === 'local') {
    return connection.name;
  }
  return connection.user ? `${connection.user}@${connection.name}` : connection.name;
}

function uniqueConnectionId(
  connection: Pick<WorkbenchConnection | ConnectionDraft, 'name' | 'user' | 'host'>,
): string {
  const base = slugify(connection.name || `${connection.user}-${connection.host}`) || 'connection';
  let id = base;
  let suffix = 2;
  while (connections.value.some((candidate) => candidate.id === id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildSettingsEditorValue(): string {
  return JSON.stringify(
    {
      locale: locale.value,
      startup: startupSettings.value,
      theme: {
        mode: themeMode.value,
        config: configTheme.value,
      },
      window: windowAppearance.value,
      terminal: terminalSettings.value,
      ai: toAdvancedAiSettings(aiSettings.value),
      shortcuts: shortcutSettings.value,
      update: updateSettings.value,
      workbench: {
        recentConnectionIds: recentConnectionIds.value,
        connections: redactConnectionPasswords(connections.value),
      },
    },
    null,
    2,
  );
}

function parseSettingsEditorValue(source: string): {
  locale: AppLocale;
  startup: StartupSettings;
  theme: { mode: ThemeMode; config: ThemeConfigFile };
  window: WindowAppearanceConfig;
  terminal: TerminalSettings;
  ai: AiSettings;
  shortcuts: ShortcutSettings;
  update: UpdateSettings;
  workbench: { connections: WorkbenchConnection[]; recentConnectionIds: string[] };
} {
  const parsed = JSON.parse(source) as Record<string, unknown>;
  if (parsed.locale !== 'en-US' && parsed.locale !== 'zh-CN') {
    throw new Error('locale must be en-US or zh-CN');
  }
  const theme = parsed.theme as { mode?: unknown; config?: ThemeConfigFile } | undefined;
  const advancedAiSettings = (parsed.ai as Partial<AdvancedAiSettings> | undefined) ?? {};
  const workbench = parsed.workbench as
    { connections?: WorkbenchConnection[]; recentConnectionIds?: string[] } | undefined;
  if (theme !== undefined && !isThemeMode(theme.mode)) {
    throw new Error('theme.mode must be system, dark, or light');
  }
  if (
    !workbench ||
    !Array.isArray(workbench.connections) ||
    !Array.isArray(workbench.recentConnectionIds)
  ) {
    throw new Error('workbench must include connections and recentConnectionIds');
  }
  return {
    locale: parsed.locale,
    startup: {
      openTerminalOnStartup: Boolean(
        (parsed.startup as Partial<StartupSettings> | undefined)?.openTerminalOnStartup,
      ),
    },
    theme: {
      mode: theme?.mode ?? themeMode.value,
      config: normalizeThemeConfig(theme?.config ?? configTheme.value),
    },
    window: sanitizeWindowAppearance(
      (parsed.window as WindowAppearanceConfig | undefined) ?? windowAppearance.value,
    ),
    terminal: sanitizeTerminalSettings(
      (parsed.terminal as Partial<TerminalSettings> | undefined) ?? terminalSettings.value,
    ),
    ai: sanitizeAiSettings({
      ...aiSettings.value,
      ...advancedAiSettings,
      token: aiSettings.value.token,
    }),
    shortcuts: sanitizeShortcutSettings(parsed.shortcuts ?? shortcutSettings.value),
    update: sanitizeUpdateSettings(parsed.update ?? updateSettings.value),
    workbench: {
      connections: normalizeConnectionList(workbench.connections),
      recentConnectionIds: workbench.recentConnectionIds.filter(
        (item): item is string => typeof item === 'string',
      ),
    },
  };
}

function toAdvancedAiSettings(settings: AiSettings): AdvancedAiSettings {
  return {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    tokenHeaderName: settings.tokenHeaderName,
    tokenPrefix: settings.tokenPrefix,
    streamingEnabled: settings.streamingEnabled,
    contextEnabled: settings.contextEnabled,
    includeWorkingDirectory: settings.includeWorkingDirectory,
    commandPolicy: settings.commandPolicy,
  };
}

function redactConnectionPasswords(nextConnections: WorkbenchConnection[]): WorkbenchConnection[] {
  return nextConnections.map((connection) => ({
    ...connection,
    password: '',
    hasPassword: Boolean(connection.hasPassword || connection.password),
  }));
}

function persistAll(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(
      CONNECTIONS_STORAGE_KEY,
      JSON.stringify(redactConnectionPasswords(connections.value)),
    );
    notifySavedConnectionProfilesChanged();
    localStorage.setItem(RECENT_CONNECTIONS_STORAGE_KEY, JSON.stringify(recentConnectionIds.value));
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ mode: themeMode.value, config: configTheme.value }),
    );
    localStorage.setItem(WINDOW_STORAGE_KEY, JSON.stringify(windowAppearance.value));
  }
  void settingsClient
    .save({
      locale: locale.value,
      startup: startupSettings.value,
      theme: {
        mode: themeMode.value,
        config: configTheme.value,
      },
      window: windowAppearance.value,
      terminal: terminalSettings.value,
      ai: aiSettings.value,
      shortcuts: shortcutSettings.value,
      update: updateSettings.value,
      workbench: {
        connections: redactConnectionPasswords(connections.value),
        recentConnectionIds: recentConnectionIds.value,
      },
    })
    .catch(() => undefined);
}

async function persistPassword(connectionId: string, password: string): Promise<void> {
  if (password) {
    await settingsClient.savePassword(connectionId, password);
  } else {
    await settingsClient.deletePassword(connectionId);
  }
}

function loadConnections(): WorkbenchConnection[] {
  if (typeof localStorage === 'undefined') {
    return [defaultLocalConnection];
  }
  try {
    const stored = localStorage.getItem(CONNECTIONS_STORAGE_KEY);
    return stored === null
      ? [defaultLocalConnection]
      : normalizeConnectionList(JSON.parse(stored) as WorkbenchConnection[]);
  } catch {
    return [defaultLocalConnection];
  }
}

function loadRecentConnectionIds(allConnections: WorkbenchConnection[]): string[] {
  if (typeof localStorage === 'undefined') {
    return [defaultLocalConnection.id];
  }
  try {
    const stored = localStorage.getItem(RECENT_CONNECTIONS_STORAGE_KEY);
    const parsed = stored === null ? [] : (JSON.parse(stored) as string[]);
    const ids = parsed.filter((id) => allConnections.some((connection) => connection.id === id));
    return ids.length > 0 ? ids : [defaultLocalConnection.id];
  } catch {
    return [defaultLocalConnection.id];
  }
}

function loadThemeMode(): ThemeMode {
  if (typeof localStorage === 'undefined') {
    return 'dark';
  }
  try {
    const stored = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? '{}') as {
      mode?: unknown;
    };
    return isThemeMode(stored.mode) ? stored.mode : 'dark';
  } catch {
    return 'dark';
  }
}

function hasLegacyAppearanceSettings(): boolean {
  return (
    typeof localStorage !== 'undefined' &&
    (localStorage.getItem(THEME_STORAGE_KEY) !== null ||
      localStorage.getItem(WINDOW_STORAGE_KEY) !== null)
  );
}

function loadThemeConfig(): ThemeConfigFile {
  if (typeof localStorage === 'undefined') {
    return defaultTheme;
  }
  try {
    const stored = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? '{}') as {
      config?: ThemeConfigFile;
    };
    return normalizeThemeConfig(stored.config ?? defaultTheme);
  } catch {
    return defaultTheme;
  }
}

function loadWindowAppearance(): WindowAppearanceConfig {
  if (typeof localStorage === 'undefined') {
    return defaultWindowAppearance;
  }
  try {
    return sanitizeWindowAppearance(
      JSON.parse(localStorage.getItem(WINDOW_STORAGE_KEY) ?? '{}') as WindowAppearanceConfig,
    );
  } catch {
    return defaultWindowAppearance;
  }
}

function normalizeThemeConfig(config: ThemeConfigFile): ThemeConfigFile {
  const legacyConfig = config as ThemeConfigFile & {
    tone?: ThemeTone;
    palette?: Partial<TerminalColorPalette>;
  };
  const legacyTone = legacyConfig.tone === 'light' ? 'light' : 'dark';
  const legacyPalette = legacyConfig.palette;

  return {
    palettes: {
      dark: normalizeTerminalPalette(
        config?.palettes?.dark ?? (legacyTone === 'dark' ? legacyPalette : undefined),
        defaultTheme.palettes.dark,
      ),
      light: normalizeTerminalPalette(
        config?.palettes?.light ?? (legacyTone === 'light' ? legacyPalette : undefined),
        defaultTheme.palettes.light,
      ),
    },
  };
}

function normalizeTerminalPalette(
  palette: Partial<TerminalColorPalette> | undefined,
  fallback: TerminalColorPalette,
): TerminalColorPalette {
  return {
    terminalForeground:
      normalizeHexColor(palette?.terminalForeground) ?? fallback.terminalForeground,
    terminalMuted: normalizeHexColor(palette?.terminalMuted) ?? fallback.terminalMuted,
  };
}

function sanitizeWindowAppearance(config: WindowAppearanceConfig): WindowAppearanceConfig {
  return {
    transparency: {
      enabled: Boolean(config?.transparency?.enabled),
      opacity: clamp(Number(config?.transparency?.opacity ?? 100), 0, 100),
      blur: clamp(Number(config?.transparency?.blur ?? 0), 0, 32),
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : max));
}

function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toLowerCase() : null;
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'dark' || value === 'light';
}

function isConnectionMethod(value: unknown): value is ConnectionMethod {
  return value === 'ssh' || value === 'telnet' || value === 'serial' || value === 'local';
}

function isAuthMethod(value: unknown): value is AuthMethod {
  return (
    value === 'auto' ||
    value === 'password' ||
    value === 'publicKey' ||
    value === 'agent' ||
    value === 'keyboardInteractive'
  );
}

function isSessionEndBehavior(value: unknown): value is SessionEndBehavior {
  return value === 'auto' || value === 'keep' || value === 'reconnect' || value === 'close';
}

function isColorScheme(value: unknown): value is ColorScheme {
  return (
    value === 'auto' ||
    value === 'green' ||
    value === 'amber' ||
    value === 'blue' ||
    value === 'monochrome'
  );
}

const authMethods: AuthMethod[] = ['auto', 'password', 'publicKey', 'agent', 'keyboardInteractive'];
const connectionMethods: ConnectionMethod[] = ['ssh', 'telnet', 'local'];
const themeModes: ThemeMode[] = ['system', 'dark', 'light'];
const aiProviders: AiProvider[] = ['none', 'openai', 'anthropic', 'local', 'custom'];
const aiCommandPolicies: AiCommandPolicy[] = ['ask', 'suggest', 'auto', 'fullAccess'];

const enLabels = {
  pageTitle: 'Settings',
  nav: {
    general: 'General',
    appearance: 'Appearance',
    terminal: 'Terminal',
    connections: 'Profiles & connections',
    hotkeys: 'Hotkeys',
    ai: 'AI',
    advanced: 'Advanced',
  },
  localeName: { en: 'English', zh: 'Simplified Chinese' },
  languageCardTitle: 'Language',
  languageCardDescription:
    'Application interface language. More locales can be added to this list.',
  languageStatusLabel: 'Current language',
  generalSectionDescription: 'The interface updates immediately when the language changes.',
  automaticUpdateTitle: 'Automatically download updates',
  automaticUpdateDescription: 'Download new versions in the background and ask before restart.',
  startupCardTitle: 'Startup',
  startupOpenTerminalTitle: 'Open terminal on startup',
  startupOpenTerminalDescription: 'Show a local shell when FleurTerm launches.',
  connectionsSectionTitle: 'Profiles & connections',
  filterConnections: 'Filter connections',
  addConnection: 'Add connection',
  connectionsCardTitle: 'Saved connections',
  openConnection: 'Open',
  editConnection: 'Edit',
  deleteConnection: 'Delete',
  emptyConnections: 'No connections found.',
  appearanceCardTitle: 'Appearance',
  appearanceCardDescription: 'Choose how FleurTerm surfaces and terminal content are displayed.',
  themeOptions: {
    system: { label: 'System', description: 'Match macOS or Windows' },
    dark: { label: 'Dark', description: 'Black and neutral gray surfaces' },
    light: { label: 'Light', description: 'Bright surfaces with dark text' },
  },
  terminalColorsTitle: 'Terminal colors',
  terminalColorsDescription: 'Dark and light modes keep separate readable text colors.',
  terminalPaletteToneLabel: 'Palette to edit',
  terminalColorPreviewTitle: 'Preview',
  terminalForegroundLabel: 'Foreground',
  terminalMutedLabel: 'Muted',
  terminalColorsReset: 'Reset colors',
  windowTransparencyTitle: 'Window transparency',
  windowTransparencyDescription: 'Control native window opacity and background blur.',
  windowTransparencyEnabledLabel: 'Enable transparency',
  windowTransparencyOpacityLabel: 'Opacity',
  windowTransparencyBlurLabel: 'Blur',
  terminalSectionTitle: 'Terminal',
  terminalFontTitle: 'Font',
  terminalFontDescription: 'Monospace stack used by newly opened terminals.',
  terminalFontDefault: 'FleurTerm default',
  terminalFontSystem: 'System monospace',
  terminalFontValue: 'Source Code Pro / JetBrains Mono',
  terminalFontSizeTitle: 'Font size',
  terminalFontSizeDescription: 'Text size used by newly opened terminals.',
  terminalLineHeightTitle: 'Line height',
  terminalLineHeightDescription: 'Vertical density used by newly opened terminals.',
  terminalScrollbackTitle: 'Scrollback',
  terminalScrollbackDescription: 'Number of terminal output lines kept in memory.',
  terminalScrollbackUnit: 'lines',
  terminalScrollbackValue: '25000 lines',
  terminalScrollOnInputTitle: 'Scroll on input',
  terminalScrollOnInputDescription: 'Typing returns the viewport to the newest output.',
  terminalCursorTitle: 'Cursor blink',
  terminalCursorDescription: 'Blink the terminal cursor while focused.',
  terminalReset: 'Reset terminal',
  hotkeysSectionTitle: 'Hotkeys',
  hotkeysDescription: 'Click a shortcut to record a new key combination.',
  hotkeysPlatformHint: 'Changes take effect immediately.',
  shortcutAdd: 'Add shortcut',
  shortcutRecording: 'Press a shortcut…',
  shortcutRemove: 'Remove shortcut',
  shortcutReset: 'Restore defaults',
  shortcutSystem: 'System shortcut',
  shortcutInvalid: 'Use Command, Control, or Option with another key.',
  shortcutConflict: 'This shortcut is already assigned to {action}.',
  hotkeyGroups: {
    workspace: 'Workspace',
    terminal: 'Terminal',
  },
  hotkeyActions: {
    'new-terminal': 'New terminal',
    'close-tab': 'Close current tab',
    'next-tab': 'Next tab',
    'previous-tab': 'Previous tab',
    'open-settings': 'Open settings',
    'toggle-ai': 'Toggle AI assistant',
    'clear-terminal': 'Clear terminal',
  },
  aiSectionTitle: 'AI',
  aiProviderTitle: 'Provider',
  aiProviderDescription: 'Choose which assistant backend the side panel should use.',
  aiProviderOptions: {
    none: 'Not configured',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    local: 'Local model',
    custom: 'Custom endpoint',
  },
  aiModelTitle: 'Model',
  aiModelDescription: 'Model name or deployment label for the selected provider.',
  aiBaseUrlTitle: 'Base URL',
  aiBaseUrlDescription: 'API origin used by the selected provider.',
  aiTokenTitle: 'Authentication token',
  aiTokenDescription: 'Provider API key or bearer token used for requests.',
  aiTokenHeaderTitle: 'Token header',
  aiTokenHeaderDescription: 'Header name used by custom OpenAI-compatible providers.',
  aiTokenPrefixTitle: 'Token prefix',
  aiTokenPrefixDescription:
    'Prefix before the token value, such as Bearer. Leave empty for raw tokens.',
  aiStreamingTitle: 'Streaming output',
  aiStreamingDescription:
    'Show assistant responses as they arrive from providers that support streams.',
  aiContextTitle: 'Session context',
  aiContextDescription: 'Allow the AI panel to reference the active terminal session.',
  aiWorkingDirectoryTitle: 'Working directory',
  aiWorkingDirectoryDescription:
    'Include the current working directory when session context is enabled.',
  aiPolicyTitle: 'Command policy',
  aiPolicyDescription: 'How AI-generated commands should be handled before execution.',
  aiPolicyOptions: {
    ask: 'Ask every time',
    suggest: 'Suggest only',
    auto: 'Allow trusted commands',
    fullAccess: 'Full terminal access',
  },
  statusEnabled: 'Enabled',
  statusDisabled: 'Disabled',
  statusPreview: 'Preview only',
  statusNotConfigured: 'Not configured',
  configTitle: 'Configuration',
  configEditorHint: 'Edit persisted workbench configuration as JSON.',
  configExampleLabel: 'Apply configuration',
  configDescription: 'Invalid JSON does not change current settings.',
  configEditorReset: 'Reset',
  configEditorApply: 'Apply',
  configEditorSaved: 'Configuration applied.',
  configEditorError: 'Invalid configuration:',
  themeStatusLabel: 'Status',
  connectionMeta: {
    defaultUser: 'user',
    serialDevice: 'Serial device',
    localUser: 'local',
    methods: { ssh: 'SSH', telnet: 'Telnet', serial: 'Serial', local: 'Local' },
  },
  dialog: {
    connectionLabel: 'Connection',
    connectionCreateSummary: 'Create a new remote terminal profile.',
    connectionEditSummary: 'Create or update a terminal connection profile.',
    unnamedConnection: 'Unnamed connection',
    connectionCancel: 'Cancel',
    connectionSave: 'Save',
    connectionDelete: 'Delete',
    connectionName: 'Name',
    connectionGroup: 'Group',
    connectionIcon: 'Icon',
    connectionMethod: 'Method',
    connectionMethodTitle: 'Connection method',
    connectionMethodDescription: 'Choose a protocol to show only the fields it needs.',
    connectionGeneralNote:
      'Authentication, passwords, and private keys are managed on the Authentication page.',
    connectionHost: 'Host',
    connectionHostPlaceholder: 'localhost',
    connectionPort: 'Port',
    connectionUser: 'User',
    connectionUserPlaceholder: 'local',
    connectionCwd: 'Working directory',
    connectionShell: 'Shell',
    connectionSerialPath: 'Serial path',
    connectionBaudRate: 'Baud rate',
    connectionAuthMethod: 'Authentication',
    connectionPassword: 'Password',
    passwordSavedHint: 'Password is set for this connection.',
    passwordEmptyHint: 'No password saved for this connection.',
    passwordSet: 'Set password',
    passwordForget: 'Forget',
    credentialPasswordNotFound:
      'The saved password was not found. Edit the connection and save it again.',
    credentialOperationFailed: 'FleurTerm could not access the encrypted connection password.',
    connectionPrivateKeys: 'Private keys',
    privateKeyPlaceholder: 'Path to private key',
    addPrivateKey: 'Add key',
    noAuthenticationOptions: 'This connection type does not require authentication.',
    authenticationDescription:
      'Try SSH Agent and private keys first, or save a password for this connection.',
    authenticationSecurityNote:
      'Passwords are encrypted with a key bound to this device and are not stored in the connection profile.',
    connectionForwardedPorts: 'Forwarded ports',
    forwardedPortsHint: 'One forwarded port rule per line.',
    portsDescription: 'Keep port forwarding and proxy rules together for this connection.',
    noPortsOptions: 'This connection type has no port forwarding options.',
    connectionFingerprint: 'Fingerprint',
    connectionLoginScripts: 'Login scripts',
    loginScriptsHint: 'Commands to run after the connection opens.',
    advancedDescription: 'Keep infrequently used connection options out of the basic form.',
    requiredFieldsHint: 'Only name, host, and user are required.',
    connectionPreview: 'Connection preview',
    connectionStatus: 'Status',
    connectionNotTested: 'Not tested',
    tabs: {
      general: 'Basic information',
      authentication: 'Authentication',
      ports: 'Tunnels & proxy',
      advanced: 'Advanced',
    },
    authOptions: {
      auto: 'Auto',
      password: 'Password',
      publicKey: 'Public key',
      agent: 'Agent',
      keyboardInteractive: 'Keyboard',
    },
  },
};

const zhLabels: typeof enLabels = {
  ...enLabels,
  pageTitle: '设置',
  nav: {
    general: '通用',
    appearance: '外观',
    terminal: '终端',
    connections: '配置与连接',
    hotkeys: '快捷键',
    ai: 'AI',
    advanced: '高级',
  },
  localeName: { en: 'English', zh: '简体中文' },
  languageCardTitle: '语言',
  languageCardDescription: '应用界面语言。',
  languageStatusLabel: '当前语言',
  generalSectionDescription: '切换后界面会立即更新。',
  automaticUpdateTitle: '自动下载更新',
  automaticUpdateDescription: '在后台下载新版本，并在重启前征求你的确认。',
  startupCardTitle: '启动',
  startupOpenTerminalTitle: '启动时打开终端',
  startupOpenTerminalDescription: 'FleurTerm 启动后显示本地 Shell。',
  connectionsSectionTitle: '配置与连接',
  filterConnections: '筛选连接',
  addConnection: '添加连接',
  connectionsCardTitle: '已保存连接',
  openConnection: '打开',
  editConnection: '编辑',
  deleteConnection: '删除',
  emptyConnections: '没有找到连接。',
  appearanceCardTitle: '外观',
  appearanceCardDescription: '设置 FleurTerm 界面与终端内容的显示方式。',
  themeOptions: {
    system: { label: '跟随系统', description: '跟随 macOS 或 Windows' },
    dark: { label: '深色', description: '纯黑与中性灰界面' },
    light: { label: '浅色', description: '明亮界面与深色文字' },
  },
  terminalColorsTitle: '终端颜色',
  terminalColorsDescription: '深色和浅色模式分别保存清晰可读的文字颜色。',
  terminalPaletteToneLabel: '正在编辑的配色',
  terminalColorPreviewTitle: '预览',
  terminalForegroundLabel: '前景色',
  terminalMutedLabel: '弱化色',
  terminalColorsReset: '重置颜色',
  windowTransparencyTitle: '窗口透明度',
  windowTransparencyDescription: '控制原生窗口的不透明度与背景模糊。',
  windowTransparencyEnabledLabel: '启用透明效果',
  windowTransparencyOpacityLabel: '不透明度',
  windowTransparencyBlurLabel: '模糊',
  terminalSectionTitle: '终端',
  terminalFontTitle: '字体',
  terminalFontDescription: '终端使用等宽字体栈渲染。',
  terminalFontDefault: 'FleurTerm 默认字体',
  terminalFontSystem: '系统等宽字体',
  terminalFontValue: 'Source Code Pro / JetBrains Mono',
  terminalFontSizeTitle: '字号',
  terminalFontSizeDescription: '当前终端渲染字号。',
  terminalLineHeightTitle: '行高',
  terminalLineHeightDescription: '新打开终端的垂直行距。',
  terminalScrollbackTitle: '回滚行数',
  terminalScrollbackDescription: '保留在内存中的终端输出行数。',
  terminalScrollbackUnit: '行',
  terminalScrollbackValue: '25000 行',
  terminalScrollOnInputTitle: '输入时滚动到底部',
  terminalScrollOnInputDescription: '输入内容时回到最新输出位置。',
  terminalCursorTitle: '光标闪烁',
  terminalCursorDescription: '终端聚焦时显示闪烁光标。',
  terminalReset: '重置终端',
  hotkeysSectionTitle: '快捷键',
  hotkeysDescription: '点击快捷键即可录制新的组合键。',
  hotkeysPlatformHint: '修改后立即生效。',
  shortcutAdd: '添加快捷键',
  shortcutRecording: '请按下快捷键…',
  shortcutRemove: '删除快捷键',
  shortcutReset: '恢复默认',
  shortcutSystem: '系统快捷键',
  shortcutInvalid: '请组合使用 Command、Control 或 Option 与其他按键。',
  shortcutConflict: '该快捷键已经分配给“{action}”。',
  hotkeyGroups: {
    workspace: '工作区',
    terminal: '终端',
  },
  hotkeyActions: {
    'new-terminal': '新建终端',
    'close-tab': '关闭当前标签',
    'next-tab': '下一个标签',
    'previous-tab': '上一个标签',
    'open-settings': '打开设置',
    'toggle-ai': '切换 AI 助手',
    'clear-terminal': '清空终端',
  },
  aiSectionTitle: 'AI',
  aiProviderTitle: '服务提供方',
  aiProviderDescription: '选择右侧 AI 面板使用的助手服务。',
  aiProviderOptions: {
    none: '未配置',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    local: '本地模型',
    custom: '自定义接口',
  },
  aiModelTitle: '模型',
  aiModelDescription: '当前服务提供方使用的模型名称或部署名称。',
  aiBaseUrlTitle: '接口地址',
  aiBaseUrlDescription: '当前服务提供方使用的 API 地址。',
  aiTokenTitle: '认证令牌',
  aiTokenDescription: '请求服务提供方时使用的 API Key 或 Bearer Token。',
  aiTokenHeaderTitle: '令牌请求头',
  aiTokenHeaderDescription: '自定义 OpenAI 兼容接口使用的认证请求头名称。',
  aiTokenPrefixTitle: '令牌前缀',
  aiTokenPrefixDescription: '令牌值前面的前缀，例如 Bearer。留空则直接发送原始令牌。',
  aiStreamingTitle: '流式输出',
  aiStreamingDescription: '服务提供方支持时，AI 回复会边生成边显示。',
  aiContextTitle: '会话上下文',
  aiContextDescription: '允许 AI 面板引用当前活动终端会话。',
  aiWorkingDirectoryTitle: '工作目录',
  aiWorkingDirectoryDescription: '启用会话上下文时包含当前工作目录。',
  aiPolicyTitle: '命令策略',
  aiPolicyDescription: '控制 AI 生成的命令在执行前如何处理。',
  aiPolicyOptions: {
    ask: '每次询问',
    suggest: '仅建议',
    auto: '允许可信命令',
    fullAccess: '完全访问',
  },
  statusEnabled: '已启用',
  statusDisabled: '已禁用',
  statusPreview: '仅展示',
  statusNotConfigured: '未配置',
  configTitle: '配置',
  configEditorHint: '使用 JSON 编辑已持久化的工作台配置。',
  configExampleLabel: '应用配置',
  configDescription: '无效 JSON 不会修改当前设置。',
  configEditorReset: '重置',
  configEditorApply: '应用',
  configEditorSaved: '配置已应用。',
  configEditorError: '配置无效：',
  themeStatusLabel: '状态',
  connectionMeta: {
    defaultUser: '用户',
    serialDevice: '串口设备',
    localUser: '本地',
    methods: { ssh: 'SSH', telnet: 'Telnet', serial: '串口', local: '本地' },
  },
  dialog: {
    connectionLabel: '连接',
    connectionCreateSummary: '创建一个新的远程终端配置。',
    connectionEditSummary: '创建或更新终端连接配置。',
    unnamedConnection: '未命名连接',
    connectionCancel: '取消',
    connectionSave: '保存',
    connectionDelete: '删除',
    connectionName: '名称',
    connectionGroup: '分组',
    connectionIcon: '图标',
    connectionMethod: '方式',
    connectionMethodTitle: '连接方式',
    connectionMethodDescription: '选择协议后，只展示当前协议需要的字段。',
    connectionGeneralNote: '认证方式、密码和私钥在身份认证页面中单独管理。',
    connectionHost: '主机',
    connectionHostPlaceholder: 'localhost',
    connectionPort: '端口',
    connectionUser: '用户',
    connectionUserPlaceholder: 'local',
    connectionCwd: '工作目录',
    connectionShell: 'Shell',
    connectionSerialPath: '串口路径',
    connectionBaudRate: '波特率',
    connectionAuthMethod: '认证',
    connectionPassword: '密码',
    passwordSavedHint: '已为此连接设置密码。',
    passwordEmptyHint: '此连接未保存密码。',
    passwordSet: '设置密码',
    passwordForget: '忘记',
    credentialPasswordNotFound: '未找到已保存的密码，请编辑连接并重新保存。',
    credentialOperationFailed: 'FleurTerm 无法访问已加密的连接密码。',
    connectionPrivateKeys: '私钥',
    privateKeyPlaceholder: '私钥路径',
    addPrivateKey: '添加私钥',
    noAuthenticationOptions: '此连接类型不需要身份认证。',
    authenticationDescription: '优先尝试 SSH Agent 和私钥，也可以保存此连接的密码。',
    authenticationSecurityNote: '密码使用当前设备绑定密钥加密保存，不写入连接配置文件。',
    connectionForwardedPorts: '端口转发',
    forwardedPortsHint: '每行一条端口转发规则。',
    portsDescription: '端口转发和代理规则集中在这里管理。',
    noPortsOptions: '此连接类型没有端口转发选项。',
    connectionFingerprint: '指纹',
    connectionLoginScripts: '登录脚本',
    loginScriptsHint: '连接打开后执行的命令。',
    advancedDescription: '将低频连接设置收纳在这里，避免基本信息过载。',
    requiredFieldsHint: '必填项仅保留名称、主机和用户名。',
    connectionPreview: '连接预览',
    connectionStatus: '状态',
    connectionNotTested: '未测试',
    tabs: {
      general: '基本信息',
      authentication: '身份认证',
      ports: '隧道与代理',
      advanced: '高级',
    },
    authOptions: {
      auto: '自动',
      password: '密码',
      publicKey: '公钥',
      agent: '代理',
      keyboardInteractive: '键盘',
    },
  },
};
</script>

<template>
  <section class="settings-tab settings-view" :aria-label="t('settings.aria')">
    <div class="settings-pane">
      <div class="settings-shell">
        <aside class="settings-sidebar">
          <div class="settings-sidebar-copy">
            <h2>{{ labels.pageTitle }}</h2>
          </div>

          <nav class="settings-nav" :aria-label="labels.pageTitle">
            <button
              v-for="section in sections"
              :key="section.id"
              class="settings-nav-button"
              :class="{ 'is-active': selectedSectionId === section.id }"
              :data-section="section.id"
              type="button"
              @click="selectSection(section.id)"
            >
              <svg class="settings-nav-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path :d="section.iconPath" />
              </svg>
              <span class="settings-nav-label">{{ section.label }}</span>
            </button>
          </nav>
        </aside>

        <div class="settings-content-panel" data-testid="settings-panel">
          <div
            :key="selectedSectionId"
            class="settings-section-view"
            :data-settings-section="selectedSectionId"
          >
            <header class="settings-section-header">
              <h3>{{ activeSection.title }}</h3>
            </header>

            <section v-if="selectedSectionId === 'general'" class="settings-section">
              <div class="settings-form-list">
                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.languageCardTitle }}</strong>
                    <span>{{ labels.languageCardDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <AppSelect
                      :model-value="selectedLocale"
                      :options="languageOptions"
                      :aria-label="labels.languageCardTitle"
                      test-id="settings-language-select"
                      @update:model-value="selectedLocale = $event as AppLocale"
                    />
                  </div>
                </div>

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.languageStatusLabel }}</strong>
                    <span>{{ labels.generalSectionDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <span class="settings-value-pill">
                      {{ selectedLocale === 'zh-CN' ? labels.localeName.zh : labels.localeName.en }}
                    </span>
                  </div>
                </div>

                <SoftwareUpdateCard />

                <div class="settings-form-line" data-testid="automatic-update-setting">
                  <div class="settings-form-copy">
                    <strong>{{ labels.automaticUpdateTitle }}</strong>
                    <span>{{ labels.automaticUpdateDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <button
                      class="connection-toggle"
                      :class="{ 'is-active': updateSettings.automaticDownloadEnabled }"
                      data-testid="automatic-update-toggle"
                      type="button"
                      role="switch"
                      :aria-label="labels.automaticUpdateTitle"
                      :aria-checked="updateSettings.automaticDownloadEnabled"
                      @click="toggleAutomaticUpdateDownloads"
                    >
                      <span />
                    </button>
                  </div>
                </div>

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.startupOpenTerminalTitle }}</strong>
                    <span>{{ labels.startupOpenTerminalDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <button
                      class="connection-toggle"
                      :class="{ 'is-active': startupSettings.openTerminalOnStartup }"
                      data-testid="settings-open-terminal-on-startup"
                      :aria-label="
                        startupSettings.openTerminalOnStartup
                          ? labels.statusEnabled
                          : labels.statusDisabled
                      "
                      type="button"
                      @click="
                        appSettings.updateStartupSettings({
                          openTerminalOnStartup: !startupSettings.openTerminalOnStartup,
                        })
                      "
                    >
                      <span />
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section v-else-if="selectedSectionId === 'terminal'" class="settings-section">
              <div class="settings-form-list">
                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.terminalFontTitle }}</strong>
                    <span>{{ labels.terminalFontDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <AppSelect
                      :model-value="terminalSettings.fontFamily"
                      :options="terminalFontOptions"
                      :aria-label="labels.terminalFontTitle"
                      test-id="settings-terminal-font"
                      @update:model-value="updateTerminalSetting('fontFamily', $event)"
                    />
                  </div>
                </div>

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.terminalFontSizeTitle }}</strong>
                    <span>{{ labels.terminalFontSizeDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <label class="settings-range-field settings-range-field-inline">
                      <div class="settings-range-control">
                        <input
                          class="settings-range-input"
                          type="range"
                          min="10"
                          max="24"
                          step="1"
                          :value="terminalSettings.fontSize"
                          @input="
                            updateTerminalSetting(
                              'fontSize',
                              Number(($event.target as HTMLInputElement).value),
                            )
                          "
                        />
                        <strong class="settings-range-value">
                          {{ terminalSettings.fontSize }} px
                        </strong>
                      </div>
                    </label>
                  </div>
                </div>

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.terminalLineHeightTitle }}</strong>
                    <span>{{ labels.terminalLineHeightDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <label class="settings-range-field settings-range-field-inline">
                      <div class="settings-range-control">
                        <input
                          class="settings-range-input"
                          type="range"
                          min="1"
                          max="1.8"
                          step="0.05"
                          :value="terminalSettings.lineHeight"
                          @input="
                            updateTerminalSetting(
                              'lineHeight',
                              Number(($event.target as HTMLInputElement).value),
                            )
                          "
                        />
                        <strong class="settings-range-value">
                          {{ terminalSettings.lineHeight.toFixed(2) }}
                        </strong>
                      </div>
                    </label>
                  </div>
                </div>

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.terminalScrollbackTitle }}</strong>
                    <span>{{ labels.terminalScrollbackDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <label class="settings-compact-input settings-number-input">
                      <input
                        data-testid="settings-scrollback"
                        type="number"
                        min="1000"
                        max="100000"
                        step="1000"
                        :value="terminalSettings.scrollback"
                        :aria-label="labels.terminalScrollbackTitle"
                        @input="
                          updateTerminalSetting(
                            'scrollback',
                            Number(($event.target as HTMLInputElement).value),
                          )
                        "
                      />
                      <span>{{ labels.terminalScrollbackUnit }}</span>
                    </label>
                  </div>
                </div>

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.terminalScrollOnInputTitle }}</strong>
                    <span>{{ labels.terminalScrollOnInputDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <button
                      class="connection-toggle"
                      :class="{ 'is-active': terminalSettings.scrollOnInput }"
                      data-testid="settings-scroll-on-input"
                      :aria-label="labels.statusEnabled"
                      type="button"
                      @click="
                        updateTerminalSetting('scrollOnInput', !terminalSettings.scrollOnInput)
                      "
                    >
                      <span />
                    </button>
                  </div>
                </div>

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.terminalCursorTitle }}</strong>
                    <span>{{ labels.terminalCursorDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <button
                      class="connection-toggle"
                      :class="{ 'is-active': terminalSettings.cursorBlink }"
                      :aria-label="labels.statusEnabled"
                      type="button"
                      @click="updateTerminalSetting('cursorBlink', !terminalSettings.cursorBlink)"
                    >
                      <span />
                    </button>
                  </div>
                </div>

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.terminalReset }}</strong>
                    <span>{{ labels.terminalFontDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <button
                      class="settings-reset-button"
                      type="button"
                      @click="resetTerminalSettings"
                    >
                      {{ labels.configEditorReset }}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section v-else-if="selectedSectionId === 'connections'" class="settings-section">
              <div class="settings-form-list">
                <div class="settings-form-line settings-form-line-stacked">
                  <div class="settings-connections-toolbar">
                    <label class="settings-filter-field">
                      <span>{{ labels.filterConnections }}</span>
                      <input
                        v-model="connectionFilter"
                        data-testid="connection-filter"
                        type="search"
                        :placeholder="labels.filterConnections"
                      />
                    </label>
                    <button
                      class="settings-reset-button"
                      data-testid="add-connection"
                      type="button"
                      @click="startCreateConnection"
                    >
                      {{ labels.addConnection }}
                    </button>
                  </div>
                </div>

                <div class="settings-form-line settings-form-line-stacked">
                  <div class="settings-form-copy">
                    <strong>{{ labels.connectionsCardTitle }}</strong>
                  </div>

                  <div v-if="groupedConnections.length > 0" class="settings-connection-groups">
                    <section
                      v-for="{ group, items } in groupedConnections"
                      :key="group"
                      class="settings-connection-group"
                    >
                      <button
                        class="settings-connection-group-header"
                        :class="{ 'is-collapsed': collapsedGroups[group] }"
                        type="button"
                        @click="toggleGroup(group)"
                      >
                        <span class="settings-connection-group-label">
                          <span class="settings-connection-group-caret" aria-hidden="true" />
                          <strong>{{ group }}</strong>
                        </span>
                      </button>

                      <div v-if="!collapsedGroups[group]" class="settings-connection-list">
                        <article
                          v-for="connection in items"
                          :key="connection.id"
                          class="settings-connection-card"
                        >
                          <button
                            class="settings-connection-main"
                            type="button"
                            @click="openConnection(connection)"
                          >
                            <span class="settings-connection-method-tag">
                              {{ methodLabel(connection.method) }}
                            </span>
                            <span class="settings-connection-summary">
                              <span class="settings-connection-title">
                                {{ connectionIdentity(connection) }}
                              </span>
                              <span class="settings-connection-meta">
                                {{ connectionEndpoint(connection) }}
                              </span>
                            </span>
                          </button>

                          <div class="settings-connection-actions">
                            <button
                              class="settings-connection-action-button"
                              type="button"
                              @click="openConnection(connection)"
                            >
                              {{ labels.openConnection }}
                            </button>
                            <button
                              class="settings-connection-action-button"
                              type="button"
                              @click="startEditConnection(connection.id)"
                            >
                              {{ labels.editConnection }}
                            </button>
                            <button
                              v-if="connection.id !== 'local-shell'"
                              class="settings-connection-action-button is-danger"
                              type="button"
                              @click="deleteConnection(connection.id)"
                            >
                              {{ labels.deleteConnection }}
                            </button>
                          </div>
                        </article>
                      </div>
                    </section>
                  </div>
                  <span v-else class="settings-inline-note">{{ labels.emptyConnections }}</span>
                </div>
              </div>
            </section>

            <section v-else-if="selectedSectionId === 'hotkeys'" class="settings-section">
              <div class="settings-hotkeys-layout">
                <header class="settings-hotkeys-intro">
                  <div>
                    <strong>{{ labels.hotkeysSectionTitle }}</strong>
                    <span>{{ labels.hotkeysDescription }}</span>
                  </div>
                  <div class="settings-hotkeys-header-actions">
                    <span class="settings-hotkeys-platform-note">
                      {{ labels.hotkeysPlatformHint }}
                    </span>
                    <button
                      class="settings-shortcut-reset"
                      type="button"
                      @click="resetShortcutSettings"
                    >
                      {{ labels.shortcutReset }}
                    </button>
                  </div>
                </header>

                <p v-if="shortcutError" class="settings-shortcut-error" role="alert">
                  {{ shortcutError }}
                </p>

                <section
                  v-for="group in shortcutGroups"
                  :key="group.id"
                  class="settings-shortcut-group"
                >
                  <h4>{{ group.label }}</h4>
                  <div class="settings-shortcut-list">
                    <article
                      v-for="shortcutDefinition in group.shortcuts"
                      :key="shortcutDefinition.id"
                      class="settings-shortcut-row"
                      :data-shortcut-id="shortcutDefinition.id"
                    >
                      <div class="settings-shortcut-copy">
                        <strong>{{ labels.hotkeyActions[shortcutDefinition.id] }}</strong>
                        <code>({{ shortcutDefinition.id }})</code>
                      </div>

                      <span
                        v-if="!shortcutDefinition.editable"
                        class="settings-shortcut-system-binding"
                      >
                        <span class="settings-shortcut-key-label">
                          {{ shortcutKeysFor(shortcutDefinition).join('-') }}
                        </span>
                        <small>{{ labels.shortcutSystem }}</small>
                      </span>

                      <button
                        v-else-if="recordingShortcutId === shortcutDefinition.id"
                        class="settings-shortcut-recording"
                        type="button"
                        :data-testid="`record-${shortcutDefinition.id}`"
                        @click="beginShortcutRecording(shortcutDefinition)"
                      >
                        {{ labels.shortcutRecording }}
                      </button>

                      <span
                        v-else-if="shortcutBindingFor(shortcutDefinition)"
                        class="settings-shortcut-binding"
                      >
                        <button
                          class="settings-shortcut-binding-value"
                          type="button"
                          :data-testid="`record-${shortcutDefinition.id}`"
                          @click="beginShortcutRecording(shortcutDefinition)"
                        >
                          <kbd v-for="key in shortcutKeysFor(shortcutDefinition)" :key="key">
                            {{ key }}
                          </kbd>
                        </button>
                        <button
                          class="settings-shortcut-remove"
                          type="button"
                          :aria-label="`${labels.shortcutRemove}: ${labels.hotkeyActions[shortcutDefinition.id]}`"
                          :data-testid="`remove-${shortcutDefinition.id}`"
                          @click="removeShortcut(shortcutDefinition)"
                        >
                          <svg viewBox="0 0 12 12" aria-hidden="true">
                            <path d="m3 3 6 6m0-6-6 6" />
                          </svg>
                        </button>
                      </span>

                      <button
                        v-else
                        class="settings-shortcut-add"
                        type="button"
                        :data-testid="`record-${shortcutDefinition.id}`"
                        @click="beginShortcutRecording(shortcutDefinition)"
                      >
                        {{ labels.shortcutAdd }}
                      </button>
                    </article>
                  </div>
                </section>
              </div>
            </section>

            <section v-else-if="selectedSectionId === 'ai'" class="settings-section">
              <div class="settings-form-list">
                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.aiProviderTitle }}</strong>
                    <span>{{ labels.aiProviderDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <AppSelect
                      :model-value="aiSettings.provider"
                      :options="aiProviderOptions"
                      :aria-label="labels.aiProviderTitle"
                      test-id="settings-ai-provider"
                      @update:model-value="updateAiProvider($event as AiProvider)"
                    />
                  </div>
                </div>

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.aiBaseUrlTitle }}</strong>
                    <span>{{ labels.aiBaseUrlDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <label class="settings-compact-input">
                      <input
                        data-testid="settings-ai-base-url"
                        :value="aiSettings.baseUrl"
                        :aria-label="labels.aiBaseUrlTitle"
                        placeholder="https://api.openai.com/v1"
                        @input="
                          updateAiSetting('baseUrl', ($event.target as HTMLInputElement).value)
                        "
                      />
                    </label>
                  </div>
                </div>

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.aiModelTitle }}</strong>
                    <span>{{ labels.aiModelDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <label class="settings-compact-input">
                      <input
                        data-testid="settings-ai-model"
                        :value="aiSettings.model"
                        :aria-label="labels.aiModelTitle"
                        @input="updateAiSetting('model', ($event.target as HTMLInputElement).value)"
                      />
                    </label>
                  </div>
                </div>

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.aiTokenTitle }}</strong>
                    <span>{{ labels.aiTokenDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <label class="settings-compact-input">
                      <input
                        data-testid="settings-ai-token"
                        type="password"
                        autocomplete="off"
                        :value="aiSettings.token"
                        :aria-label="labels.aiTokenTitle"
                        @input="updateAiSetting('token', ($event.target as HTMLInputElement).value)"
                      />
                    </label>
                  </div>
                </div>

                <div v-if="aiSettings.provider === 'custom'" class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.aiTokenHeaderTitle }}</strong>
                    <span>{{ labels.aiTokenHeaderDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <label class="settings-compact-input">
                      <input
                        data-testid="settings-ai-token-header"
                        :value="aiSettings.tokenHeaderName"
                        :aria-label="labels.aiTokenHeaderTitle"
                        @input="
                          updateAiSetting(
                            'tokenHeaderName',
                            ($event.target as HTMLInputElement).value,
                          )
                        "
                      />
                    </label>
                  </div>
                </div>

                <div v-if="aiSettings.provider === 'custom'" class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.aiTokenPrefixTitle }}</strong>
                    <span>{{ labels.aiTokenPrefixDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <label class="settings-compact-input">
                      <input
                        data-testid="settings-ai-token-prefix"
                        :value="aiSettings.tokenPrefix"
                        :aria-label="labels.aiTokenPrefixTitle"
                        @input="
                          updateAiSetting('tokenPrefix', ($event.target as HTMLInputElement).value)
                        "
                      />
                    </label>
                  </div>
                </div>

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.aiContextTitle }}</strong>
                    <span>{{ labels.aiContextDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <button
                      class="connection-toggle"
                      :class="{ 'is-active': aiSettings.contextEnabled }"
                      :aria-label="labels.aiContextTitle"
                      type="button"
                      @click="updateAiSetting('contextEnabled', !aiSettings.contextEnabled)"
                    >
                      <span />
                    </button>
                  </div>
                </div>

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.aiStreamingTitle }}</strong>
                    <span>{{ labels.aiStreamingDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <button
                      class="connection-toggle"
                      :class="{ 'is-active': aiSettings.streamingEnabled }"
                      :aria-label="labels.aiStreamingTitle"
                      data-testid="settings-ai-streaming"
                      type="button"
                      @click="updateAiSetting('streamingEnabled', !aiSettings.streamingEnabled)"
                    >
                      <span />
                    </button>
                  </div>
                </div>

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.aiWorkingDirectoryTitle }}</strong>
                    <span>{{ labels.aiWorkingDirectoryDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <button
                      class="connection-toggle"
                      :class="{ 'is-active': aiSettings.includeWorkingDirectory }"
                      :aria-label="labels.aiWorkingDirectoryTitle"
                      type="button"
                      @click="
                        updateAiSetting(
                          'includeWorkingDirectory',
                          !aiSettings.includeWorkingDirectory,
                        )
                      "
                    >
                      <span />
                    </button>
                  </div>
                </div>

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.aiPolicyTitle }}</strong>
                    <span>{{ labels.aiPolicyDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <AppSelect
                      :model-value="aiSettings.commandPolicy"
                      :options="aiCommandPolicyOptions"
                      :aria-label="labels.aiPolicyTitle"
                      menu-placement="top"
                      test-id="settings-ai-policy"
                      @update:model-value="
                        updateAiSetting('commandPolicy', $event as AiCommandPolicy)
                      "
                    />
                  </div>
                </div>
              </div>
            </section>

            <section v-else-if="selectedSectionId === 'appearance'" class="settings-section">
              <div class="settings-appearance-layout">
                <article class="settings-appearance-card settings-theme-card-section">
                  <header class="settings-appearance-card-header">
                    <div>
                      <strong>{{ labels.appearanceCardTitle }}</strong>
                      <span>{{ labels.appearanceCardDescription }}</span>
                    </div>
                  </header>
                  <div class="settings-theme-card-grid" :aria-label="labels.appearanceCardTitle">
                    <button
                      v-for="mode in themeModes"
                      :key="mode"
                      class="settings-theme-card"
                      :class="[`is-${mode}`, { 'is-active': themeMode === mode }]"
                      :data-theme-mode="mode"
                      type="button"
                      :aria-pressed="themeMode === mode"
                      @click="themeMode = mode"
                    >
                      <span class="settings-theme-card-preview" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                      <span class="settings-theme-card-copy">
                        <strong>{{ labels.themeOptions[mode].label }}</strong>
                        <small>{{ labels.themeOptions[mode].description }}</small>
                      </span>
                      <span class="settings-theme-card-check" aria-hidden="true" />
                    </button>
                  </div>
                </article>

                <article class="settings-appearance-card settings-terminal-appearance-card">
                  <header
                    class="settings-appearance-card-header settings-appearance-card-header-row"
                  >
                    <div>
                      <strong>{{ labels.terminalColorsTitle }}</strong>
                      <span>{{ labels.terminalColorsDescription }}</span>
                    </div>
                    <div
                      class="settings-palette-tone-switch"
                      role="tablist"
                      :aria-label="labels.terminalPaletteToneLabel"
                    >
                      <button
                        v-for="tone in ['dark', 'light'] as ThemeTone[]"
                        :key="tone"
                        :data-palette-tone="tone"
                        :class="{ 'is-active': terminalPaletteTone === tone }"
                        type="button"
                        :aria-pressed="terminalPaletteTone === tone"
                        @click="terminalPaletteTone = tone"
                      >
                        {{ labels.themeOptions[tone].label }}
                      </button>
                    </div>
                  </header>

                  <div class="settings-terminal-colors-card" :style="terminalPreviewStyle">
                    <div class="settings-terminal-color-preview">
                      <span class="settings-terminal-color-preview-title">
                        {{ labels.terminalColorPreviewTitle }}
                      </span>
                      <div class="settings-terminal-color-preview-screen">
                        <span class="settings-terminal-color-preview-line is-main">
                          deploy@prod-web-01:~$ npm run build
                        </span>
                        <span class="settings-terminal-color-preview-line is-muted">
                          vite building client environment...
                        </span>
                        <span class="settings-terminal-color-preview-line is-success">
                          ✓ build completed in 572ms
                        </span>
                      </div>
                    </div>

                    <div class="settings-terminal-color-fields">
                      <label class="settings-terminal-color-field">
                        <span>{{ labels.terminalForegroundLabel }}</span>
                        <div class="settings-terminal-color-control">
                          <i :style="{ backgroundColor: terminalPalette.terminalForeground }" />
                          <code>{{ terminalPalette.terminalForeground }}</code>
                          <input
                            data-testid="terminal-foreground-color"
                            type="color"
                            :value="terminalPalette.terminalForeground"
                            :aria-label="labels.terminalForegroundLabel"
                            @input="
                              updateThemePaletteColor(
                                'terminalForeground',
                                ($event.target as HTMLInputElement).value,
                              )
                            "
                          />
                        </div>
                      </label>

                      <label class="settings-terminal-color-field">
                        <span>{{ labels.terminalMutedLabel }}</span>
                        <div class="settings-terminal-color-control">
                          <i :style="{ backgroundColor: terminalPalette.terminalMuted }" />
                          <code>{{ terminalPalette.terminalMuted }}</code>
                          <input
                            data-testid="terminal-muted-color"
                            type="color"
                            :value="terminalPalette.terminalMuted"
                            :aria-label="labels.terminalMutedLabel"
                            @input="
                              updateThemePaletteColor(
                                'terminalMuted',
                                ($event.target as HTMLInputElement).value,
                              )
                            "
                          />
                        </div>
                      </label>

                      <button
                        class="settings-reset-button settings-terminal-colors-reset"
                        type="button"
                        @click="resetTerminalColors"
                      >
                        {{ labels.terminalColorsReset }}
                      </button>
                    </div>
                  </div>
                </article>

                <article class="settings-appearance-card settings-transparency-section">
                  <header class="settings-appearance-card-header">
                    <div>
                      <strong>{{ labels.windowTransparencyTitle }}</strong>
                      <span>{{ labels.windowTransparencyDescription }}</span>
                    </div>
                  </header>
                  <div class="settings-transparency-card">
                    <div class="settings-toggle-row">
                      <div class="settings-toggle-copy">
                        <strong>{{ labels.windowTransparencyEnabledLabel }}</strong>
                      </div>
                      <button
                        class="connection-toggle"
                        :class="{ 'is-active': windowAppearance.transparency.enabled }"
                        type="button"
                        :aria-pressed="windowAppearance.transparency.enabled"
                        @click="
                          updateWindowTransparency({
                            enabled: !windowAppearance.transparency.enabled,
                          })
                        "
                      >
                        <span />
                      </button>
                    </div>

                    <div
                      v-if="windowAppearance.transparency.enabled"
                      class="settings-transparency-grid"
                    >
                      <label class="settings-range-field">
                        <span class="settings-range-label">{{
                          labels.windowTransparencyOpacityLabel
                        }}</span>
                        <div class="settings-range-control">
                          <input
                            class="settings-range-input"
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            :value="windowAppearance.transparency.opacity"
                            @input="
                              updateWindowTransparency({
                                opacity: Number(($event.target as HTMLInputElement).value),
                              })
                            "
                          />
                          <strong class="settings-range-value">
                            {{ windowAppearance.transparency.opacity }}%
                          </strong>
                        </div>
                      </label>

                      <label class="settings-range-field">
                        <span class="settings-range-label">{{
                          labels.windowTransparencyBlurLabel
                        }}</span>
                        <div class="settings-range-control">
                          <input
                            class="settings-range-input"
                            type="range"
                            min="0"
                            max="32"
                            step="1"
                            :value="windowAppearance.transparency.blur"
                            @input="
                              updateWindowTransparency({
                                blur: Number(($event.target as HTMLInputElement).value),
                              })
                            "
                          />
                          <strong class="settings-range-value">
                            {{ windowAppearance.transparency.blur }}px
                          </strong>
                        </div>
                      </label>
                    </div>
                  </div>
                </article>
              </div>
            </section>

            <section v-else class="settings-section">
              <div class="settings-form-list">
                <div class="settings-form-line settings-form-line-stacked">
                  <div class="settings-form-copy">
                    <strong>{{ labels.configTitle }}</strong>
                    <span>{{ labels.configEditorHint }}</span>
                  </div>
                  <textarea
                    v-model="settingsEditorValue"
                    class="settings-config-editor"
                    data-testid="settings-json-editor"
                    spellcheck="false"
                    @input="settingsEditorStatus = null"
                  />
                </div>

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.configExampleLabel }}</strong>
                    <span>{{ labels.configDescription }}</span>
                  </div>
                  <div class="settings-control settings-config-actions">
                    <button
                      class="settings-reset-button"
                      type="button"
                      @click="resetSettingsEditor"
                    >
                      {{ labels.configEditorReset }}
                    </button>
                    <button
                      class="settings-reset-button"
                      data-testid="apply-settings-json"
                      type="button"
                      @click="applySettingsEditor"
                    >
                      {{ labels.configEditorApply }}
                    </button>
                  </div>
                </div>

                <div
                  v-if="settingsEditorStatus"
                  class="settings-form-line settings-form-line-stacked"
                >
                  <div class="settings-form-copy">
                    <strong>{{ labels.themeStatusLabel }}</strong>
                    <span>{{ labels.configEditorHint }}</span>
                  </div>
                  <div
                    class="settings-config-status"
                    :class="{ 'has-error': settingsEditorStatus.kind === 'error' }"
                  >
                    {{ settingsEditorStatus.message }}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>

    <AppDialog
      :open="showDialog"
      :aria-label="labels.dialog.connectionLabel"
      panel-class="connection-dialog-form"
      width="860px"
      @close="closeDialog"
    >
      <header class="connection-dialog-header">
        <div class="connection-dialog-title">
          <span class="connection-dialog-title-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M5 6h14v4H5V6Zm0 8h14v4H5v-4Zm3-6h.01M8 16h.01" />
            </svg>
          </span>
          <div class="connection-dialog-copy">
            <strong>{{
              dialogIntent === 'edit' ? labels.editConnection : labels.addConnection
            }}</strong>
            <p>
              {{
                dialogIntent === 'edit'
                  ? labels.dialog.connectionEditSummary
                  : labels.dialog.connectionCreateSummary
              }}
            </p>
          </div>
        </div>
        <button
          class="connection-dialog-close"
          type="button"
          :aria-label="labels.dialog.connectionCancel"
          @click="closeDialog"
        >
          <span />
        </button>
      </header>

      <nav
        class="connection-editor-tabs"
        :aria-label="labels.dialog.connectionLabel"
        role="tablist"
      >
        <button
          v-for="tab in formTabs"
          :id="`connection-tab-${tab.id}`"
          :key="tab.id"
          class="connection-editor-tab"
          :class="{ 'is-active': activeFormTab === tab.id }"
          :data-form-tab="tab.id"
          :aria-controls="`connection-panel-${tab.id}`"
          :aria-selected="activeFormTab === tab.id"
          :tabindex="activeFormTab === tab.id ? 0 : -1"
          type="button"
          role="tab"
          @click="activeFormTab = tab.id"
          @keydown="navigateConnectionFormTabs($event, tab.id)"
        >
          {{ tab.label }}
        </button>
      </nav>

      <div class="connection-dialog-form-body">
        <div class="connection-dialog-layout">
          <section class="connection-dialog-main">
            <div
              :id="`connection-panel-${activeFormTab}`"
              class="connection-editor-panel"
              :aria-labelledby="`connection-tab-${activeFormTab}`"
              role="tabpanel"
            >
              <div v-if="activeFormTab === 'general'" class="connection-editor-stack">
                <div class="connection-panel-heading">
                  <strong>{{ labels.dialog.connectionMethodTitle }}</strong>
                  <span>{{ labels.dialog.connectionMethodDescription }}</span>
                </div>

                <div
                  class="connection-dialog-protocols"
                  :aria-label="labels.dialog.connectionMethod"
                >
                  <button
                    v-for="method in connectionMethods"
                    :key="method"
                    class="connection-protocol-option"
                    :class="{ 'is-active': draft.method === method }"
                    :data-connection-method="method"
                    :aria-pressed="draft.method === method"
                    type="button"
                    @click="updateDraft('method', method)"
                  >
                    <svg v-if="method === 'ssh'" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m5 7 5 5-5 5m7 0h7" />
                    </svg>
                    <svg v-else-if="method === 'telnet'" viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="5" cy="12" r="2" />
                      <circle cx="19" cy="6" r="2" />
                      <circle cx="19" cy="18" r="2" />
                      <path d="m7 12 10-5m-10 5 10 5" />
                    </svg>
                    <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="4" y="5" width="16" height="11" rx="1.5" />
                      <path d="M2.5 19h19" />
                    </svg>
                    <span>{{ methodLabel(method) }}</span>
                  </button>
                </div>

                <div class="connection-form">
                  <label class="connection-field">
                    <span>{{ labels.dialog.connectionName }}</span>
                    <div class="connection-field-control connection-field-control-rich">
                      <input
                        v-model="draft.name"
                        v-bind="connectionTextInputAttributes"
                        data-testid="connection-name"
                      />
                    </div>
                  </label>

                  <label class="connection-field">
                    <span>{{ labels.dialog.connectionGroup }}</span>
                    <div class="connection-field-control connection-field-control-rich">
                      <input
                        v-model="draft.group"
                        v-bind="connectionTextInputAttributes"
                        data-testid="connection-group"
                      />
                    </div>
                  </label>
                </div>

                <div v-if="draft.method === 'local'" class="connection-form">
                  <label class="connection-field connection-field-full">
                    <span>{{ labels.dialog.connectionCwd }}</span>
                    <div class="connection-field-control connection-field-control-rich">
                      <input
                        v-model="draft.cwd"
                        v-bind="connectionTextInputAttributes"
                        data-testid="connection-cwd"
                      />
                    </div>
                  </label>
                  <label class="connection-field connection-field-full">
                    <span>{{ labels.dialog.connectionShell }}</span>
                    <div class="connection-field-control connection-field-control-rich">
                      <input
                        v-model="draft.shell"
                        v-bind="connectionTextInputAttributes"
                        data-testid="connection-shell"
                      />
                    </div>
                  </label>
                </div>

                <div v-else-if="draft.method === 'serial'" class="connection-form">
                  <label class="connection-field connection-field-full">
                    <span>{{ labels.dialog.connectionSerialPath }}</span>
                    <div class="connection-field-control connection-field-control-rich">
                      <input v-model="draft.serialPath" v-bind="connectionTextInputAttributes" />
                    </div>
                  </label>
                  <label class="connection-field">
                    <span>{{ labels.dialog.connectionBaudRate }}</span>
                    <div class="connection-field-control connection-field-control-rich">
                      <input v-model.number="draft.baudRate" type="number" />
                    </div>
                  </label>
                  <label class="connection-field connection-field-full">
                    <span>{{ labels.dialog.connectionShell }}</span>
                    <div class="connection-field-control connection-field-control-rich">
                      <input
                        v-model="draft.shell"
                        v-bind="connectionTextInputAttributes"
                        data-testid="connection-shell"
                      />
                    </div>
                  </label>
                </div>

                <template v-else>
                  <div class="connection-form connection-host-fields">
                    <label class="connection-field">
                      <span>{{ labels.dialog.connectionHost }}</span>
                      <div class="connection-field-control connection-field-control-rich">
                        <input
                          v-model="draft.host"
                          v-bind="connectionTextInputAttributes"
                          :placeholder="labels.dialog.connectionHostPlaceholder"
                          data-testid="connection-host"
                        />
                      </div>
                    </label>
                    <label class="connection-field">
                      <span>{{ labels.dialog.connectionPort }}</span>
                      <div class="connection-field-control connection-field-control-rich">
                        <input
                          v-model.number="draft.port"
                          data-testid="connection-port"
                          type="number"
                        />
                      </div>
                    </label>
                  </div>
                  <div class="connection-form">
                    <label class="connection-field connection-field-full">
                      <span>{{ labels.dialog.connectionUser }}</span>
                      <div class="connection-field-control connection-field-control-rich">
                        <input
                          v-model="draft.user"
                          v-bind="connectionTextInputAttributes"
                          :placeholder="labels.dialog.connectionUserPlaceholder"
                          data-testid="connection-user"
                        />
                      </div>
                    </label>
                  </div>
                </template>

                <div class="connection-panel-note">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 11v5m0-8h.01" />
                  </svg>
                  <span>{{ labels.dialog.connectionGeneralNote }}</span>
                </div>
              </div>

              <div v-else-if="activeFormTab === 'authentication'" class="connection-editor-stack">
                <div class="connection-panel-heading">
                  <strong>{{ labels.dialog.connectionAuthMethod }}</strong>
                  <span>{{ labels.dialog.authenticationDescription }}</span>
                </div>

                <template v-if="supportsAuth">
                  <div class="connection-form">
                    <label class="connection-field connection-field-full">
                      <span>{{ labels.dialog.connectionAuthMethod }}</span>
                      <div class="connection-auth-options">
                        <button
                          v-for="authMethod in authMethods"
                          :key="authMethod"
                          class="connection-auth-option"
                          :class="{ 'is-active': draft.authMethod === authMethod }"
                          :aria-pressed="draft.authMethod === authMethod"
                          type="button"
                          @click="draft.authMethod = authMethod"
                        >
                          <span class="connection-auth-option-label">
                            {{ labels.dialog.authOptions[authMethod] }}
                          </span>
                        </button>
                      </div>
                    </label>
                  </div>

                  <div class="connection-form">
                    <div
                      v-if="showsPasswordTools"
                      class="connection-auth-card connection-field-full"
                    >
                      <div class="connection-auth-copy">
                        <strong>{{ labels.dialog.connectionPassword }}</strong>
                        <span>
                          {{
                            draft.hasPassword
                              ? labels.dialog.passwordSavedHint
                              : labels.dialog.passwordEmptyHint
                          }}
                        </span>
                      </div>
                      <div class="connection-auth-actions">
                        <button
                          class="connection-dialog-secondary-button"
                          type="button"
                          @click="openPasswordDialog"
                        >
                          {{ labels.dialog.passwordSet }}
                        </button>
                        <button
                          v-if="draft.hasPassword"
                          class="connection-dialog-danger-button"
                          type="button"
                          @click="forgetPassword"
                        >
                          {{ labels.dialog.passwordForget }}
                        </button>
                      </div>
                    </div>

                    <label
                      v-if="showsPrivateKeyTools"
                      class="connection-field connection-field-full"
                    >
                      <span>{{ labels.dialog.connectionPrivateKeys }}</span>
                      <div class="connection-key-list">
                        <div
                          v-for="key in draft.privateKeys"
                          :key="key"
                          class="connection-key-item"
                        >
                          <span>{{ key }}</span>
                          <button
                            class="connection-key-remove"
                            type="button"
                            @click="
                              updateDraft(
                                'privateKeys',
                                draft.privateKeys.filter((item) => item !== key),
                              )
                            "
                          >
                            DEL
                          </button>
                        </div>
                      </div>
                      <div class="connection-key-entry">
                        <div class="connection-field-control connection-field-control-rich">
                          <input
                            v-model="privateKeyInput"
                            v-bind="connectionTextInputAttributes"
                            :placeholder="labels.dialog.privateKeyPlaceholder"
                          />
                        </div>
                        <button
                          class="connection-dialog-secondary-button"
                          type="button"
                          @click="addPrivateKey"
                        >
                          {{ labels.dialog.addPrivateKey }}
                        </button>
                      </div>
                    </label>
                  </div>

                  <div class="connection-panel-note connection-panel-note-security">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 3 5 6v5c0 4.5 2.8 8.2 7 10 4.2-1.8 7-5.5 7-10V6l-7-3Z" />
                      <path d="m9 12 2 2 4-4" />
                    </svg>
                    <span>{{ labels.dialog.authenticationSecurityNote }}</span>
                  </div>
                </template>
                <div v-else class="connection-empty-state connection-editor-empty">
                  {{ labels.dialog.noAuthenticationOptions }}
                </div>
              </div>

              <div v-else-if="activeFormTab === 'ports'" class="connection-editor-stack">
                <div class="connection-panel-heading">
                  <strong>{{ labels.dialog.tabs.ports }}</strong>
                  <span>{{ labels.dialog.portsDescription }}</span>
                </div>

                <div v-if="supportsPorts" class="connection-form">
                  <label class="connection-field connection-field-full">
                    <span>{{ labels.dialog.connectionForwardedPorts }}</span>
                    <small class="connection-field-hint">{{
                      labels.dialog.forwardedPortsHint
                    }}</small>
                    <div class="connection-field-control">
                      <textarea
                        v-bind="connectionTextInputAttributes"
                        rows="6"
                        :value="draft.forwardedPorts.join('\n')"
                        @input="
                          updateDraft(
                            'forwardedPorts',
                            ($event.target as HTMLTextAreaElement).value
                              .split('\n')
                              .map((item) => item.trim())
                              .filter(Boolean),
                          )
                        "
                      />
                    </div>
                  </label>
                </div>
                <div v-else class="connection-empty-state connection-editor-empty">
                  {{ labels.dialog.noPortsOptions }}
                </div>
              </div>

              <div v-else class="connection-editor-stack">
                <div class="connection-panel-heading">
                  <strong>{{ labels.dialog.tabs.advanced }}</strong>
                  <span>{{ labels.dialog.advancedDescription }}</span>
                </div>

                <div class="connection-form">
                  <label class="connection-field connection-field-full">
                    <span>{{ labels.dialog.connectionIcon }}</span>
                    <div class="connection-field-control connection-field-control-rich">
                      <input v-model="draft.icon" v-bind="connectionTextInputAttributes" />
                    </div>
                  </label>

                  <label v-if="supportsAdvanced" class="connection-field connection-field-full">
                    <span>{{ labels.dialog.connectionFingerprint }}</span>
                    <div class="connection-field-control">
                      <textarea
                        v-model="draft.fingerprint"
                        v-bind="connectionTextInputAttributes"
                        rows="4"
                      />
                    </div>
                  </label>

                  <label class="connection-field connection-field-full">
                    <span>{{ labels.dialog.connectionLoginScripts }}</span>
                    <small class="connection-field-hint">{{
                      labels.dialog.loginScriptsHint
                    }}</small>
                    <div class="connection-field-control">
                      <textarea
                        v-model="draft.loginScripts"
                        v-bind="connectionTextInputAttributes"
                        rows="6"
                      />
                    </div>
                  </label>
                </div>
              </div>
            </div>
          </section>

          <aside class="connection-dialog-summary" :aria-label="labels.dialog.connectionPreview">
            <div class="connection-summary-profile">
              <span class="connection-summary-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="m5 7 5 5-5 5m7 0h7" />
                </svg>
              </span>
              <div class="connection-summary-copy">
                <strong>{{ draftIdentity }}</strong>
                <code>{{ draftEndpoint }}</code>
              </div>
              <span class="connection-editor-method-badge">{{ methodLabel(draft.method) }}</span>
            </div>

            <dl class="connection-summary-list">
              <div class="connection-summary-item">
                <dt>{{ labels.dialog.connectionAuthMethod }}</dt>
                <dd>{{ labels.dialog.authOptions[draft.authMethod] }}</dd>
              </div>
              <div class="connection-summary-item">
                <dt>{{ labels.dialog.connectionGroup }}</dt>
                <dd>{{ draft.group.trim() || 'default' }}</dd>
              </div>
              <div class="connection-summary-item">
                <dt>{{ labels.dialog.connectionStatus }}</dt>
                <dd>{{ labels.dialog.connectionNotTested }}</dd>
              </div>
            </dl>
          </aside>
        </div>
      </div>

      <p v-if="credentialPersistenceError" class="connection-credential-error" role="alert">
        {{ credentialPersistenceError }}
      </p>

      <footer class="connection-form-actions connection-dialog-footer">
        <span class="connection-dialog-footer-hint">{{ labels.dialog.requiredFieldsHint }}</span>
        <div class="connection-dialog-footer-actions">
          <button class="connection-dialog-secondary-button" type="button" @click="closeDialog">
            {{ labels.dialog.connectionCancel }}
          </button>
          <button
            v-if="
              dialogIntent === 'edit' && editingConnection && editingConnection.id !== 'local-shell'
            "
            class="connection-dialog-danger-button"
            type="button"
            @click="deleteConnection(editingConnection.id)"
          >
            {{ labels.dialog.connectionDelete }}
          </button>
          <button
            class="connection-dialog-primary-button"
            data-testid="save-connection"
            type="button"
            :disabled="!isDraftValid(draft)"
            @click="saveDraft"
          >
            {{ labels.dialog.connectionSave }}
          </button>
        </div>
      </footer>
    </AppDialog>

    <AppDialog
      :open="passwordDialogOpen"
      :aria-label="labels.dialog.connectionPassword"
      panel-class="connection-dialog-password"
      width="380px"
      @close="closePasswordDialog"
    >
      <div class="connection-dialog-form-body">
        <div class="password-dialog-content">
          <label class="connection-field connection-field-full">
            <span>{{ labels.dialog.connectionPassword }}</span>
            <div class="connection-field-control">
              <input v-model="passwordValue" autofocus type="password" />
            </div>
          </label>
          <p v-if="credentialPersistenceError" class="connection-credential-error" role="alert">
            {{ credentialPersistenceError }}
          </p>
        </div>
      </div>

      <footer class="connection-form-actions password-dialog-actions">
        <button
          class="connection-dialog-secondary-button"
          type="button"
          @click="closePasswordDialog"
        >
          {{ labels.dialog.connectionCancel }}
        </button>
        <button class="connection-dialog-primary-button" type="button" @click="confirmPassword">
          {{ labels.dialog.connectionSave }}
        </button>
      </footer>
    </AppDialog>
  </section>
</template>
