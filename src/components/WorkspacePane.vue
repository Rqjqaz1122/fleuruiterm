<script setup lang="ts">
import TerminalPane from '@/components/TerminalPane.vue';
import type { PaneDropPosition, SplitDirection, TerminalNode } from '@/domain/workspace';

defineOptions({ name: 'WorkspacePane' });

defineProps<{
  tabId: string;
  node: TerminalNode;
  focusedPaneId: string | null;
}>();

defineEmits<{
  split: [paneId: string, direction: SplitDirection];
  close: [paneId: string];
  focus: [paneId: string];
  dropTab: [sourceTabId: string, targetPaneId: string, position: PaneDropPosition];
}>();
</script>

<template>
  <div v-if="node.kind === 'split'" class="split-node" :class="`split-${node.direction}`">
    <WorkspacePane
      v-for="child in node.children"
      :key="child.id"
      :tab-id="tabId"
      :node="child"
      :focused-pane-id="focusedPaneId"
      @split="(paneId, direction) => $emit('split', paneId, direction)"
      @close="$emit('close', $event)"
      @focus="$emit('focus', $event)"
      @drop-tab="
        (sourceTabId, targetPaneId, position) =>
          $emit('dropTab', sourceTabId, targetPaneId, position)
      "
    />
  </div>
  <TerminalPane
    v-else
    :tab-id="tabId"
    :pane-id="node.id"
    :session-id="node.sessionId"
    :focused="node.id === focusedPaneId"
    @split="(paneId, direction) => $emit('split', paneId, direction)"
    @close="$emit('close', $event)"
    @focus="$emit('focus', $event)"
    @drop-tab="
      (sourceTabId, targetPaneId, position) => $emit('dropTab', sourceTabId, targetPaneId, position)
    "
  />
</template>
