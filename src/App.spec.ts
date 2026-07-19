import { createPinia, setActivePinia } from 'pinia';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addTab, createWorkspace } from '@/domain/workspace';
import { setLocale } from '@/i18n/locale';
import { defaultTerminalSettings, useAppSettingsStore } from '@/stores/appSettingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import App from './App.vue';

enableAutoUnmount(afterEach);

describe('FleurTerm app shell', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setLocale('en-US');
    localStorage.clear();
  });

  it('opens a local terminal from the empty workspace', async () => {
    const store = useWorkspaceStore();
    store.openTab = vi.fn(async () => undefined);
    const wrapper = mount(App);

    await wrapper.get('[data-testid="start-new-terminal"]').trigger('click');

    expect(store.openTab).toHaveBeenCalledOnce();
  });

  it('opens settings as a singleton application tab', async () => {
    const wrapper = mount(App);

    await wrapper.get('[data-testid="start-settings"]').trigger('click');
    await wrapper.get('[data-testid="tabbar-settings"]').trigger('click');

    expect(wrapper.findAll('[data-tab-id="app-settings"]')).toHaveLength(1);
    expect(
      wrapper.get('[data-tab-id="app-settings"] [role="tab"]').attributes('aria-selected'),
    ).toBe('true');
    expect(wrapper.get('#settings-panel').exists()).toBe(true);
  });

  it('switches between settings and an existing terminal tab', async () => {
    const store = useWorkspaceStore();
    store.workspace = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    const wrapper = mount(App, {
      global: { stubs: { TerminalPane: true } },
    });
    await wrapper.get('[data-testid="tabbar-settings"]').trigger('click');

    await wrapper.get('[data-tab-id="tab-1"] [role="tab"]').trigger('click');

    expect(store.workspace.activeTabId).toBe('tab-1');
    expect(wrapper.get('#terminal-panel-tab-1').attributes('aria-hidden')).toBe('false');
    expect(wrapper.get('#settings-panel').attributes('aria-hidden')).toBe('true');
  });

  it('keeps the terminal workspace laid out and inert while settings is active', async () => {
    const store = useWorkspaceStore();
    store.workspace = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    const wrapper = mount(App, {
      global: { stubs: { TerminalPane: true } },
    });

    await wrapper.get('[data-testid="tabbar-settings"]').trigger('click');

    const appContent = wrapper.get('.app-content');
    expect(appContent.get('[aria-label="Settings"]').exists()).toBe(true);
    const workspace = wrapper.get('[aria-label="Terminal workspace"]');
    expect(appContent.element.contains(workspace.element)).toBe(true);
    expect(workspace.attributes('style') ?? '').not.toContain('display: none');
    expect(workspace.attributes('aria-hidden')).toBe('true');
    expect(workspace.attributes('inert')).toBeDefined();
  });

  it('closes settings and returns to the most recently active terminal', async () => {
    const store = useWorkspaceStore();
    store.workspace = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    const wrapper = mount(App, {
      global: { stubs: { TerminalPane: true } },
    });

    await wrapper.get('[data-testid="tabbar-settings"]').trigger('click');
    await wrapper.get('[aria-label="Close Settings"]').trigger('click');

    expect(wrapper.find('[data-tab-id="app-settings"]').exists()).toBe(false);
    expect(wrapper.get('#terminal-panel-tab-1').attributes('aria-hidden')).toBe('false');
  });

  it('closes settings to the start page when no terminal exists', async () => {
    const wrapper = mount(App);

    await wrapper.get('[data-testid="start-settings"]').trigger('click');
    await wrapper.get('[aria-label="Close Settings"]').trigger('click');

    expect(wrapper.get('[aria-label="FleurTerm start page"]').exists()).toBe(true);
  });

  it('removes the FleurTerm title header and keeps the tab row at the top', () => {
    const wrapper = mount(App);

    expect(wrapper.find('.app-title-bar').exists()).toBe(false);
    expect(wrapper.get('.app-shell').element.firstElementChild?.classList).toContain(
      'terminal-tabs',
    );
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

    expect(wrapper.get('[role="tab"]').text()).toContain('Terminal 1');
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

  it('opens an SSH terminal from connections settings', async () => {
    const store = useWorkspaceStore();
    store.openTab = vi.fn(async () => undefined);
    const wrapper = mount(App, {
      global: { stubs: { TerminalPane: true } },
    });

    await wrapper.get('[data-testid="tabbar-settings"]').trigger('click');
    await wrapper.get('[data-section="connections"]').trigger('click');
    await wrapper.get('[data-testid="add-connection"]').trigger('click');
    await wrapper.get('[data-testid="connection-name"]').setValue('Server');
    await wrapper.get('[data-testid="connection-host"]').setValue('server.example.com');
    await wrapper.get('[data-testid="connection-user"]').setValue('deploy');
    await wrapper.get('[data-testid="connection-port"]').setValue(2222);
    await wrapper.get('[data-testid="save-connection"]').trigger('click');
    await wrapper.findAll('.settings-connection-main').at(-1)?.trigger('click');

    expect(store.openTab).toHaveBeenCalledWith({
      shell: 'ssh',
      args: ['-p', '2222', 'deploy@server.example.com'],
      title: 'SSH deploy@server.example.com',
    });
  });

  it('opens a local connection with the configured shell and working directory', async () => {
    const store = useWorkspaceStore();
    store.openTab = vi.fn(async () => undefined);
    const wrapper = mount(App, {
      global: { stubs: { TerminalPane: true } },
    });

    await wrapper.get('[data-testid="tabbar-settings"]').trigger('click');
    await wrapper.get('[data-section="connections"]').trigger('click');
    await wrapper.get('[data-testid="add-connection"]').trigger('click');
    await wrapper.get('[data-testid="connection-name"]').setValue('Project');
    await wrapper.get('[data-testid="connection-method"]').trigger('click');
    await wrapper.get('[data-value="local"]').trigger('click');
    await wrapper
      .findAll('.connection-field input')
      .at(3)
      ?.setValue('D:\\IT\\Projects\\fleuruiterm');
    await wrapper.findAll('.connection-field input').at(4)?.setValue('wsl.exe');
    await wrapper.get('[data-testid="save-connection"]').trigger('click');
    await wrapper.findAll('.settings-connection-main').at(-1)?.trigger('click');

    expect(store.openTab).toHaveBeenCalledWith({
      shell: 'wsl.exe',
      cwd: 'D:\\IT\\Projects\\fleuruiterm',
      title: 'Project',
    });
  });

  it('opens a Telnet connection with telnet host and port arguments', async () => {
    const store = useWorkspaceStore();
    store.openTab = vi.fn(async () => undefined);
    const wrapper = mount(App, {
      global: { stubs: { TerminalPane: true } },
    });

    await wrapper.get('[data-testid="tabbar-settings"]').trigger('click');
    await wrapper.get('[data-section="connections"]').trigger('click');
    await wrapper.get('[data-testid="add-connection"]').trigger('click');
    await wrapper.get('[data-testid="connection-name"]').setValue('Router');
    await wrapper.get('[data-testid="connection-method"]').trigger('click');
    await wrapper.get('[data-value="telnet"]').trigger('click');
    await wrapper.get('[data-testid="connection-host"]').setValue('10.0.0.1');
    await wrapper.get('[data-testid="connection-user"]').setValue('admin');
    await wrapper.get('[data-testid="connection-port"]').setValue(2323);
    await wrapper.get('[data-testid="save-connection"]').trigger('click');
    await wrapper.findAll('.settings-connection-main').at(-1)?.trigger('click');

    expect(store.openTab).toHaveBeenCalledWith({
      shell: 'telnet',
      args: ['10.0.0.1', '2323'],
      title: 'Telnet 10.0.0.1',
    });
  });

  it('passes SSH forwarded port rules to the ssh command', async () => {
    const store = useWorkspaceStore();
    store.openTab = vi.fn(async () => undefined);
    const wrapper = mount(App, {
      global: { stubs: { TerminalPane: true } },
    });

    await wrapper.get('[data-testid="tabbar-settings"]').trigger('click');
    await wrapper.get('[data-section="connections"]').trigger('click');
    await wrapper.get('[data-testid="add-connection"]').trigger('click');
    await wrapper.get('[data-testid="connection-name"]').setValue('Tunnel');
    await wrapper.get('[data-testid="connection-host"]').setValue('server.example.com');
    await wrapper.get('[data-testid="connection-user"]').setValue('deploy');
    await wrapper
      .findAll('.connection-editor-tab')
      .find((tab) => tab.text() === 'Ports')
      ?.trigger('click');
    await wrapper.get('textarea').setValue('8080:localhost:80\n-R 9000:localhost:9000');
    await wrapper.get('[data-testid="save-connection"]').trigger('click');
    await wrapper.findAll('.settings-connection-main').at(-1)?.trigger('click');

    expect(store.openTab).toHaveBeenCalledWith({
      shell: 'ssh',
      args: [
        '-p',
        '22',
        '-L',
        '8080:localhost:80',
        '-R',
        '9000:localhost:9000',
        'deploy@server.example.com',
      ],
      title: 'SSH deploy@server.example.com',
    });
  });

  it('opens a password SSH connection with password prompt handling enabled', async () => {
    const store = useWorkspaceStore();
    store.openTab = vi.fn(async () => undefined);
    const wrapper = mount(App, {
      global: { stubs: { TerminalPane: true } },
    });

    await wrapper.get('[data-testid="tabbar-settings"]').trigger('click');
    await wrapper.get('[data-section="connections"]').trigger('click');
    await wrapper.get('[data-testid="add-connection"]').trigger('click');
    await wrapper.get('[data-testid="connection-name"]').setValue('Password Host');
    await wrapper.get('[data-testid="connection-host"]').setValue('server.example.com');
    await wrapper.get('[data-testid="connection-user"]').setValue('deploy');
    await wrapper.findAll('.connection-auth-option').at(1)?.trigger('click');
    await wrapper
      .find('.connection-auth-card .connection-dialog-secondary-button')
      .trigger('click');
    await wrapper.get('input[type="password"]').setValue('secret');
    await wrapper
      .find('.password-dialog-actions .connection-dialog-primary-button')
      .trigger('click');
    await wrapper.get('[data-testid="save-connection"]').trigger('click');
    await wrapper.findAll('.settings-connection-main').at(-1)?.trigger('click');

    expect(store.openTab).toHaveBeenCalledWith({
      shell: 'ssh',
      args: [
        '-p',
        '22',
        '-o',
        'PreferredAuthentications=password,keyboard-interactive',
        '-o',
        'PubkeyAuthentication=no',
        'deploy@server.example.com',
      ],
      password: 'secret',
      title: 'SSH deploy@server.example.com',
    });
  });

  it('does not offer unsupported serial connections in the settings dialog', async () => {
    const wrapper = mount(App, {
      global: { stubs: { TerminalPane: true } },
    });

    await wrapper.get('[data-testid="tabbar-settings"]').trigger('click');
    await wrapper.get('[data-section="connections"]').trigger('click');
    await wrapper.get('[data-testid="add-connection"]').trigger('click');

    expect(wrapper.get('[data-testid="connection-method"]').text()).not.toContain('Serial');
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

  it('reorders application tabs from a drag event', async () => {
    const store = useWorkspaceStore();
    const first = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    store.workspace = addTab(first, 'session-b', ids('tab-2', 'pane-2'));
    const wrapper = mount(App, {
      global: { stubs: { TerminalPane: true } },
    });

    wrapper.getComponent({ name: 'TerminalTabs' }).vm.$emit('reorder', 'tab-2', 'tab-1', 'before');
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll('.tab-item').map((tab) => tab.attributes('data-tab-id'))).toEqual([
      'tab-2',
      'tab-1',
    ]);
    expect(wrapper.findAll('.tab-label').map((label) => label.text())).toEqual([
      'Terminal 2',
      'Terminal 1',
    ]);
    expect(store.workspace.tabs.map((tab) => tab.id)).toEqual(['tab-2', 'tab-1']);
  });

  it('merges a dragged terminal tab into a target pane', async () => {
    const store = useWorkspaceStore();
    const first = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    store.workspace = addTab(first, 'session-b', ids('tab-2', 'pane-2'));
    const wrapper = mount(App, {
      global: {
        stubs: {
          TerminalPane: true,
          WorkspacePane: {
            name: 'WorkspacePane',
            emits: ['dropTab'],
            template:
              "<button data-testid=\"drop-tab\" @click=\"$emit('dropTab', 'tab-1', 'pane-2', 'left')\">Drop</button>",
          },
        },
      },
    });

    await wrapper.get('[data-testid="drop-tab"]').trigger('click');

    expect(store.workspace.tabs).toHaveLength(1);
    expect(store.workspace.tabs[0]?.root).toMatchObject({
      kind: 'split',
      direction: 'vertical',
    });
  });

  it('updates the full application shell when the language changes', async () => {
    const wrapper = mount(App);
    await wrapper.get('[data-testid="tabbar-settings"]').trigger('click');

    await wrapper.get('[data-testid="settings-language-select"]').trigger('click');
    await wrapper.get('[data-value="zh-CN"]').trigger('click');

    expect(wrapper.get('[data-tab-id="app-settings"] .tab-label').text()).toBe('设置');
    expect(wrapper.get('[data-testid="tabbar-settings"]').attributes('aria-label')).toBe(
      '打开设置',
    );
    await wrapper.get('[aria-label="关闭 设置"]').trigger('click');
    expect(wrapper.get('[data-testid="start-new-terminal"]').text()).toContain('新建终端');
  });

  it('localizes stable workspace errors without exposing backend details', () => {
    const store = useWorkspaceStore();
    store.errorCode = 'OPEN_TERMINAL_FAILED';
    store.errorMessage = 'internal shell launch detail';
    setLocale('zh-CN');

    const wrapper = mount(App);

    expect(wrapper.get('[role="alert"]').text()).toContain('无法打开终端');
    expect(wrapper.get('[role="alert"]').text()).not.toContain('internal shell launch detail');
  });

  it('opens the AI side panel from the tab bar', async () => {
    const wrapper = mount(App);

    await wrapper.get('[data-testid="tabbar-ai"]').trigger('click');

    expect(wrapper.get('[aria-label="AI panel"]').exists()).toBe(true);
    expect(wrapper.get('.workspace').classes()).toContain('ai-panel-open');
    expect(wrapper.get('[data-testid="tabbar-ai"]').attributes('aria-pressed')).toBe('true');
  });

  it('resizes the AI side panel and applies the layout offset', async () => {
    const wrapper = mount(App, {
      global: {
        stubs: {
          AIPanel: {
            emits: ['resize'],
            template:
              '<button aria-label="AI panel" data-testid="resize-ai" @click="$emit(\'resize\', 520)">Resize</button>',
          },
        },
      },
    });

    await wrapper.get('[data-testid="tabbar-ai"]').trigger('click');
    expect(wrapper.get('.app-content').attributes('style')).toContain('--ai-panel-width: 380px');

    await wrapper.get('[data-testid="resize-ai"]').trigger('click');

    expect(wrapper.get('.app-content').attributes('style')).toContain('--ai-panel-width: 520px');
    expect(localStorage.getItem('fleurterm.aiPanelWidth')).toBe('520');
  });

  it('writes AI terminal commands to the focused terminal session', async () => {
    const store = useWorkspaceStore();
    store.workspace = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    store.writeToFocusedSession = vi.fn(async () => undefined);
    const wrapper = mount(App, {
      global: {
        stubs: {
          TerminalPane: true,
          AIPanel: {
            emits: ['runTerminalCommand'],
            template:
              '<button data-testid="ai-run-command" @click="$emit(\'runTerminalCommand\', \'pwd\')">Run</button>',
          },
        },
      },
    });

    await wrapper.get('[data-testid="tabbar-ai"]').trigger('click');
    await wrapper.get('[data-testid="ai-run-command"]').trigger('click');

    expect(store.writeToFocusedSession).toHaveBeenCalledWith('pwd\r');
  });

  it('lets AI application actions update terminal settings', async () => {
    const appSettings = useAppSettingsStore();
    appSettings.replaceRuntimeSettings({ terminal: defaultTerminalSettings });
    const wrapper = mount(App, {
      global: {
        stubs: {
          AIPanel: {
            emits: ['runAppAction'],
            template:
              '<button data-testid="ai-update-setting" @click="$emit(\'runAppAction\', { type: \'settings.updateTerminal\', patch: { fontSize: 16 } })">Apply</button>',
          },
        },
      },
    });

    await wrapper.get('[data-testid="tabbar-ai"]').trigger('click');
    await wrapper.get('[data-testid="ai-update-setting"]').trigger('click');

    expect(appSettings.terminalSettings.value.fontSize).toBe(16);
  });

  it('lets AI application actions open an SSH terminal', async () => {
    const store = useWorkspaceStore();
    store.openTab = vi.fn(async () => {
      store.workspace = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    });
    const wrapper = mount(App, {
      global: {
        stubs: {
          TerminalPane: true,
          AIPanel: {
            emits: ['runAppAction'],
            template:
              '<button data-testid="ai-open-ssh" @click="$emit(\'runAppAction\', { type: \'terminal.openSsh\', host: \'example.com\', user: \'root\', port: 2222 })">Open</button>',
          },
        },
      },
    });

    await wrapper.get('[data-testid="tabbar-ai"]').trigger('click');
    await wrapper.get('[data-testid="ai-open-ssh"]').trigger('click');

    expect(store.openTab).toHaveBeenCalledWith({
      shell: 'ssh',
      args: ['-p', '2222', 'root@example.com'],
      title: 'SSH root@example.com',
    });
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
