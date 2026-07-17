import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorkspace } from '@/domain/workspace';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import App from './App.vue';

describe('FleurTerm app shell', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('opens a local terminal from the empty workspace', async () => {
    const store = useWorkspaceStore();
    store.openTab = vi.fn(async () => undefined);
    const wrapper = mount(App);

    await wrapper.get('[data-testid="new-terminal"]').trigger('click');

    expect(store.openTab).toHaveBeenCalledOnce();
  });

  it('renders active tabs and delegates vertical split', async () => {
    const store = useWorkspaceStore();
    store.workspace = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    store.snapshots = {
      'session-a': {
        sessionId: 'session-a',
        backendType: 'local',
        state: 'ready',
        shell: '/bin/zsh',
      },
    };
    store.splitFocused = vi.fn(async () => undefined);
    const wrapper = mount(App, {
      global: {
        stubs: {
          TerminalPane: {
            emits: ['split'],
            template:
              '<button data-testid="split-vertical" @click="$emit(\'split\', \'vertical\')">Split</button>',
          },
        },
      },
    });

    expect(wrapper.get('[role="tab"]').text()).toContain('Local Terminal 1');
    await wrapper.get('[data-testid="split-vertical"]').trigger('click');

    expect(store.splitFocused).toHaveBeenCalledWith('vertical');
  });

  it('shows a visible error without removing the workspace action', () => {
    const store = useWorkspaceStore();
    store.errorMessage = 'Unable to start shell';

    const wrapper = mount(App);

    expect(wrapper.get('[role="alert"]').text()).toContain('Unable to start shell');
    expect(wrapper.find('[data-testid="new-terminal"]').exists()).toBe(true);
  });
});

function ids(...values: string[]) {
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) {
      throw new Error('test ID generator exhausted');
    }
    index += 1;
    return value;
  };
}
