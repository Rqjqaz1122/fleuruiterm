import { shallowMount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import TerminalPane from '@/components/TerminalPane.vue';
import type { TerminalPaneNode } from '@/domain/workspace';

import WorkspacePane from './WorkspacePane.vue';

describe('WorkspacePane', () => {
  it('keys a terminal pane by session so reconnection remounts the adapter', async () => {
    const wrapper = shallowMount(WorkspacePane, {
      props: {
        tabId: 'tab-1',
        node: paneNode('session-a'),
        focusedPaneId: 'pane-1',
      },
    });

    expect(wrapper.getComponent(TerminalPane).vm.$.vnode.key).toBe('session-a');

    await wrapper.setProps({ node: paneNode('session-b') });

    expect(wrapper.getComponent(TerminalPane).vm.$.vnode.key).toBe('session-b');
  });
});

function paneNode(sessionId: string): TerminalPaneNode {
  return {
    kind: 'pane',
    id: 'pane-1',
    sessionId,
  };
}
