<script setup lang="ts">
import TerminalPane from '@/components/TerminalPane.vue';
import type { TerminalNode } from '@/domain/workspace';

defineOptions({ name: 'WorkspacePane' });

defineProps<{
  tabId: string;
  node: TerminalNode;
  focusedPaneId: string | null;
}>();

defineEmits<{
  close: [paneId: string];
  focus: [paneId: string];
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
      @close="$emit('close', $event)"
      @focus="$emit('focus', $event)"
    />
  </div>
  <TerminalPane
    v-else
    :tab-id="tabId"
    :pane-id="node.id"
    :session-id="node.sessionId"
    :focused="node.id === focusedPaneId"
    @close="$emit('close', $event)"
    @focus="$emit('focus', $event)"
  />
</template>
