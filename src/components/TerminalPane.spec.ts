import { readFileSync } from 'node:fs';

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import { setLocale } from '@/i18n/locale';
import { CONNECTION_PROFILES_CHANGED_EVENT } from '@/services/connectionProfiles';
import { contextMenu, type ContextMenuActionEntry } from '@/services/contextMenu';

import AppContextMenu from './AppContextMenu.vue';
import TerminalPane from './TerminalPane.vue';

const globalStyles = readFileSync('src/styles/global.css', 'utf8');

const workspace = vi.hoisted(() => ({
  connectionProfileId: 'server-1' as string | null,
  reconnectPane: vi.fn(async () => undefined),
  state: 'ready' as string | null,
  writeToSession: vi.fn(async () => undefined),
}));

const clipboardMock = vi.hoisted(() => ({
  readText: vi.fn(async () => ''),
  writeText: vi.fn(async () => undefined),
}));

interface MockTerminalAdapterOptions {
  shouldForwardInput?: (input: string) => boolean;
}

const terminalAdapterMock = vi.hoisted(() => ({
  focus: vi.fn(),
  getSelection: vi.fn(() => ''),
  options: [] as MockTerminalAdapterOptions[],
  paste: vi.fn(),
  selectAll: vi.fn(),
  writeSystemMessage: vi.fn(),
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: () => ({
    connectionProfileIdForSession: () => workspace.connectionProfileId,
    reconnectPane: workspace.reconnectPane,
    sessionStateForSession: () => workspace.state,
    nextOutputSequence: () => 1,
    subscribeToSession: () => () => undefined,
    writeToSession: workspace.writeToSession,
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
    getSelection = terminalAdapterMock.getSelection;
    paste = terminalAdapterMock.paste;
    selectAll = terminalAdapterMock.selectAll;
    updateTheme() {}
    writeSystemMessage = terminalAdapterMock.writeSystemMessage;
    async acceptChunk() {}
  },
}));

vi.mock('@xterm/xterm', () => ({ Terminal: class {} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }));

describe('TerminalPane', () => {
  beforeEach(() => {
    setLocale('en-US');
    workspace.connectionProfileId = 'server-1';
    workspace.reconnectPane.mockClear();
    workspace.state = 'ready';
    workspace.writeToSession.mockClear();
    clipboardMock.readText.mockReset();
    clipboardMock.readText.mockResolvedValue('');
    clipboardMock.writeText.mockReset();
    clipboardMock.writeText.mockResolvedValue(undefined);
    contextMenu.close();
    terminalAdapterMock.focus.mockClear();
    terminalAdapterMock.focus.mockImplementation(() => undefined);
    terminalAdapterMock.getSelection.mockReset();
    terminalAdapterMock.getSelection.mockReturnValue('');
    terminalAdapterMock.options.length = 0;
    terminalAdapterMock.paste.mockClear();
    terminalAdapterMock.selectAll.mockClear();
    terminalAdapterMock.writeSystemMessage.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboardMock,
    });
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

  it('prevents selecting the terminal pane toolbar', () => {
    const paneToolbarRule = /(?:^|\n)\.pane-toolbar\s*\{([^}]*)\}/.exec(globalStyles)?.[1];

    expect(paneToolbarRule).toBeDefined();
    expect(paneToolbarRule).toContain('-webkit-user-select: none');
    expect(paneToolbarRule).toContain('user-select: none');
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

  it('opens localized terminal actions after focusing the current pane and adapter', async () => {
    const openMenu = vi.spyOn(contextMenu, 'openAt');
    const wrapper = mountPane();
    await flushPromises();
    terminalAdapterMock.focus.mockClear();

    await wrapper.get('.terminal-surface-frame').trigger('contextmenu', {
      clientX: 20,
      clientY: 30,
    });

    expect(wrapper.emitted('focus')?.at(-1)).toEqual(['pane-1']);
    expect(terminalAdapterMock.focus).toHaveBeenCalledOnce();
    expect(openMenu).toHaveBeenCalledOnce();
    expect(terminalAdapterMock.focus.mock.invocationCallOrder[0]).toBeLessThan(
      openMenu.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(contextMenu.state.value?.entries).toEqual([
      expect.objectContaining({ kind: 'action', id: 'copy', label: 'Copy', disabled: true }),
      expect.objectContaining({ kind: 'action', id: 'paste', label: 'Paste' }),
      expect.objectContaining({ kind: 'action', id: 'select-all', label: 'Select All' }),
      { kind: 'separator', id: 'terminal-separator' },
      expect.objectContaining({ kind: 'action', id: 'clear-terminal', label: 'Clear Terminal' }),
    ]);
    openMenu.mockRestore();
  });

  it('copies the exact terminal selection and disables copy when it is empty', async () => {
    const wrapper = mountPane();
    await flushPromises();
    terminalAdapterMock.getSelection.mockReturnValueOnce('').mockReturnValue('line 1\nline 2');

    await wrapper.get('.terminal-surface').trigger('contextmenu');
    expect(terminalAction('copy').disabled).toBe(true);

    await wrapper.get('.terminal-surface').trigger('contextmenu');
    expect(terminalAction('copy').disabled).toBe(false);
    await terminalAction('copy').run();

    expect(clipboardMock.writeText).toHaveBeenCalledWith('line 1\nline 2');
  });

  it('pastes clipboard text and selects the entire terminal buffer', async () => {
    clipboardMock.readText.mockResolvedValue('printf "hello"\r');
    const wrapper = mountPane();
    await flushPromises();
    await wrapper.get('.terminal-surface').trigger('contextmenu');

    await terminalAction('paste').run();
    await terminalAction('select-all').run();

    expect(clipboardMock.readText).toHaveBeenCalledOnce();
    expect(terminalAdapterMock.paste).toHaveBeenCalledWith('printf "hello"\r');
    expect(terminalAdapterMock.selectAll).toHaveBeenCalledOnce();
  });

  it('clears the terminal through the existing session writer', async () => {
    const wrapper = mountPane();
    await flushPromises();
    await wrapper.get('.terminal-surface').trigger('contextmenu');

    await terminalAction('clear-terminal').run();

    expect(workspace.writeToSession).toHaveBeenCalledWith('session-1', '\x0c');
  });

  it('does not open the terminal menu from the SFTP drawer', async () => {
    const wrapper = mountPane();
    await flushPromises();
    await wrapper.get('[data-testid="sftp-open"]').trigger('click');

    await wrapper.get('sftp-panel-stub').trigger('contextmenu');

    expect(contextMenu.state.value).toBeNull();
  });

  it('restores the xterm textarea when Escape closes the terminal menu', async () => {
    const paneHost = document.createElement('div');
    document.body.append(paneHost);
    const menuRenderer = mount(AppContextMenu);
    const wrapper = mountPane(true, paneHost);
    await flushPromises();
    const terminalTextarea = document.createElement('textarea');
    terminalTextarea.className = 'xterm-helper-textarea';
    wrapper.get('.terminal-surface').element.append(terminalTextarea);
    terminalAdapterMock.focus.mockImplementation(() => terminalTextarea.focus());

    await wrapper.get('.terminal-surface').trigger('contextmenu');
    await nextTick();
    await nextTick();
    document
      .querySelector<HTMLElement>('.app-context-menu')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();

    expect(document.activeElement).toBe(terminalTextarea);
    wrapper.unmount();
    menuRenderer.unmount();
    paneHost.remove();
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

function mountPane(focused = true, attachTo?: Element) {
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
    ...(attachTo === undefined ? {} : { attachTo }),
  });
}

function terminalAction(id: string): ContextMenuActionEntry {
  const entry = contextMenu.state.value?.entries.find(
    (candidate): candidate is ContextMenuActionEntry =>
      candidate.kind === 'action' && candidate.id === id,
  );
  if (entry === undefined) {
    throw new Error(`Expected terminal context action: ${id}`);
  }
  return entry;
}
