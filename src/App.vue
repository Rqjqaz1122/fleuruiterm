<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import AIPanel from '@/components/AIPanel.vue';
import SettingsView from '@/components/SettingsView.vue';
import StartPage from '@/components/StartPage.vue';
import StatusBar from '@/components/StatusBar.vue';
import TerminalTabs from '@/components/TerminalTabs.vue';
import WorkspacePane from '@/components/WorkspacePane.vue';
import {
  createSettingsAppTab,
  SETTINGS_TAB_ID,
  toTerminalAppTab,
  type AppTab,
} from '@/domain/appTab';
import type { TabDropPlacement, TerminalTab } from '@/domain/workspace';
import { t, terminalTitle, type TranslationKey } from '@/i18n/locale';
import type { AiAppAction, AiToolResult } from '@/services/aiToolProtocol';
import { resolveAppShortcut, type AppCommand } from '@/services/appShortcuts';
import { desktopMenuClient } from '@/services/desktopMenuClient';
import { detectDesktopPlatform } from '@/services/desktopPlatform';
import { desktopWindowLifecycleClient } from '@/services/desktopWindowLifecycleClient';
import {
  findSavedConnectionProfile,
  loadSavedConnectionProfiles,
  summarizeSavedConnections,
  type OpenableConnectionProfile,
  type SavedConnectionSummary,
} from '@/services/connectionProfiles';
import { settingsClient } from '@/services/settingsClient';
import {
  createPersistedWorkspace,
  workspacePersistenceClient,
  type PersistedTerminalTab,
} from '@/services/workspacePersistence';
import { setLocale } from '@/i18n/locale';
import { useAppSettingsStore } from '@/stores/appSettingsStore';
import { useAppUpdateStore } from '@/stores/appUpdateStore';
import {
  useWorkspaceStore,
  type OpenTerminalTabOptions,
  type WorkspaceErrorCode,
} from '@/stores/workspaceStore';

const AI_PANEL_WIDTH_STORAGE_KEY = 'fleurterm.aiPanelWidth';
const DEFAULT_AI_PANEL_WIDTH = 380;
const MIN_AI_PANEL_WIDTH = 320;
const MAX_AI_PANEL_WIDTH = 720;

const store = useWorkspaceStore();
const appSettings = useAppSettingsStore();
const appUpdate = useAppUpdateStore();
const shortcutPlatform = detectDesktopPlatform() === 'macos' ? 'macos' : 'default';
const { workspace, activeSnapshot, errorMessage, errorCode } = storeToRefs(store);
const actionPending = ref(false);
const retryAction = ref<(() => Promise<void>) | null>(null);
const settingsTabOpen = ref(false);
const aiPanelOpen = ref(false);
const aiPanelWidth = ref(loadAiPanelWidth());
const activeAppTabId = ref<string | null>(workspace.value.activeTabId);
const lastActiveTerminalTabId = ref<string | null>(workspace.value.activeTabId);
const appTabOrder = ref<string[]>([]);
const appContentStyle = computed<Record<string, string>>(() => ({
  '--ai-panel-width': `${aiPanelWidth.value}px`,
}));
let removeDesktopMenuListener: (() => void) | null = null;
let removeApplicationExitListener: (() => void) | null = null;
let removeWindowCloseListener: (() => void) | null = null;
let appDisposed = false;
let workspaceClosing = false;
let workspaceClosePromise: Promise<boolean> | null = null;
let workspacePersistenceReady = false;
let workspaceRestorePromise: Promise<void> = Promise.resolve();
let workspaceSaveQueue = Promise.resolve();

watch(
  () => [
    ...workspace.value.tabs.map((tab) => tab.id),
    ...(settingsTabOpen.value ? [SETTINGS_TAB_ID] : []),
  ],
  (availableTabIds) => {
    const availableTabIdSet = new Set(availableTabIds);
    appTabOrder.value = [
      ...appTabOrder.value.filter((tabId) => availableTabIdSet.has(tabId)),
      ...availableTabIds.filter((tabId) => !appTabOrder.value.includes(tabId)),
    ];
  },
  { immediate: true, flush: 'sync' },
);

watch(workspace, (nextWorkspace) => {
  if (!workspacePersistenceReady || workspaceClosing) {
    return;
  }
  enqueueWorkspaceSave(createPersistedWorkspace(nextWorkspace));
});

onMounted(() => {
  void appUpdate.checkAtStartup();
  workspaceRestorePromise = restoreTerminalWorkspace().finally(() => {
    workspacePersistenceReady = true;
  });
  window.addEventListener('keydown', handleApplicationKeyDown);
  void desktopMenuClient
    .listen((command) => void executeAppCommand(command))
    .then((unlisten) => {
      if (appDisposed) {
        unlisten();
        return;
      }
      removeDesktopMenuListener = unlisten;
    });
  void desktopWindowLifecycleClient
    .listenForCloseRequest(flushWorkspaceBeforeClose, cancelWorkspaceClose)
    .then((unlisten) => {
      if (appDisposed) {
        unlisten();
        return;
      }
      removeWindowCloseListener = unlisten;
    });
  void desktopWindowLifecycleClient
    .listenForApplicationExitRequest(flushWorkspaceBeforeClose, cancelWorkspaceClose)
    .then((unlisten) => {
      if (appDisposed) {
        unlisten();
        return;
      }
      removeApplicationExitListener = unlisten;
    });
});

onBeforeUnmount(() => {
  appDisposed = true;
  window.removeEventListener('keydown', handleApplicationKeyDown);
  removeDesktopMenuListener?.();
  removeDesktopMenuListener = null;
  removeApplicationExitListener?.();
  removeApplicationExitListener = null;
  removeWindowCloseListener?.();
  removeWindowCloseListener = null;
});

appUpdate.setBeforeRestart(flushWorkspaceBeforeClose);
appUpdate.setRestartFailureHandler(cancelWorkspaceClose);

const appTabs = computed<AppTab[]>(() => {
  const terminalTabs = workspace.value.tabs.map((tab, index) =>
    toTerminalAppTab(tab, terminalTitle(resolveTerminalSequence(tab, index + 1))),
  );
  const availableTabs = settingsTabOpen.value
    ? [...terminalTabs, createSettingsAppTab(t('tabs.settings'))]
    : terminalTabs;
  const tabById = new Map(availableTabs.map((tab) => [tab.id, tab]));
  return appTabOrder.value.flatMap((tabId) => {
    const tab = tabById.get(tabId);
    return tab === undefined ? [] : [tab];
  });
});

const settingsActive = computed(() => activeAppTabId.value === SETTINGS_TAB_ID);
const errorMessageKeyByCode: Record<WorkspaceErrorCode, TranslationKey> = {
  OPEN_TERMINAL_FAILED: 'error.openTerminal',
  CLOSE_TERMINAL_FAILED: 'error.closeTerminal',
  CLOSE_TAB_FAILED: 'error.closeTab',
  INTERRUPT_TERMINAL_FAILED: 'error.writeTerminal',
  PERSIST_WORKSPACE_FAILED: 'error.persistWorkspace',
  WRITE_TERMINAL_FAILED: 'error.writeTerminal',
};
const visibleErrorMessage = computed(() => {
  if (errorMessage.value === null) {
    return null;
  }
  return errorCode.value === null ? errorMessage.value : t(errorMessageKeyByCode[errorCode.value]);
});

function resolveTerminalSequence(tab: TerminalTab, fallbackSequence: number): number {
  const sequenceMatch = /(\d+)$/.exec(tab.title);
  if (sequenceMatch === null) {
    return fallbackSequence;
  }
  const sequence = Number.parseInt(sequenceMatch[1] ?? '', 10);
  return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : fallbackSequence;
}

async function openTerminal(): Promise<void> {
  await runAction(async () => {
    await workspaceRestorePromise;
    await store.openTab();
    activeAppTabId.value = store.workspace.activeTabId;
    lastActiveTerminalTabId.value = store.workspace.activeTabId;
  });
}

async function openWorkbenchConnection(connection: OpenableConnectionProfile): Promise<void> {
  await runAction(async () => {
    await workspaceRestorePromise;
    const openOptions = buildConnectionOpenOptions(connection);
    await store.openTab({ ...openOptions, connectionProfileId: connection.id });
    activeAppTabId.value = store.workspace.activeTabId;
    lastActiveTerminalTabId.value = store.workspace.activeTabId;
    settingsTabOpen.value = false;
  });
}

function buildConnectionOpenOptions(connection: OpenableConnectionProfile): OpenTerminalTabOptions {
  if (connection.method === 'local') {
    return {
      shell: connection.shell || undefined,
      cwd: connection.cwd || undefined,
      title: connection.name,
    };
  }

  if (connection.method === 'telnet') {
    return {
      shell: 'telnet',
      args: [connection.host, String(connection.port || 23)],
      title: `Telnet ${connection.host}`,
    };
  }

  if (connection.method === 'serial') {
    throw new Error('Serial connections are not supported by the current terminal backend yet');
  }

  const target = `${connection.user}@${connection.host}`;
  return {
    shell: 'ssh',
    args: [
      '-p',
      String(connection.port || 22),
      ...(connection.authMethod === 'password'
        ? [
            '-o',
            'PreferredAuthentications=password,keyboard-interactive',
            '-o',
            'PubkeyAuthentication=no',
          ]
        : []),
      ...buildSshForwardArgs(connection.forwardedPorts),
      ...(connection.authMethod === 'publicKey' && connection.privateKeys[0]
        ? ['-i', connection.privateKeys[0]]
        : []),
      target,
      ...(connection.loginScripts.trim() ? [connection.loginScripts.trim()] : []),
    ],
    ...(connection.password ? { password: connection.password } : {}),
    title: `SSH ${target}`,
  };
}

async function restoreTerminalWorkspace(): Promise<void> {
  const persistedWorkspace = await workspacePersistenceClient.load();
  if (persistedWorkspace === null || persistedWorkspace.tabs.length === 0) {
    return;
  }

  const savedConnections = loadSavedConnectionProfiles();
  let restoredActiveTabId: string | null = null;
  let restoreFailed = false;
  for (const persistedTab of persistedWorkspace.tabs) {
    try {
      const openOptions = await buildRestoredTabOptions(persistedTab, savedConnections);
      if (openOptions === null) {
        restoreFailed = true;
        continue;
      }
      await store.openTab(openOptions);
      if (persistedTab.id === persistedWorkspace.activeTabId) {
        restoredActiveTabId = store.workspace.activeTabId;
      }
    } catch {
      restoreFailed = true;
    }
  }

  if (restoreFailed && store.workspace.tabs.length === 0) {
    errorCode.value = 'OPEN_TERMINAL_FAILED';
    errorMessage.value = 'Unable to restore terminal workspace';
  }

  const nextActiveTabId = restoredActiveTabId ?? store.workspace.activeTabId;
  if (nextActiveTabId !== null) {
    store.activateTab(nextActiveTabId);
  }
  activeAppTabId.value = nextActiveTabId;
  lastActiveTerminalTabId.value = nextActiveTabId;
}

async function buildRestoredTabOptions(
  tab: PersistedTerminalTab,
  savedConnections: OpenableConnectionProfile[],
): Promise<OpenTerminalTabOptions | null> {
  if (tab.launch.type === 'local') {
    return {
      ...(tab.launch.shell === undefined ? {} : { shell: tab.launch.shell }),
      ...(tab.launch.args === undefined ? {} : { args: [...tab.launch.args] }),
      ...(tab.launch.cwd === undefined ? {} : { cwd: tab.launch.cwd }),
      title: tab.title,
    };
  }

  const connection = savedConnections.find(
    (candidate) => candidate.id === tab.launch.connectionProfileId,
  );
  if (connection === undefined) {
    return null;
  }
  const connectionWithPassword = await loadConnectionPassword(connection);
  return {
    ...buildConnectionOpenOptions(connectionWithPassword),
    title: tab.title,
    connectionProfileId: connection.id,
  };
}

function buildSshForwardArgs(forwardedPorts: string[]): string[] {
  return forwardedPorts.flatMap((rule) => {
    const normalized = rule.trim();
    if (!normalized) {
      return [];
    }
    if (
      normalized.startsWith('-L ') ||
      normalized.startsWith('-R ') ||
      normalized.startsWith('-D ')
    ) {
      const [flag, ...rest] = normalized.split(/\s+/);
      const value = rest.join(' ');
      return value ? [flag, value] : [];
    }
    if (normalized.startsWith('L ') || normalized.startsWith('R ') || normalized.startsWith('D ')) {
      const [kind, ...rest] = normalized.split(/\s+/);
      const value = rest.join(' ');
      return value ? [`-${kind}`, value] : [];
    }
    return ['-L', normalized];
  });
}

function openSettings(): void {
  settingsTabOpen.value = true;
  activeAppTabId.value = SETTINGS_TAB_ID;
}

function toggleAiPanel(): void {
  aiPanelOpen.value = !aiPanelOpen.value;
}

function handleApplicationKeyDown(event: KeyboardEvent): void {
  const command = resolveAppShortcut(event, appSettings.shortcutSettings.value, shortcutPlatform);
  if (command === null) {
    return;
  }
  event.preventDefault();
  void executeAppCommand(command);
}

async function executeAppCommand(command: AppCommand): Promise<void> {
  switch (command) {
    case 'new-terminal':
      await openTerminal();
      return;
    case 'close-tab':
      if (activeAppTabId.value !== null) {
        await closeAppTab(activeAppTabId.value);
      }
      return;
    case 'next-tab':
      activateRelativeAppTab(1);
      return;
    case 'previous-tab':
      activateRelativeAppTab(-1);
      return;
    case 'open-settings':
      openSettings();
      return;
    case 'toggle-ai':
      toggleAiPanel();
      return;
    case 'clear-terminal':
      if (!settingsActive.value && workspace.value.focusedPaneId !== null) {
        await runAction(() => store.writeToFocusedSession('\x0c'));
      }
      return;
  }
}

function activateRelativeAppTab(offset: -1 | 1): void {
  const tabIds = appTabs.value.map((tab) => tab.id);
  if (tabIds.length < 2) {
    return;
  }
  const currentIndex = tabIds.indexOf(activeAppTabId.value ?? '');
  const nextIndex = (Math.max(0, currentIndex) + offset + tabIds.length) % tabIds.length;
  activateAppTab(tabIds[nextIndex]);
}

function resizeAiPanel(width: number): void {
  aiPanelWidth.value = clampAiPanelWidth(width);
  persistAiPanelWidth(aiPanelWidth.value);
}

async function runAiAppAction(action: AiAppAction): Promise<AiToolResult> {
  const callId = `app-${Date.now()}-${action.type}`;
  try {
    await executeAiAppAction(action);
    return {
      callId,
      outcome: 'completed',
      command: action.type,
      output: 'Application action submitted successfully.',
      truncated: false,
    };
  } catch (error) {
    return {
      callId,
      outcome: 'failed',
      command: action.type,
      output: '',
      truncated: false,
      errorMessage: error instanceof Error ? error.message : 'Application action failed',
    };
  }
}

async function executeAiAppAction(action: AiAppAction): Promise<void> {
  if (workspaceClosing) {
    throw new Error('Application is closing');
  }
  await workspaceRestorePromise;
  switch (action.type) {
    case 'terminal.write':
      await store.writeToFocusedSession(
        action.input.endsWith('\r') || action.input.endsWith('\n')
          ? action.input
          : `${action.input}\r`,
      );
      return;
    case 'terminal.activate': {
      const normalizedTarget = action.target.trim().toLocaleLowerCase();
      const targetTab = workspace.value.tabs.find(
        (tab) =>
          tab.id.toLocaleLowerCase() === normalizedTarget ||
          tab.title.trim().toLocaleLowerCase() === normalizedTarget,
      );
      if (targetTab === undefined) {
        throw new Error(`Terminal "${action.target}" was not found.`);
      }
      activateAppTab(targetTab.id);
      return;
    }
    case 'connection.open': {
      const connection = findSavedConnectionProfile(loadSavedConnectionProfiles(), action.target);
      if (connection === null) {
        throw new Error(`Saved connection "${action.target}" was not found.`);
      }
      await openWorkbenchConnection(await loadConnectionPassword(connection));
      return;
    }
    case 'terminal.openLocal':
      await store.openTab({
        shell: action.shell,
        cwd: action.cwd,
        title: action.title,
      });
      activeAppTabId.value = store.workspace.activeTabId;
      lastActiveTerminalTabId.value = store.workspace.activeTabId;
      return;
    case 'terminal.openSsh':
      await store.openTab({
        shell: 'ssh',
        args: ['-p', String(action.port ?? 22), `${action.user}@${action.host}`],
        title: action.title ?? `SSH ${action.user}@${action.host}`,
      });
      activeAppTabId.value = store.workspace.activeTabId;
      lastActiveTerminalTabId.value = store.workspace.activeTabId;
      return;
    case 'settings.updateTerminal':
      appSettings.updateTerminalSettings(action.patch);
      return;
    case 'settings.updateAi':
      appSettings.updateAiSettings(action.patch);
      return;
    case 'settings.setLocale':
      setLocale(action.locale);
      return;
    case 'settings.open':
      openSettings();
      return;
  }
}

async function loadConnectionPassword(
  connection: OpenableConnectionProfile,
): Promise<OpenableConnectionProfile> {
  if (!connection.hasPassword) {
    return connection;
  }
  const passwords = await settingsClient.loadPasswords([connection.id]);
  const password = passwords[connection.id];
  if (!password) {
    throw new Error(`The password for saved connection "${connection.name}" is unavailable.`);
  }
  return { ...connection, password };
}

function listSavedConnections(): SavedConnectionSummary[] {
  return summarizeSavedConnections(loadSavedConnectionProfiles());
}

function activateAppTab(tabId: string): void {
  if (workspaceClosing) {
    return;
  }
  if (!workspacePersistenceReady) {
    void workspaceRestorePromise.then(
      () => activateAppTab(tabId),
      () => undefined,
    );
    return;
  }
  if (tabId === SETTINGS_TAB_ID) {
    openSettings();
    return;
  }
  store.activateTab(tabId);
  activeAppTabId.value = tabId;
  lastActiveTerminalTabId.value = tabId;
}

async function closeAppTab(tabId: string): Promise<void> {
  if (workspaceClosing) {
    return;
  }
  await workspaceRestorePromise;
  if (tabId === SETTINGS_TAB_ID) {
    closeSettingsTab();
    return;
  }
  await runAction(() => store.closeTab(tabId));
  const closedTabStillExists = workspace.value.tabs.some((tab) => tab.id === tabId);
  if (activeAppTabId.value === tabId && !closedTabStillExists) {
    activeAppTabId.value = store.workspace.activeTabId;
    lastActiveTerminalTabId.value = store.workspace.activeTabId;
  }
}

function closeSettingsTab(): void {
  if (workspaceClosing) {
    return;
  }
  settingsTabOpen.value = false;
  const fallbackTabId = lastActiveTerminalTabId.value;
  const fallbackExists = workspace.value.tabs.some((tab) => tab.id === fallbackTabId);
  const nextTabId = fallbackExists ? fallbackTabId : workspace.value.activeTabId;
  activeAppTabId.value = nextTabId;
  if (nextTabId !== null) {
    store.activateTab(nextTabId);
    lastActiveTerminalTabId.value = nextTabId;
  }
}

function reorderApplicationTabs(
  sourceTabId: string,
  targetTabId: string,
  placement: TabDropPlacement,
): void {
  if (workspaceClosing) {
    return;
  }
  if (!workspacePersistenceReady) {
    void workspaceRestorePromise.then(
      () => reorderApplicationTabs(sourceTabId, targetTabId, placement),
      () => undefined,
    );
    return;
  }
  if (sourceTabId === targetTabId) {
    return;
  }
  const sourceIndex = appTabOrder.value.indexOf(sourceTabId);
  const targetIndex = appTabOrder.value.indexOf(targetTabId);
  if (sourceIndex < 0 || targetIndex < 0) {
    return;
  }
  const nextOrder = appTabOrder.value.filter((tabId) => tabId !== sourceTabId);
  const adjustedTargetIndex = nextOrder.indexOf(targetTabId);
  const insertionIndex = placement === 'before' ? adjustedTargetIndex : adjustedTargetIndex + 1;
  nextOrder.splice(insertionIndex, 0, sourceTabId);
  appTabOrder.value = nextOrder;

  const sourceIsTerminal = workspace.value.tabs.some((tab) => tab.id === sourceTabId);
  const targetIsTerminal = workspace.value.tabs.some((tab) => tab.id === targetTabId);
  if (sourceIsTerminal && targetIsTerminal) {
    store.reorderTabById(sourceTabId, targetTabId, placement);
  }
}

async function closePane(paneId: string): Promise<void> {
  if (workspaceClosing) {
    return;
  }
  await workspaceRestorePromise;
  await runAction(() => store.closePane(paneId));
}

function focusPane(paneId: string): void {
  if (!workspaceClosing) {
    store.focusPane(paneId);
  }
}

function enqueueWorkspaceSave(
  persistedWorkspace: ReturnType<typeof createPersistedWorkspace>,
): void {
  workspaceSaveQueue = workspaceSaveQueue
    .catch(() => undefined)
    .then(() => workspacePersistenceClient.save(persistedWorkspace));
  void workspaceSaveQueue.then(clearWorkspacePersistenceError, publishWorkspacePersistenceError);
}

async function flushWorkspaceBeforeClose(): Promise<boolean> {
  if (workspaceClosePromise !== null) {
    return workspaceClosePromise;
  }
  workspaceClosing = true;
  const closePromise = performFinalWorkspaceSave();
  workspaceClosePromise = closePromise;
  void closePromise.then((canClose) => {
    if (!canClose && workspaceClosePromise === closePromise) {
      workspaceClosing = false;
      workspaceClosePromise = null;
    }
  });
  return closePromise;
}

async function performFinalWorkspaceSave(): Promise<boolean> {
  await workspaceRestorePromise.catch(() => undefined);
  const finalWorkspace = createPersistedWorkspace(workspace.value);
  const finalSave = workspaceSaveQueue
    .catch(() => undefined)
    .then(() => workspacePersistenceClient.save(finalWorkspace));
  workspaceSaveQueue = finalSave;
  try {
    await finalSave;
    clearWorkspacePersistenceError();
    return true;
  } catch {
    publishWorkspacePersistenceError();
    return false;
  }
}

function publishWorkspacePersistenceError(): void {
  errorCode.value = 'PERSIST_WORKSPACE_FAILED';
  errorMessage.value = 'Unable to save terminal workspace';
}

function clearWorkspacePersistenceError(): void {
  if (errorCode.value !== 'PERSIST_WORKSPACE_FAILED') {
    return;
  }
  errorCode.value = null;
  errorMessage.value = null;
}

function cancelWorkspaceClose(): void {
  workspaceClosing = false;
  workspaceClosePromise = null;
}

async function retryLastAction(): Promise<void> {
  const action = retryAction.value;
  if (action !== null) {
    await runAction(action);
  }
}

async function runAction(action: () => Promise<void>): Promise<void> {
  if (actionPending.value || workspaceClosing) {
    return;
  }
  actionPending.value = true;
  try {
    await action();
    retryAction.value = null;
  } catch (error) {
    // Store actions publish a sanitized, user-visible error message.
    if (errorMessage.value === null) {
      errorCode.value = null;
      errorMessage.value = error instanceof Error ? error.message : 'Unable to open terminal';
    }
    retryAction.value = action;
  } finally {
    actionPending.value = false;
  }
}

function loadAiPanelWidth(): number {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_AI_PANEL_WIDTH;
  }
  const storedWidth = localStorage.getItem(AI_PANEL_WIDTH_STORAGE_KEY);
  return storedWidth === null ? DEFAULT_AI_PANEL_WIDTH : clampAiPanelWidth(Number(storedWidth));
}

function persistAiPanelWidth(width: number): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(AI_PANEL_WIDTH_STORAGE_KEY, String(width));
}

function clampAiPanelWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return DEFAULT_AI_PANEL_WIDTH;
  }
  return Math.min(Math.max(Math.round(width), MIN_AI_PANEL_WIDTH), MAX_AI_PANEL_WIDTH);
}
</script>

<template>
  <main class="app-shell">
    <TerminalTabs
      :tabs="appTabs"
      :active-tab-id="activeAppTabId"
      :ai-open="aiPanelOpen"
      @activate="activateAppTab"
      @close="closeAppTab"
      @new-terminal="openTerminal"
      @open-a-i="toggleAiPanel"
      @open-settings="openSettings"
      @reorder="reorderApplicationTabs"
      @drag-hover="activateAppTab"
    />

    <Transition name="notice">
      <div v-if="visibleErrorMessage" class="app-error" role="alert">
        <span>{{ visibleErrorMessage }}</span>
        <button
          v-if="retryAction"
          class="error-retry"
          data-testid="retry-action"
          type="button"
          :disabled="actionPending"
          @click="retryLastAction"
        >
          {{ t('app.retry') }}
        </button>
      </div>
    </Transition>

    <div class="app-content" :style="appContentStyle">
      <Transition name="ai-panel-slide">
        <AIPanel
          v-if="aiPanelOpen"
          :snapshot="activeSnapshot"
          :width="aiPanelWidth"
          :run-app-action="runAiAppAction"
          :list-saved-connections="listSavedConnections"
          @close="aiPanelOpen = false"
          @resize="resizeAiPanel"
        />
      </Transition>

      <section
        v-if="settingsTabOpen"
        id="settings-panel"
        class="settings-tab-panel"
        :class="{ 'ai-panel-open': aiPanelOpen }"
        role="tabpanel"
        :aria-hidden="!settingsActive"
        aria-labelledby="app-tab-app-settings"
        :inert="!settingsActive"
      >
        <SettingsView @open-connection="openWorkbenchConnection" />
      </section>
      <section
        class="workspace"
        :class="{ 'settings-covered': settingsActive, 'ai-panel-open': aiPanelOpen }"
        aria-label="Terminal workspace"
        :aria-hidden="settingsActive"
        :inert="settingsActive"
      >
        <div
          v-for="tab in workspace.tabs"
          :id="`terminal-panel-${tab.id}`"
          :key="tab.id"
          class="workspace-tab-panel"
          :class="{ active: tab.id === activeAppTabId && !settingsActive }"
          role="tabpanel"
          :aria-hidden="tab.id !== activeAppTabId || settingsActive"
          :aria-labelledby="`app-tab-${tab.id}`"
          :inert="tab.id !== activeAppTabId || settingsActive"
        >
          <WorkspacePane
            :tab-id="tab.id"
            :node="tab.root"
            :focused-pane-id="workspace.focusedPaneId"
            @close="closePane"
            @focus="focusPane"
          />
        </div>
        <StartPage
          v-if="workspace.tabs.length === 0"
          :pending="actionPending"
          aria-label="FleurTerm start page"
          @create-terminal="openTerminal"
          @open-settings="openSettings"
        />
      </section>
    </div>

    <StatusBar :snapshot="activeSnapshot" />
  </main>
</template>
