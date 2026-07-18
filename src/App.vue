<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';

import SettingsView from '@/components/SettingsView.vue';
import type { WorkbenchConnection } from '@/components/SettingsView.vue';
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
import type {
  PaneDropPosition,
  SplitDirection,
  TabDropPlacement,
  TerminalTab,
} from '@/domain/workspace';
import { t, terminalTitle, type TranslationKey } from '@/i18n/locale';
import { useWorkspaceStore, type WorkspaceErrorCode } from '@/stores/workspaceStore';

const store = useWorkspaceStore();
const { workspace, activeSnapshot, errorMessage, errorCode } = storeToRefs(store);
const actionPending = ref(false);
const retryAction = ref<(() => Promise<void>) | null>(null);
const settingsTabOpen = ref(false);
const activeAppTabId = ref<string | null>(workspace.value.activeTabId);
const lastActiveTerminalTabId = ref<string | null>(workspace.value.activeTabId);
const appTabOrder = ref<string[]>([]);

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
    await store.openTab();
    activeAppTabId.value = store.workspace.activeTabId;
    lastActiveTerminalTabId.value = store.workspace.activeTabId;
  });
}

async function openWorkbenchConnection(connection: WorkbenchConnection): Promise<void> {
  await runAction(async () => {
    const openOptions = buildConnectionOpenOptions(connection);
    await store.openTab(openOptions);
    activeAppTabId.value = store.workspace.activeTabId;
    lastActiveTerminalTabId.value = store.workspace.activeTabId;
    settingsTabOpen.value = false;
  });
}

function buildConnectionOpenOptions(connection: WorkbenchConnection): {
  shell?: string;
  args?: string[];
  cwd?: string;
  title?: string;
} {
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
        ? ['-o', 'PreferredAuthentications=password,keyboard-interactive', '-o', 'PubkeyAuthentication=no']
        : []),
      ...buildSshForwardArgs(connection.forwardedPorts),
      ...(connection.authMethod === 'publicKey' && connection.privateKeys[0]
        ? ['-i', connection.privateKeys[0]]
        : []),
      target,
      ...(connection.loginScripts.trim() ? [connection.loginScripts.trim()] : []),
    ],
    password: connection.password || undefined,
    title: `SSH ${target}`,
  };
}

function buildSshForwardArgs(forwardedPorts: string[]): string[] {
  return forwardedPorts.flatMap((rule) => {
    const normalized = rule.trim();
    if (!normalized) {
      return [];
    }
    if (normalized.startsWith('-L ') || normalized.startsWith('-R ') || normalized.startsWith('-D ')) {
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

function activateAppTab(tabId: string): void {
  if (tabId === SETTINGS_TAB_ID) {
    openSettings();
    return;
  }
  store.activateTab(tabId);
  activeAppTabId.value = tabId;
  lastActiveTerminalTabId.value = tabId;
}

async function closeAppTab(tabId: string): Promise<void> {
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

function mergeDraggedTab(
  sourceTabId: string,
  targetPaneId: string,
  position: PaneDropPosition,
): void {
  const sourceTabExists = workspace.value.tabs.some((tab) => tab.id === sourceTabId);
  if (!sourceTabExists) {
    return;
  }
  store.mergeTabIntoPane(sourceTabId, targetPaneId, position);
  activeAppTabId.value = store.workspace.activeTabId;
  lastActiveTerminalTabId.value = store.workspace.activeTabId;
}

async function splitTerminal(paneId: string, direction: SplitDirection): Promise<void> {
  await runAction(() => store.splitPaneById(paneId, direction));
}

async function closePane(paneId: string): Promise<void> {
  await runAction(() => store.closePane(paneId));
}

async function retryLastAction(): Promise<void> {
  const action = retryAction.value;
  if (action !== null) {
    await runAction(action);
  }
}

async function runAction(action: () => Promise<void>): Promise<void> {
  if (actionPending.value) {
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
</script>

<template>
  <main class="app-shell">
    <TerminalTabs
      :tabs="appTabs"
      :active-tab-id="activeAppTabId"
      @activate="activateAppTab"
      @close="closeAppTab"
      @new-terminal="openTerminal"
      @open-recent="openSettings"
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

    <div class="app-content">
      <section
        v-if="settingsTabOpen"
        id="settings-panel"
        class="settings-tab-panel"
        role="tabpanel"
        :aria-hidden="!settingsActive"
        aria-labelledby="app-tab-app-settings"
        :inert="!settingsActive"
      >
        <SettingsView @open-connection="openWorkbenchConnection" />
      </section>
      <section
        class="workspace"
        :class="{ 'settings-covered': settingsActive }"
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
            @split="splitTerminal"
            @close="closePane"
            @focus="store.focusPane"
            @drop-tab="mergeDraggedTab"
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
