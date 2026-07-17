<script setup lang="ts">
import TerminalPane from '@/components/TerminalPane.vue';
import type { SplitDirection, TerminalNode } from '@/domain/workspace';

defineOptions({ name: 'WorkspacePane' });

defineProps<{
  node: TerminalNode;
  focusedPaneId: string | null;
}>();

defineEmits<{
  split: [paneId: string, direction: SplitDirection];
  close: [paneId: string];
  focus: [paneId: string];
}>();
</script>

<template>
  <div v-if="node.kind === 'split'" class="split-node" :class="`split-${node.direction}`">
    <WorkspacePane
      v-for="child in node.children"
      :key="child.id"
      :node="child"
      :focused-pane-id="focusedPaneId"
      @split="(paneId, direction) => $emit('split', paneId, direction)"
      @close="$emit('close', $event)"
      @focus="$emit('focus', $event)"
    />
  </div>
  <TerminalPane
    v-else
    :pane-id="node.id"
    :session-id="node.sessionId"
    :focused="node.id === focusedPaneId"
    @split="(paneId, direction) => $emit('split', paneId, direction)"
    @close="$emit('close', $event)"
    @focus="$emit('focus', $event)"
  />
</template>
