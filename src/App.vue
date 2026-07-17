<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';

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
import type { SplitDirection } from '@/domain/workspace';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const store = useWorkspaceStore();
const { workspace, activeSnapshot, errorMessage } = storeToRefs(store);
const actionPending = ref(false);
const retryAction = ref<(() => Promise<void>) | null>(null);
const settingsTabOpen = ref(false);
const activeAppTabId = ref<string | null>(workspace.value.activeTabId);
const lastActiveTerminalTabId = ref<string | null>(workspace.value.activeTabId);

const appTabs = computed<AppTab[]>(() => {
  const terminalTabs = workspace.value.tabs.map(toTerminalAppTab);
  return settingsTabOpen.value ? [...terminalTabs, createSettingsAppTab()] : terminalTabs;
});

const settingsActive = computed(() => activeAppTabId.value === SETTINGS_TAB_ID);

async function openTerminal(): Promise<void> {
  await runAction(async () => {
    await store.openTab();
    activeAppTabId.value = store.workspace.activeTabId;
    lastActiveTerminalTabId.value = store.workspace.activeTabId;
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
  } catch {
    // Store actions publish a sanitized, user-visible error message.
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
      @open-settings="openSettings"
    />

    <div v-if="errorMessage" class="app-error" role="alert">
      <span>{{ errorMessage }}</span>
      <button
        v-if="retryAction"
        class="error-retry"
        data-testid="retry-action"
        type="button"
        :disabled="actionPending"
        @click="retryLastAction"
      >
        Retry
      </button>
    </div>

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
        <SettingsView />
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
            :node="tab.root"
            :focused-pane-id="workspace.focusedPaneId"
            @split="splitTerminal"
            @close="closePane"
            @focus="store.focusPane"
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
