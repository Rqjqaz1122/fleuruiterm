<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';

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

const activeTab = computed(
  () => workspace.value.tabs.find((tab) => tab.id === workspace.value.activeTabId) ?? null,
);

async function openTerminal(): Promise<void> {
  await runAction(() => store.openTab());
}

async function splitTerminal(direction: SplitDirection): Promise<void> {
  await runAction(() => store.splitFocused(direction));
}

async function closePane(paneId: string): Promise<void> {
  await runAction(() => store.closePane(paneId));
}

async function closeTab(tabId: string): Promise<void> {
  await runAction(() => store.closeTab(tabId));
}

async function runAction(action: () => Promise<void>): Promise<void> {
  if (actionPending.value) {
    return;
  }
  actionPending.value = true;
  try {
    await action();
  } catch {
    // Store actions publish a sanitized, user-visible error message.
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

    <p v-if="errorMessage" class="app-error" role="alert">{{ errorMessage }}</p>

    <section class="workspace" aria-label="Terminal workspace">
      <WorkspacePane
        v-if="activeTab"
        :node="activeTab.root"
        :focused-pane-id="workspace.focusedPaneId"
        @split="splitTerminal"
        @close="closePane"
      />
      <EmptyWorkspace v-else :pending="actionPending" @create="openTerminal" />
    </section>

    <StatusBar :snapshot="activeSnapshot" />
  </main>
</template>
