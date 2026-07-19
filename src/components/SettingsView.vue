<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import AppDialog from '@/components/AppDialog.vue';
import AppSelect from '@/components/AppSelect.vue';
import { locale, setLocale, t, type AppLocale } from '@/i18n/locale';
import { settingsClient } from '@/services/settingsClient';

type SettingsSectionId =
  'general' | 'appearance' | 'terminal' | 'connections' | 'hotkeys' | 'ai' | 'advanced';
type ConnectionMethod = 'ssh' | 'telnet' | 'serial' | 'local';
type AuthMethod = 'auto' | 'password' | 'publicKey' | 'agent' | 'keyboardInteractive';
type SessionEndBehavior = 'auto' | 'keep' | 'reconnect' | 'close';
type ColorScheme = 'auto' | 'green' | 'amber' | 'blue' | 'monochrome';
type ThemeMode = 'system' | 'dark' | 'light';
type ThemeTone = 'dark' | 'light';
type ConnectionDialogIntent = 'create' | 'edit';
type ConnectionFormTabId = 'general' | 'ports' | 'advanced' | 'loginScripts';

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
  tone: ThemeTone;
  palette: {
    terminalForeground: string;
    terminalMuted: string;
  };
};

const CONNECTIONS_STORAGE_KEY = 'fleurterm.connections';
const RECENT_CONNECTIONS_STORAGE_KEY = 'fleurterm.recentConnections';
const THEME_STORAGE_KEY = 'fleurterm.theme';
const WINDOW_STORAGE_KEY = 'fleurterm.window';

const emit = defineEmits<{
  openConnection: [connection: WorkbenchConnection];
}>();

const defaultTheme: ThemeConfigFile = {
  tone: 'dark',
  palette: {
    terminalForeground: '#eef3f8',
    terminalMuted: '#8a98a8',
  },
};
const presetTheme = { ...defaultTheme, palette: { ...defaultTheme.palette } };
const defaultWindowAppearance: WindowAppearanceConfig = {
  transparency: { enabled: false, opacity: 100, blur: 0 },
};
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
const connections = ref<WorkbenchConnection[]>(loadConnections());
const recentConnectionIds = ref<string[]>(loadRecentConnectionIds(connections.value));
const themeMode = ref<ThemeMode>(loadThemeMode());
const configTheme = ref<ThemeConfigFile>(loadThemeConfig());
const windowAppearance = ref<WindowAppearanceConfig>(loadWindowAppearance());
const settingsEditorValue = ref('');
const settingsEditorStatus = ref<{ kind: 'success' | 'error'; message: string } | null>(null);
const dialogIntent = ref<ConnectionDialogIntent | null>(null);
const editingConnectionId = ref<string | null>(null);
const draft = ref<ConnectionDraft>(createEmptyDraft());
const activeFormTab = ref<ConnectionFormTabId>('general');
const privateKeyInput = ref('');
const passwordDialogOpen = ref(false);
const passwordValue = ref('');
const selectedLocale = computed<AppLocale>({
  get: () => locale.value,
  set: (nextLocale) => setLocale(nextLocale),
});

const labels = computed(() => (selectedLocale.value === 'zh-CN' ? zhLabels : enLabels));
const sections = computed<Array<{ id: SettingsSectionId; label: string; title: string }>>(() => [
  { id: 'general', label: labels.value.nav.general, title: labels.value.languageCardTitle },
  { id: 'appearance', label: labels.value.nav.appearance, title: labels.value.appearanceCardTitle },
  { id: 'terminal', label: labels.value.nav.terminal, title: labels.value.terminalSectionTitle },
  {
    id: 'connections',
    label: labels.value.nav.connections,
    title: labels.value.connectionsSectionTitle,
  },
  { id: 'hotkeys', label: labels.value.nav.hotkeys, title: labels.value.hotkeysSectionTitle },
  { id: 'ai', label: labels.value.nav.ai, title: labels.value.aiSectionTitle },
  { id: 'advanced', label: labels.value.nav.advanced, title: labels.value.configTitle },
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
  ...(supportsPorts.value ? [{ id: 'ports' as const, label: labels.value.dialog.tabs.ports }] : []),
  ...(supportsAdvanced.value
    ? [{ id: 'advanced' as const, label: labels.value.dialog.tabs.advanced }]
    : []),
  { id: 'loginScripts', label: labels.value.dialog.tabs.loginScripts },
]);
const connectionMethodOptions = computed(() =>
  connectionMethods.map((method) => ({
    value: method,
    label: methodLabel(method),
  })),
);
const draftEndpoint = computed(() => {
  if (draft.value.method === 'local') {
    return draft.value.cwd.trim() || 'localhost';
  }
  if (draft.value.method === 'serial') {
    return draft.value.serialPath.trim() || labels.value.connectionMeta.serialDevice;
  }
  return draft.value.host.trim()
    ? `${draft.value.host.trim()}${draft.value.port > 0 ? `:${draft.value.port}` : ''}`
    : '--';
});
const draftIdentity = computed(() =>
  draft.value.method === 'local'
    ? draft.value.name.trim() || labels.value.dialog.connectionLabel
    : `${draft.value.user.trim() || labels.value.connectionMeta.defaultUser}@${
        draft.value.name.trim() || methodLabel(draft.value.method)
      }`,
);

watch(
  [connections, recentConnectionIds, selectedLocale, themeMode, configTheme, windowAppearance],
  () => {
    if (!settingsReady.value) {
      return;
    }
    persistAll();
    settingsEditorValue.value = buildSettingsEditorValue();
    applyCssTheme();
  },
  { deep: true, immediate: true },
);

if (settingsClient.available) {
  void hydrateSettings();
}

if (typeof window !== 'undefined') {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      if (passwordDialogOpen.value) {
        passwordDialogOpen.value = false;
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

  if (savedLocale === 'en-US' || savedLocale === 'zh-CN') {
    setLocale(savedLocale);
  }
  if (isThemeMode(theme?.mode)) {
    themeMode.value = theme.mode;
  }
  if (theme?.config) {
    configTheme.value = normalizeThemeConfig(theme.config);
  }
  if (windowConfig) {
    windowAppearance.value = sanitizeWindowAppearance(windowConfig);
  }
  if (Array.isArray(workbench?.connections)) {
    connections.value = normalizeConnectionList(workbench.connections);
  }
  if (Array.isArray(workbench?.recentConnectionIds)) {
    recentConnectionIds.value = workbench.recentConnectionIds.filter((id) =>
      connections.value.some((connection) => connection.id === id),
    );
  }

  const passwords = await settingsClient.loadPasswords(
    connections.value.map((connection) => connection.id),
  );
  connections.value = connections.value.map((connection) => ({
    ...connection,
    password: passwords[connection.id] ?? '',
    hasPassword: Boolean(passwords[connection.id] || connection.hasPassword),
  }));
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
}

function closeDialog(): void {
  dialogIntent.value = null;
  editingConnectionId.value = null;
  passwordDialogOpen.value = false;
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
      nextDraft.host = 'localhost';
      nextDraft.user = nextDraft.user || 'local';
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

function saveDraft(): void {
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
    hasPassword: Boolean(normalized.password.trim()),
  };
  connections.value =
    editingConnectionId.value === null
      ? [...connections.value, nextConnection]
      : connections.value.map((connection) =>
          connection.id === editingConnectionId.value
            ? { ...connection, ...nextConnection }
            : connection,
        );
  void persistPassword(savedId, normalized.password);
  closeDialog();
}

function deleteConnection(connectionId: string): void {
  if (connectionId === defaultLocalConnection.id) {
    return;
  }
  void settingsClient.deletePassword(connectionId);
  connections.value = connections.value.filter((connection) => connection.id !== connectionId);
  recentConnectionIds.value = recentConnectionIds.value.filter((id) => id !== connectionId);
  closeDialog();
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
  passwordValue.value = draft.value.password;
  passwordDialogOpen.value = true;
}

function confirmPassword(): void {
  updateDraft('password', passwordValue.value);
  updateDraft('hasPassword', Boolean(passwordValue.value.trim()));
  passwordDialogOpen.value = false;
}

function resetTerminalColors(): void {
  configTheme.value = {
    tone: configTheme.value.tone,
    palette: { ...presetTheme.palette },
  };
}

function updateThemePaletteColor(colorKey: keyof ThemeConfigFile['palette'], value: string): void {
  const normalized = normalizeHexColor(value);
  if (!normalized) {
    return;
  }
  configTheme.value = {
    tone: configTheme.value.tone,
    palette: {
      ...configTheme.value.palette,
      [colorKey]: normalized,
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

function resetSettingsEditor(): void {
  settingsEditorValue.value = buildSettingsEditorValue();
  settingsEditorStatus.value = null;
}

function applySettingsEditor(): void {
  try {
    const parsed = parseSettingsEditorValue(settingsEditorValue.value);
    setLocale(parsed.locale);
    themeMode.value = parsed.theme.mode;
    configTheme.value = parsed.theme.config;
    windowAppearance.value = parsed.window;
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
    hasPassword: Boolean(rawDraft.password.trim()),
    privateKeys: rawDraft.privateKeys.map((key) => key.trim()).filter(Boolean),
    loginScripts: rawDraft.loginScripts.trim(),
    forwardedPorts: rawDraft.forwardedPorts.map((port) => port.trim()).filter(Boolean),
    cwd: rawDraft.cwd.trim(),
    serialPath: rawDraft.serialPath.trim(),
    baudRate: Number(rawDraft.baudRate) || 115200,
  };
}

function isDraftValid(candidate: ConnectionDraft): boolean {
  if (!candidate.name.trim() || !candidate.group.trim()) {
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
      theme: {
        mode: themeMode.value,
        config: {
          tone: configTheme.value.tone,
          palette: configTheme.value.palette,
        },
      },
      window: windowAppearance.value,
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
  theme: { mode: ThemeMode; config: ThemeConfigFile };
  window: WindowAppearanceConfig;
  workbench: { connections: WorkbenchConnection[]; recentConnectionIds: string[] };
} {
  const parsed = JSON.parse(source) as Record<string, unknown>;
  if (parsed.locale !== 'en-US' && parsed.locale !== 'zh-CN') {
    throw new Error('locale must be en-US or zh-CN');
  }
  const theme = parsed.theme as { mode?: unknown; config?: ThemeConfigFile } | undefined;
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
    theme: {
      mode: theme?.mode ?? themeMode.value,
      config: normalizeThemeConfig(theme?.config ?? configTheme.value),
    },
    window: sanitizeWindowAppearance(
      (parsed.window as WindowAppearanceConfig | undefined) ?? windowAppearance.value,
    ),
    workbench: {
      connections: normalizeConnectionList(workbench.connections),
      recentConnectionIds: workbench.recentConnectionIds.filter(
        (item): item is string => typeof item === 'string',
      ),
    },
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
    localStorage.setItem(CONNECTIONS_STORAGE_KEY, JSON.stringify(connections.value));
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
      theme: {
        mode: themeMode.value,
        config: configTheme.value,
      },
      window: windowAppearance.value,
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
  return {
    tone: config?.tone === 'light' ? 'light' : 'dark',
    palette: {
      terminalForeground:
        normalizeHexColor(config?.palette?.terminalForeground) ??
        defaultTheme.palette.terminalForeground,
      terminalMuted:
        normalizeHexColor(config?.palette?.terminalMuted) ?? defaultTheme.palette.terminalMuted,
    },
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

function applyCssTheme(): void {
  if (typeof document === 'undefined') {
    return;
  }
  const prefersLight =
    themeMode.value === 'system' &&
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: light)').matches;
  const resolvedTone: ThemeTone = themeMode.value === 'light' || prefersLight ? 'light' : 'dark';
  const colors =
    resolvedTone === 'light'
      ? {
          canvas: '#f4f6f8',
          surface: '#ffffff',
          raised: '#edf1f5',
          hover: 'rgb(20 34 48 / 9%)',
          terminal: '#ffffff',
          border: 'rgb(20 34 48 / 12%)',
          strongBorder: 'rgb(20 34 48 / 22%)',
          text: '#17202a',
          muted: 'rgb(23 32 42 / 58%)',
          subtle: 'rgb(23 32 42 / 42%)',
          less: '#2d3a46',
          card: 'rgb(20 34 48 / 5%)',
        }
      : {
          canvas: '#000000',
          surface: '#000000',
          raised: '#121212',
          hover: 'rgb(122 122 122 / 50%)',
          terminal: '#121212',
          border: 'rgb(255 255 255 / 8%)',
          strongBorder: 'rgb(255 255 255 / 22%)',
          text: '#eef3f8',
          muted: 'rgb(255 255 255 / 50%)',
          subtle: 'rgb(255 255 255 / 36%)',
          less: '#dce5ed',
          card: 'rgb(255 255 255 / 2.5%)',
        };
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--color-canvas', colors.canvas);
  rootStyle.setProperty('--color-surface', colors.surface);
  rootStyle.setProperty('--color-surface-raised', colors.raised);
  rootStyle.setProperty('--color-surface-hover', colors.hover);
  rootStyle.setProperty('--color-terminal', colors.terminal);
  rootStyle.setProperty('--color-border', colors.border);
  rootStyle.setProperty('--color-border-strong', colors.strongBorder);
  rootStyle.setProperty('--color-text', colors.text);
  rootStyle.setProperty('--color-text-muted', colors.muted);
  rootStyle.setProperty('--color-surface-card', colors.card);
  rootStyle.setProperty('--theme-fg-less', colors.less);
  rootStyle.setProperty('--theme-fg-subtle', colors.subtle);
  rootStyle.setProperty('--terminal-bg', colors.terminal);
  rootStyle.setProperty('--app-layer-blur', `${windowAppearance.value.transparency.blur}px`);
  rootStyle.setProperty(
    '--app-overlay-blur',
    `${Math.max(8, windowAppearance.value.transparency.blur)}px`,
  );
  document.documentElement.style.setProperty(
    '--theme-terminal-fg',
    configTheme.value.palette.terminalForeground,
  );
  document.documentElement.style.setProperty(
    '--theme-terminal-muted',
    configTheme.value.palette.terminalMuted,
  );
  document.documentElement.dataset.themeMode = themeMode.value;
  const opacity = windowAppearance.value.transparency.enabled
    ? windowAppearance.value.transparency.opacity / 100
    : 1;
  void settingsClient.setWindowOpacity(opacity).catch(() => undefined);
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
  languageCardDescription: 'Application interface language.',
  languageStatusLabel: 'Current language',
  generalSectionDescription: 'The interface updates immediately when the language changes.',
  startupCardTitle: 'Startup',
  startupOpenTerminalTitle: 'Open terminal on startup',
  startupOpenTerminalDescription: 'Show a local shell when FleurTerm launches.',
  startupTrayTitle: 'Close to tray',
  startupTrayDescription: 'Keep the terminal workspace available in the background.',
  connectionsSectionTitle: 'Profiles & connections',
  filterConnections: 'Filter connections',
  addConnection: 'Add connection',
  connectionsCardTitle: 'Saved connections',
  openConnection: 'Open',
  editConnection: 'Edit',
  deleteConnection: 'Delete',
  emptyConnections: 'No connections found.',
  appearanceCardTitle: 'Appearance',
  themeOptions: {
    system: { label: 'System' },
    dark: { label: 'Dark' },
    light: { label: 'Light' },
  },
  terminalColorsTitle: 'Terminal colors',
  terminalColorPreviewTitle: 'Preview',
  terminalForegroundLabel: 'Foreground',
  terminalMutedLabel: 'Muted',
  terminalColorsReset: 'Reset colors',
  windowTransparencyTitle: 'Window transparency',
  windowTransparencyEnabledLabel: 'Enable transparency',
  windowTransparencyOpacityLabel: 'Opacity',
  windowTransparencyBlurLabel: 'Blur',
  terminalSectionTitle: 'Terminal',
  terminalFontTitle: 'Font',
  terminalFontDescription: 'Rendering uses the terminal monospace stack.',
  terminalFontValue: 'Source Code Pro / JetBrains Mono',
  terminalFontSizeTitle: 'Font size',
  terminalFontSizeDescription: 'Current terminal renderer size.',
  terminalScrollbackTitle: 'Scrollback',
  terminalScrollbackDescription: 'Number of terminal output lines kept in memory.',
  terminalScrollbackValue: '25000 lines',
  terminalScrollOnInputTitle: 'Scroll on input',
  terminalScrollOnInputDescription: 'Typing returns the viewport to the newest output.',
  terminalCursorTitle: 'Cursor blink',
  terminalCursorDescription: 'Blink the terminal cursor while focused.',
  hotkeysSectionTitle: 'Hotkeys',
  hotkeysNewTerminal: 'New terminal',
  hotkeysCloseTab: 'Close tab',
  hotkeysSplitHorizontal: 'Split horizontally',
  hotkeysSplitVertical: 'Split vertically',
  hotkeysSettings: 'Open settings',
  hotkeysReadOnlyHint: 'Shortcut editing is not enabled in this build.',
  aiSectionTitle: 'AI',
  aiProviderTitle: 'Provider',
  aiProviderDescription: 'No assistant provider is configured yet.',
  aiContextTitle: 'Session context',
  aiContextDescription: 'Future context collection will stay opt-in.',
  aiPolicyTitle: 'Command policy',
  aiPolicyDescription: 'Policy controls will be shown here before they affect sessions.',
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
    connectionEditSummary: 'Create or update a terminal connection profile.',
    connectionCancel: 'Cancel',
    connectionSave: 'Save',
    connectionDelete: 'Delete',
    connectionName: 'Name',
    connectionGroup: 'Group',
    connectionIcon: 'Icon',
    connectionMethod: 'Method',
    connectionHost: 'Host',
    connectionPort: 'Port',
    connectionUser: 'User',
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
    connectionPrivateKeys: 'Private keys',
    privateKeyPlaceholder: 'Path to private key',
    addPrivateKey: 'Add key',
    connectionForwardedPorts: 'Forwarded ports',
    forwardedPortsHint: 'One forwarded port rule per line.',
    noPortsOptions: 'This connection type has no port forwarding options.',
    connectionFingerprint: 'Fingerprint',
    noAdvancedOptions: 'This connection type has no advanced options.',
    connectionLoginScripts: 'Login scripts',
    loginScriptsHint: 'Commands to run after the connection opens.',
    tabs: {
      general: 'General',
      ports: 'Ports',
      advanced: 'Advanced',
      loginScripts: 'Login Scripts',
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
  startupCardTitle: '启动',
  startupOpenTerminalTitle: '启动时打开终端',
  startupOpenTerminalDescription: 'FleurTerm 启动后显示本地 Shell。',
  startupTrayTitle: '关闭到托盘',
  startupTrayDescription: '让终端工作区在后台保持可用。',
  connectionsSectionTitle: '配置与连接',
  filterConnections: '筛选连接',
  addConnection: '添加连接',
  connectionsCardTitle: '已保存连接',
  openConnection: '打开',
  editConnection: '编辑',
  deleteConnection: '删除',
  emptyConnections: '没有找到连接。',
  appearanceCardTitle: '外观',
  themeOptions: {
    system: { label: '跟随系统' },
    dark: { label: '深色' },
    light: { label: '浅色' },
  },
  terminalColorsTitle: '终端颜色',
  terminalColorPreviewTitle: '预览',
  terminalForegroundLabel: '前景色',
  terminalMutedLabel: '弱化色',
  terminalColorsReset: '重置颜色',
  windowTransparencyTitle: '窗口透明度',
  windowTransparencyEnabledLabel: '启用透明效果',
  windowTransparencyOpacityLabel: '不透明度',
  windowTransparencyBlurLabel: '模糊',
  terminalSectionTitle: '终端',
  terminalFontTitle: '字体',
  terminalFontDescription: '终端使用等宽字体栈渲染。',
  terminalFontValue: 'Source Code Pro / JetBrains Mono',
  terminalFontSizeTitle: '字号',
  terminalFontSizeDescription: '当前终端渲染字号。',
  terminalScrollbackTitle: '回滚行数',
  terminalScrollbackDescription: '保留在内存中的终端输出行数。',
  terminalScrollbackValue: '25000 行',
  terminalScrollOnInputTitle: '输入时滚动到底部',
  terminalScrollOnInputDescription: '输入内容时回到最新输出位置。',
  terminalCursorTitle: '光标闪烁',
  terminalCursorDescription: '终端聚焦时显示闪烁光标。',
  hotkeysSectionTitle: '快捷键',
  hotkeysNewTerminal: '新建终端',
  hotkeysCloseTab: '关闭标签',
  hotkeysSplitHorizontal: '横向分屏',
  hotkeysSplitVertical: '纵向分屏',
  hotkeysSettings: '打开设置',
  hotkeysReadOnlyHint: '当前版本暂不启用快捷键编辑。',
  aiSectionTitle: 'AI',
  aiProviderTitle: '服务提供方',
  aiProviderDescription: '尚未配置助手服务提供方。',
  aiContextTitle: '会话上下文',
  aiContextDescription: '未来的上下文收集会保持主动开启。',
  aiPolicyTitle: '命令策略',
  aiPolicyDescription: '策略控制会先在这里展示，再影响会话。',
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
    connectionEditSummary: '创建或更新终端连接配置。',
    connectionCancel: '取消',
    connectionSave: '保存',
    connectionDelete: '删除',
    connectionName: '名称',
    connectionGroup: '分组',
    connectionIcon: '图标',
    connectionMethod: '方式',
    connectionHost: '主机',
    connectionPort: '端口',
    connectionUser: '用户',
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
    connectionPrivateKeys: '私钥',
    privateKeyPlaceholder: '私钥路径',
    addPrivateKey: '添加私钥',
    connectionForwardedPorts: '端口转发',
    forwardedPortsHint: '每行一条端口转发规则。',
    noPortsOptions: '此连接类型没有端口转发选项。',
    connectionFingerprint: '指纹',
    noAdvancedOptions: '此连接类型没有高级选项。',
    connectionLoginScripts: '登录脚本',
    loginScriptsHint: '连接打开后执行的命令。',
    tabs: { general: '通用', ports: '端口', advanced: '高级', loginScripts: '登录脚本' },
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
              <span class="settings-nav-label">{{ section.label }}</span>
            </button>
          </nav>
        </aside>

        <div class="settings-content-panel" data-testid="settings-panel">
          <div :key="selectedSectionId" class="settings-section-view">
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
                    <div class="settings-locale-toggle">
                      <button
                        type="button"
                        :class="{ 'is-active': selectedLocale === 'en-US' }"
                        @click="selectedLocale = 'en-US'"
                      >
                        {{ labels.localeName.en }}
                      </button>
                      <button
                        type="button"
                        :class="{ 'is-active': selectedLocale === 'zh-CN' }"
                        @click="selectedLocale = 'zh-CN'"
                      >
                        {{ labels.localeName.zh }}
                      </button>
                    </div>
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

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.startupOpenTerminalTitle }}</strong>
                    <span>{{ labels.startupOpenTerminalDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <span
                      class="settings-readonly-toggle is-active"
                      :aria-label="labels.statusEnabled"
                    >
                      <span />
                    </span>
                  </div>
                </div>

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.startupTrayTitle }}</strong>
                    <span>{{ labels.startupTrayDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <span class="settings-readonly-toggle" :aria-label="labels.statusDisabled">
                      <span />
                    </span>
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
                    <span class="settings-value-pill">{{ labels.terminalFontValue }}</span>
                  </div>
                </div>

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.terminalFontSizeTitle }}</strong>
                    <span>{{ labels.terminalFontSizeDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <span class="settings-value-pill">13 px</span>
                  </div>
                </div>

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.terminalScrollbackTitle }}</strong>
                    <span>{{ labels.terminalScrollbackDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <span class="settings-value-pill" data-testid="settings-scrollback">
                      {{ labels.terminalScrollbackValue }}
                    </span>
                  </div>
                </div>

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.terminalScrollOnInputTitle }}</strong>
                    <span>{{ labels.terminalScrollOnInputDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <span
                      class="settings-readonly-toggle is-active"
                      data-testid="settings-scroll-on-input"
                      :aria-label="labels.statusEnabled"
                    >
                      <span />
                    </span>
                  </div>
                </div>

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.terminalCursorTitle }}</strong>
                    <span>{{ labels.terminalCursorDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <span
                      class="settings-readonly-toggle is-active"
                      :aria-label="labels.statusEnabled"
                    >
                      <span />
                    </span>
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
              <div class="settings-form-list">
                <div class="settings-form-line settings-form-line-stacked">
                  <div class="settings-form-copy">
                    <strong>{{ labels.hotkeysSectionTitle }}</strong>
                    <span>{{ labels.hotkeysReadOnlyHint }}</span>
                  </div>
                  <div class="settings-shortcut-list">
                    <div class="settings-shortcut-row">
                      <span>{{ labels.hotkeysNewTerminal }}</span>
                      <kbd>Ctrl T</kbd>
                    </div>
                    <div class="settings-shortcut-row">
                      <span>{{ labels.hotkeysCloseTab }}</span>
                      <kbd>Ctrl W</kbd>
                    </div>
                    <div class="settings-shortcut-row">
                      <span>{{ labels.hotkeysSplitHorizontal }}</span>
                      <kbd>Alt Shift H</kbd>
                    </div>
                    <div class="settings-shortcut-row">
                      <span>{{ labels.hotkeysSplitVertical }}</span>
                      <kbd>Alt Shift V</kbd>
                    </div>
                    <div class="settings-shortcut-row">
                      <span>{{ labels.hotkeysSettings }}</span>
                      <kbd>Ctrl ,</kbd>
                    </div>
                  </div>
                </div>
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
                    <span class="settings-value-pill">{{ labels.statusNotConfigured }}</span>
                  </div>
                </div>

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.aiContextTitle }}</strong>
                    <span>{{ labels.aiContextDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <span class="settings-readonly-toggle" :aria-label="labels.statusDisabled">
                      <span />
                    </span>
                  </div>
                </div>

                <div class="settings-form-line">
                  <div class="settings-form-copy">
                    <strong>{{ labels.aiPolicyTitle }}</strong>
                    <span>{{ labels.aiPolicyDescription }}</span>
                  </div>
                  <div class="settings-control">
                    <span class="settings-value-pill">{{ labels.statusPreview }}</span>
                  </div>
                </div>
              </div>
            </section>

            <section v-else-if="selectedSectionId === 'appearance'" class="settings-section">
              <div class="settings-form-list">
                <div class="settings-form-line settings-form-line-stacked">
                  <div class="settings-form-copy">
                    <strong>{{ labels.appearanceCardTitle }}</strong>
                  </div>
                  <div
                    class="settings-theme-inline-group"
                    role="tablist"
                    :aria-label="labels.appearanceCardTitle"
                  >
                    <button
                      v-for="mode in themeModes"
                      :key="mode"
                      class="settings-theme-inline-button"
                      :class="{ 'is-active': themeMode === mode }"
                      type="button"
                      :aria-pressed="themeMode === mode"
                      @click="themeMode = mode"
                    >
                      {{ labels.themeOptions[mode].label }}
                    </button>
                  </div>
                </div>

                <div class="settings-form-line settings-form-line-stacked">
                  <div class="settings-form-copy">
                    <strong>{{ labels.terminalColorsTitle }}</strong>
                  </div>
                  <div class="settings-terminal-colors-card">
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
                        <span class="settings-terminal-color-preview-line is-main">
                          build completed in 572ms
                        </span>
                      </div>
                    </div>

                    <div class="settings-terminal-color-fields">
                      <div class="settings-terminal-color-field">
                        <span>{{ labels.terminalForegroundLabel }}</span>
                        <div
                          class="settings-terminal-color-picker"
                          :style="{ backgroundColor: configTheme.palette.terminalForeground }"
                        >
                          <input
                            type="color"
                            :value="configTheme.palette.terminalForeground"
                            :aria-label="labels.terminalForegroundLabel"
                            @input="
                              updateThemePaletteColor(
                                'terminalForeground',
                                ($event.target as HTMLInputElement).value,
                              )
                            "
                          />
                        </div>
                      </div>

                      <div class="settings-terminal-color-field">
                        <span>{{ labels.terminalMutedLabel }}</span>
                        <div
                          class="settings-terminal-color-picker"
                          :style="{ backgroundColor: configTheme.palette.terminalMuted }"
                        >
                          <input
                            type="color"
                            :value="configTheme.palette.terminalMuted"
                            :aria-label="labels.terminalMutedLabel"
                            @input="
                              updateThemePaletteColor(
                                'terminalMuted',
                                ($event.target as HTMLInputElement).value,
                              )
                            "
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="settings-control settings-config-actions">
                    <button
                      class="settings-reset-button"
                      type="button"
                      @click="resetTerminalColors"
                    >
                      {{ labels.terminalColorsReset }}
                    </button>
                  </div>
                </div>

                <div class="settings-form-line settings-form-line-stacked">
                  <div class="settings-form-copy">
                    <strong>{{ labels.windowTransparencyTitle }}</strong>
                  </div>
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
                </div>
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
      width="680px"
      @close="closeDialog"
    >
      <header class="connection-dialog-header">
        <div class="connection-dialog-copy">
          <span class="connection-dialog-eyebrow">{{ labels.addConnection }}</span>
          <p>{{ labels.dialog.connectionEditSummary }}</p>
        </div>
        <div class="connection-dialog-actions">
          <button
            class="connection-dialog-close"
            type="button"
            :aria-label="labels.dialog.connectionCancel"
            @click="closeDialog"
          >
            <span />
          </button>
        </div>
      </header>

      <div class="connection-dialog-form-body">
        <div class="connection-editor-shell">
          <aside class="connection-editor-sidebar">
            <div class="connection-editor-preview connection-editor-preview-hero">
              <div class="connection-editor-preview-headline">
                <span class="connection-editor-method-badge">{{ methodLabel(draft.method) }}</span>
              </div>
              <strong>{{ draftIdentity }}</strong>
              <span>{{ draftEndpoint }}</span>
              <code>{{ draft.icon.trim() || 'fas fa-desktop' }}</code>
            </div>

            <div class="connection-editor-side-stack">
              <label class="connection-field">
                <span>{{ labels.dialog.connectionName }}</span>
                <div class="connection-field-control connection-field-control-rich">
                  <input v-model="draft.name" data-testid="connection-name" />
                </div>
              </label>

              <label class="connection-field">
                <span>{{ labels.dialog.connectionGroup }}</span>
                <div class="connection-field-control connection-field-control-rich">
                  <input v-model="draft.group" list="connection-group-options" />
                </div>
              </label>

              <label class="connection-field">
                <span>{{ labels.dialog.connectionIcon }}</span>
                <div class="connection-field-control connection-field-control-rich">
                  <input v-model="draft.icon" />
                </div>
              </label>
            </div>
          </aside>

          <section class="connection-editor-main">
            <nav class="connection-editor-tabs" :aria-label="labels.dialog.connectionLabel">
              <button
                v-for="tab in formTabs"
                :key="tab.id"
                class="connection-editor-tab"
                :class="{ 'is-active': activeFormTab === tab.id }"
                type="button"
                @click="activeFormTab = tab.id"
              >
                {{ tab.label }}
              </button>
            </nav>

            <div class="connection-editor-panel">
              <div v-if="activeFormTab === 'general'" class="connection-editor-stack">
                <div class="connection-form">
                  <label class="connection-field connection-field-full">
                    <span>{{ labels.dialog.connectionMethod }}</span>
                    <AppSelect
                      :model-value="draft.method"
                      :options="connectionMethodOptions"
                      :aria-label="labels.dialog.connectionMethod"
                      test-id="connection-method"
                      @update:model-value="updateDraft('method', $event as ConnectionMethod)"
                    />
                  </label>

                  <template v-if="draft.method === 'local'">
                    <label class="connection-field connection-field-full">
                      <span>{{ labels.dialog.connectionCwd }}</span>
                      <div class="connection-field-control connection-field-control-rich">
                        <input v-model="draft.cwd" />
                      </div>
                    </label>
                    <label class="connection-field connection-field-full">
                      <span>{{ labels.dialog.connectionShell }}</span>
                      <div class="connection-field-control connection-field-control-rich">
                        <input v-model="draft.shell" />
                      </div>
                    </label>
                  </template>

                  <template v-else-if="draft.method === 'serial'">
                    <label class="connection-field connection-field-full">
                      <span>{{ labels.dialog.connectionSerialPath }}</span>
                      <div class="connection-field-control connection-field-control-rich">
                        <input v-model="draft.serialPath" />
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
                        <input v-model="draft.shell" />
                      </div>
                    </label>
                  </template>

                  <template v-else>
                    <label class="connection-field">
                      <span>{{ labels.dialog.connectionHost }}</span>
                      <div class="connection-field-control connection-field-control-rich">
                        <input v-model="draft.host" data-testid="connection-host" />
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
                    <label class="connection-field">
                      <span>{{ labels.dialog.connectionUser }}</span>
                      <div class="connection-field-control connection-field-control-rich">
                        <input v-model="draft.user" data-testid="connection-user" />
                      </div>
                    </label>
                  </template>
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
                            draft.password.trim()
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
                          v-if="draft.password.trim()"
                          class="connection-dialog-danger-button"
                          type="button"
                          @click="updateDraft('password', '')"
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
                </template>
              </div>

              <div v-else-if="activeFormTab === 'ports'" class="connection-form">
                <label v-if="supportsPorts" class="connection-field connection-field-full">
                  <span>{{ labels.dialog.connectionForwardedPorts }}</span>
                  <small class="connection-field-hint">{{
                    labels.dialog.forwardedPortsHint
                  }}</small>
                  <div class="connection-field-control">
                    <textarea
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
                <div v-else class="connection-empty-state connection-editor-empty">
                  {{ labels.dialog.noPortsOptions }}
                </div>
              </div>

              <div v-else-if="activeFormTab === 'advanced'" class="connection-form">
                <label v-if="supportsAdvanced" class="connection-field connection-field-full">
                  <span>{{ labels.dialog.connectionFingerprint }}</span>
                  <div class="connection-field-control">
                    <textarea v-model="draft.fingerprint" rows="6" />
                  </div>
                </label>
                <div v-else class="connection-empty-state connection-editor-empty">
                  {{ labels.dialog.noAdvancedOptions }}
                </div>
              </div>

              <div v-else class="connection-form">
                <label class="connection-field connection-field-full">
                  <span>{{ labels.dialog.connectionLoginScripts }}</span>
                  <small class="connection-field-hint">{{ labels.dialog.loginScriptsHint }}</small>
                  <div class="connection-field-control">
                    <textarea v-model="draft.loginScripts" rows="8" />
                  </div>
                </label>
              </div>

              <div class="connection-form-actions">
                <button
                  class="connection-dialog-secondary-button"
                  type="button"
                  @click="closeDialog"
                >
                  {{ labels.dialog.connectionCancel }}
                </button>
                <button
                  v-if="
                    dialogIntent === 'edit' &&
                    editingConnection &&
                    editingConnection.id !== 'local-shell'
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
            </div>
          </section>
        </div>
      </div>

      <datalist id="connection-group-options">
        <option v-for="group in connectionGroups" :key="group" :value="group" />
      </datalist>
    </AppDialog>

    <AppDialog
      :open="passwordDialogOpen"
      :aria-label="labels.dialog.connectionPassword"
      panel-class="connection-dialog-password"
      width="380px"
      @close="passwordDialogOpen = false"
    >
      <div class="connection-dialog-form-body">
        <div class="password-dialog-content">
          <label class="connection-field connection-field-full">
            <span>{{ labels.dialog.connectionPassword }}</span>
            <div class="connection-field-control">
              <input v-model="passwordValue" autofocus type="password" />
            </div>
          </label>
        </div>
      </div>

      <footer class="connection-form-actions password-dialog-actions">
        <button
          class="connection-dialog-secondary-button"
          type="button"
          @click="passwordDialogOpen = false"
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
