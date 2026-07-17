<script setup lang="ts">
import TerminalPane from '@/components/TerminalPane.vue';
import type { SplitDirection, TerminalNode } from '@/domain/workspace';

defineOptions({ name: 'WorkspacePane' });

defineProps<{
  node: TerminalNode;
  focusedPaneId: string | null;
}>();

defineEmits<{
  split: [direction: SplitDirection];
  close: [paneId: string];
}>();
</script>

<template>
  <div v-if="node.kind === 'split'" class="split-node" :class="`split-${node.direction}`">
    <WorkspacePane
      v-for="child in node.children"
      :key="child.id"
      :node="child"
      :focused-pane-id="focusedPaneId"
      @split="$emit('split', $event)"
      @close="$emit('close', $event)"
    />
  </div>
  <TerminalPane
    v-else
    :pane-id="node.id"
    :session-id="node.sessionId"
    :focused="node.id === focusedPaneId"
    @split="$emit('split', $event)"
    @close="$emit('close', node.id)"
  />
</template>
