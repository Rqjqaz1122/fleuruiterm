import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setLocale } from '@/i18n/locale';
import { CONNECTION_PROFILES_CHANGED_EVENT } from '@/services/connectionProfiles';

import TerminalPane from './TerminalPane.vue';

const workspace = vi.hoisted(() => ({
  connectionProfileId: 'server-1' as string | null,
  reconnectPane: vi.fn(async () => undefined),
  state: 'ready' as string | null,
}));

interface MockTerminalAdapterOptions {
  shouldForwardInput?: (input: string) => boolean;
}

const terminalAdapterMock = vi.hoisted(() => ({
  focus: vi.fn(),
  options: [] as MockTerminalAdapterOptions[],
  writeSystemMessage: vi.fn(),
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: () => ({
    connectionProfileIdForSession: () => workspace.connectionProfileId,
    reconnectPane: workspace.reconnectPane,
    sessionStateForSession: () => workspace.state,
    nextOutputSequence: () => 1,
    subscribeToSession: () => () => undefined,
  }),
}));

vi.mock('@/terminal/terminalAdapter', () => ({
  TerminalAdapter: class MockTerminalAdapter {
    constructor(options: MockTerminalAdapterOptions) {
      terminalAdapterMock.options.push(options);
    }

    open() {}
    dispose() {}
    focus = terminalAdapterMock.focus;
    updateTheme() {}
    writeSystemMessage = terminalAdapterMock.writeSystemMessage;
    async acceptChunk() {}
  },
}));

vi.mock('@xterm/xterm', () => ({ Terminal: class {} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }));

describe('TerminalPane SFTP integration', () => {
  beforeEach(() => {
    setLocale('en-US');
    workspace.connectionProfileId = 'server-1';
    workspace.reconnectPane.mockClear();
    workspace.state = 'ready';
    terminalAdapterMock.focus.mockClear();
    terminalAdapterMock.options.length = 0;
    terminalAdapterMock.writeSystemMessage.mockClear();
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

  it('focuses the terminal input when the current pane mounts', async () => {
    mountPane();
    await flushPromises();

    expect(terminalAdapterMock.focus).toHaveBeenCalledOnce();
  });

  it('focuses the terminal input when the pane becomes current', async () => {
    const wrapper = mountPane(false);
    await flushPromises();
    expect(terminalAdapterMock.focus).not.toHaveBeenCalled();

    await wrapper.setProps({ focused: true });

    expect(terminalAdapterMock.focus).toHaveBeenCalledOnce();
  });

  it('opens the SFTP panel inside the current terminal pane', async () => {
    const wrapper = mountPane();
    await flushPromises();
    await wrapper.get('[data-testid="sftp-open"]').trigger('click');

    expect(wrapper.get('transition-stub').attributes('name')).toBe('sftp-drawer');
    expect(wrapper.get('.sftp-drawer-layer').find('sftp-panel-stub').exists()).toBe(true);

    await wrapper.get('[data-testid="sftp-open"]').trigger('click');
    expect(wrapper.find('sftp-panel-stub').exists()).toBe(false);
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

  it('prompts inside the terminal and reconnects only when Enter is pressed', async () => {
    workspace.state = 'closed';
    mountPane();
    await flushPromises();

    expect(terminalAdapterMock.writeSystemMessage).toHaveBeenCalledWith(
      expect.stringContaining('Press Enter to reconnect'),
    );
    const adapterOptions = terminalAdapterMock.options.at(-1);
    expect(adapterOptions?.shouldForwardInput?.('x')).toBe(false);
    expect(adapterOptions?.shouldForwardInput?.('pasted\ntext')).toBe(false);
    expect(workspace.reconnectPane).not.toHaveBeenCalled();

    expect(adapterOptions?.shouldForwardInput?.('\r')).toBe(false);
    await flushPromises();

    expect(workspace.reconnectPane).toHaveBeenCalledWith('pane-1');
  });

  it('keeps the terminal retryable when reconnection fails', async () => {
    workspace.state = 'failed';
    workspace.reconnectPane.mockRejectedValueOnce(new Error('network unreachable'));
    const wrapper = mountPane();
    await flushPromises();
    terminalAdapterMock.writeSystemMessage.mockClear();

    terminalAdapterMock.options.at(-1)?.shouldForwardInput?.('\r');
    await flushPromises();

    expect(terminalAdapterMock.writeSystemMessage).toHaveBeenCalledWith(
      expect.stringContaining('Reconnecting'),
    );
    expect(terminalAdapterMock.writeSystemMessage).toHaveBeenCalledWith(
      expect.stringContaining('Press Enter to try again'),
    );
    expect(wrapper.find('.pane-error').exists()).toBe(false);
  });
});

function mountPane(focused = true) {
  return mount(TerminalPane, {
    props: {
      tabId: 'tab-1',
      paneId: 'pane-1',
      sessionId: 'session-1',
      focused,
    },
    global: {
      stubs: { SftpPanel: true },
    },
  });
}
