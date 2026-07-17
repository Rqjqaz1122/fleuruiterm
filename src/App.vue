<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { nextTick, ref } from 'vue';

import AppTitleBar from '@/components/AppTitleBar.vue';
import SettingsView from '@/components/SettingsView.vue';
import StartPage from '@/components/StartPage.vue';
import StatusBar from '@/components/StatusBar.vue';
import TerminalTabs from '@/components/TerminalTabs.vue';
import WorkspacePane from '@/components/WorkspacePane.vue';
import type { SplitDirection } from '@/domain/workspace';
import { useWorkspaceStore } from '@/stores/workspaceStore';

type AppView = 'workspace' | 'settings';

interface AppTitleBarExposure {
  focusSettingsAction(): void;
}

const store = useWorkspaceStore();
const { workspace, activeSnapshot, errorMessage } = storeToRefs(store);
const actionPending = ref(false);
const appTitleBar = ref<AppTitleBarExposure | null>(null);
const currentView = ref<AppView>('workspace');
const retryAction = ref<(() => Promise<void>) | null>(null);

async function openTerminal(): Promise<void> {
  await runAction(async () => {
    await store.openTab();
    currentView.value = 'workspace';
  });
}

function openSettings(): void {
  currentView.value = 'settings';
}

function closeSettings(): void {
  currentView.value = 'workspace';
  void nextTick(() => appTitleBar.value?.focusSettingsAction());
}

function activateTerminalTab(tabId: string): void {
  store.activateTab(tabId);
  currentView.value = 'workspace';
}

async function splitTerminal(paneId: string, direction: SplitDirection): Promise<void> {
  await runAction(() => store.splitPaneById(paneId, direction));
}

async function closePane(paneId: string): Promise<void> {
  await runAction(() => store.closePane(paneId));
}

async function closeTab(tabId: string): Promise<void> {
  await runAction(() => store.closeTab(tabId));
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
    <AppTitleBar
      ref="appTitleBar"
      :settings-active="currentView === 'settings'"
      @open-settings="openSettings"
    />
    <TerminalTabs
      v-if="workspace.tabs.length > 0"
      :tabs="workspace.tabs"
      :active-tab-id="workspace.activeTabId"
      @activate="activateTerminalTab"
      @close="closeTab"
      @new-terminal="openTerminal"
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
      <SettingsView v-if="currentView === 'settings'" @close="closeSettings" />
      <section
        class="workspace"
        :class="{ 'settings-covered': currentView === 'settings' }"
        aria-label="Terminal workspace"
        :aria-hidden="currentView === 'settings'"
        :inert="currentView === 'settings'"
      >
        <div
          v-for="tab in workspace.tabs"
          :id="`terminal-panel-${tab.id}`"
          :key="tab.id"
          class="workspace-tab-panel"
          :class="{ active: tab.id === workspace.activeTabId }"
          role="tabpanel"
          :aria-hidden="tab.id !== workspace.activeTabId"
          :aria-labelledby="`terminal-tab-${tab.id}`"
          :inert="tab.id !== workspace.activeTabId"
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
