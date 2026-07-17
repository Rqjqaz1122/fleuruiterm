<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { ref } from 'vue';

import AppHeader from '@/components/AppHeader.vue';
import EmptyWorkspace from '@/components/EmptyWorkspace.vue';
import StatusBar from '@/components/StatusBar.vue';
import TerminalTabs from '@/components/TerminalTabs.vue';
import WorkspacePane from '@/components/WorkspacePane.vue';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { SplitDirection } from '@/domain/workspace';

const store = useWorkspaceStore();
const { workspace, activeSnapshot, errorMessage } = storeToRefs(store);
const actionPending = ref(false);
const retryAction = ref<(() => Promise<void>) | null>(null);

async function openTerminal(): Promise<void> {
  await runAction(() => store.openTab());
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
    <AppHeader :pending="actionPending" @new-terminal="openTerminal" />
    <TerminalTabs
      v-if="workspace.tabs.length > 0"
      :tabs="workspace.tabs"
      :active-tab-id="workspace.activeTabId"
      @activate="store.activateTab"
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

    <section class="workspace" aria-label="Terminal workspace">
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
      <EmptyWorkspace
        v-if="workspace.tabs.length === 0"
        :pending="actionPending"
        @create="openTerminal"
      />
    </section>

    <StatusBar :snapshot="activeSnapshot" />
  </main>
</template>
