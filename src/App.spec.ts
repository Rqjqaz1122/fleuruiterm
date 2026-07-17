import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addTab, createWorkspace } from '@/domain/workspace';
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

    await wrapper.get('[data-testid="start-new-terminal"]').trigger('click');

    expect(store.openTab).toHaveBeenCalledOnce();
  });

  it('opens and closes the settings view from the start page', async () => {
    const wrapper = mount(App);

    await wrapper.get('[data-testid="start-settings"]').trigger('click');
    expect(wrapper.get('[aria-label="Settings"]').exists()).toBe(true);

    await wrapper.get('[data-testid="close-settings"]').trigger('click');
    expect(wrapper.get('[aria-label="FleurTerm start page"]').exists()).toBe(true);
  });

  it('returns to the terminal workspace when a tab is activated from settings', async () => {
    const store = useWorkspaceStore();
    store.workspace = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    const wrapper = mount(App, {
      global: { stubs: { TerminalPane: true } },
    });
    await wrapper.get('[data-testid="titlebar-settings"]').trigger('click');

    await wrapper.get('[role="tab"]').trigger('click');

    expect(wrapper.get('[aria-label="Terminal workspace"]').isVisible()).toBe(true);
    expect(store.workspace.activeTabId).toBe('tab-1');
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
    store.splitPaneById = vi.fn(async () => undefined);
    const wrapper = mount(App, {
      global: {
        stubs: {
          TerminalPane: {
            emits: ['split'],
            template:
              "<button data-testid=\"split-vertical\" @click=\"$emit('split', 'pane-1', 'vertical')\">Split</button>",
          },
        },
      },
    });

    expect(wrapper.get('[role="tab"]').text()).toContain('Local Terminal 1');
    await wrapper.get('[data-testid="split-vertical"]').trigger('click');

    expect(store.splitPaneById).toHaveBeenCalledWith('pane-1', 'vertical');
  });

  it('shows a visible error without removing the workspace action', () => {
    const store = useWorkspaceStore();
    store.errorMessage = 'Unable to start shell';

    const wrapper = mount(App);

    expect(wrapper.get('[role="alert"]').text()).toContain('Unable to start shell');
    expect(wrapper.find('[data-testid="start-new-terminal"]').exists()).toBe(true);
  });

  it('does not advertise unavailable AI capabilities', () => {
    const wrapper = mount(App);

    expect(wrapper.text()).not.toContain('AI: analysis only');
    expect(wrapper.text()).not.toContain('Local context');
  });

  it('offers to retry the terminal action after shell startup fails', async () => {
    const store = useWorkspaceStore();
    store.openTab = vi.fn(async () => {
      store.errorMessage = 'Unable to start shell';
      throw new Error('internal shell path');
    });
    const wrapper = mount(App);

    await wrapper.get('[data-testid="start-new-terminal"]').trigger('click');
    await wrapper.get('[data-testid="retry-action"]').trigger('click');

    expect(store.openTab).toHaveBeenCalledTimes(2);
    expect(wrapper.get('[role="alert"]').text()).toContain('Unable to start shell');
  });

  it('keeps inactive terminal tabs mounted for bounded background consumption', () => {
    const store = useWorkspaceStore();
    const first = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    store.workspace = addTab(first, 'session-b', ids('tab-2', 'pane-2'));
    const wrapper = mount(App, {
      global: {
        stubs: {
          TerminalPane: {
            props: ['paneId'],
            template: '<div class="terminal-stub" :data-pane-id="paneId" />',
          },
        },
      },
    });

    expect(wrapper.findAll('.terminal-stub')).toHaveLength(2);
    expect(wrapper.find('#terminal-panel-tab-1').attributes('aria-hidden')).toBe('true');
    expect(wrapper.find('#terminal-panel-tab-2').attributes('aria-hidden')).toBe('false');
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
