import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CONNECTION_PROFILES_CHANGED_EVENT } from '@/services/connectionProfiles';

import TerminalPane from './TerminalPane.vue';

const workspace = vi.hoisted(() => ({
  connectionProfileId: 'server-1' as string | null,
  state: 'ready' as string | null,
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: () => ({
    connectionProfileIdForSession: () => workspace.connectionProfileId,
    sessionStateForSession: () => workspace.state,
    nextOutputSequence: () => 1,
    subscribeToSession: () => () => undefined,
  }),
}));

vi.mock('@/terminal/terminalAdapter', () => ({
  TerminalAdapter: class {
    open() {}
    dispose() {}
    updateTheme() {}
    async acceptChunk() {}
  },
}));

vi.mock('@xterm/xterm', () => ({ Terminal: class {} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }));

describe('TerminalPane SFTP integration', () => {
  beforeEach(() => {
    workspace.connectionProfileId = 'server-1';
    workspace.state = 'ready';
    localStorage.setItem(
      'fleurterm.connections',
      JSON.stringify([
        {
          id: 'server-1',
          name: 'Production',
          method: 'ssh',
          host: '10.7.121.81',
          user: 'root',
          port: 22,
          authMethod: 'agent',
        },
      ]),
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  it('shows SFTP only for a ready pane opened from a saved SSH profile', async () => {
    const wrapper = mountPane();
    await flushPromises();
    expect(wrapper.find('[data-testid="sftp-open"]').exists()).toBe(true);

    workspace.connectionProfileId = null;
    const localWrapper = mountPane();
    await flushPromises();
    expect(localWrapper.find('[data-testid="sftp-open"]').exists()).toBe(false);
  });

  it('hides SFTP while the SSH terminal is not ready', async () => {
    workspace.state = 'starting';
    const wrapper = mountPane();
    await flushPromises();
    expect(wrapper.find('[data-testid="sftp-open"]').exists()).toBe(false);
  });

  it('opens the SFTP panel inside the current terminal pane', async () => {
    const wrapper = mountPane();
    await flushPromises();
    await wrapper.get('[data-testid="sftp-open"]').trigger('click');
    expect(wrapper.find('sftp-panel-stub').exists()).toBe(true);
  });

  it('closes and removes SFTP when the saved profile is deleted', async () => {
    const wrapper = mountPane();
    await flushPromises();
    await wrapper.get('[data-testid="sftp-open"]').trigger('click');
    localStorage.setItem('fleurterm.connections', '[]');

    window.dispatchEvent(new Event(CONNECTION_PROFILES_CHANGED_EVENT));
    await flushPromises();

    expect(wrapper.find('[data-testid="sftp-open"]').exists()).toBe(false);
    expect(wrapper.find('sftp-panel-stub').exists()).toBe(false);
  });
});

function mountPane() {
  return mount(TerminalPane, {
    props: {
      tabId: 'tab-1',
      paneId: 'pane-1',
      sessionId: 'session-1',
      focused: true,
    },
    global: {
      stubs: { SftpPanel: true },
    },
  });
}
