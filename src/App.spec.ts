import { createPinia, setActivePinia } from 'pinia';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addTab, closeTab as closeWorkspaceTab, createWorkspace } from '@/domain/workspace';
import { setLocale } from '@/i18n/locale';
import { settingsClient } from '@/services/settingsClient';
import { workspacePersistenceClient } from '@/services/workspacePersistence';
import {
  defaultAiSettings,
  defaultAppearanceSettings,
  defaultStartupSettings,
  defaultTerminalSettings,
  useAppSettingsStore,
} from '@/stores/appSettingsStore';
import { useAppUpdateStore } from '@/stores/appUpdateStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import App from './App.vue';

const desktopMenuMock = vi.hoisted(() => ({
  commandHandler: null as ((command: string) => void) | null,
  listen: vi.fn(async (handler: (command: string) => void) => {
    desktopMenuMock.commandHandler = handler;
    return vi.fn();
  }),
  setLocale: vi.fn(async () => undefined),
}));
const desktopWindowLifecycleMock = vi.hoisted(() => ({
  applicationExitRequestHandler: null as (() => Promise<boolean>) | null,
  closeRequestHandler: null as (() => Promise<boolean>) | null,
  exitFailureHandler: null as (() => void) | null,
  listenForApplicationExitRequest: vi.fn(
    async (handler: () => Promise<boolean>, onFailure: () => void) => {
      desktopWindowLifecycleMock.applicationExitRequestHandler = handler;
      desktopWindowLifecycleMock.exitFailureHandler = onFailure;
      return vi.fn();
    },
  ),
  listenForCloseRequest: vi.fn(async (handler: () => Promise<boolean>, onFailure: () => void) => {
    desktopWindowLifecycleMock.closeRequestHandler = handler;
    desktopWindowLifecycleMock.exitFailureHandler = onFailure;
    return vi.fn();
  }),
}));
vi.mock('@/services/desktopMenuClient', () => ({
  desktopMenuClient: {
    available: false,
    listen: desktopMenuMock.listen,
    setLocale: desktopMenuMock.setLocale,
  },
}));
vi.mock('@/services/desktopWindowLifecycleClient', () => ({
  desktopWindowLifecycleClient: {
    listenForApplicationExitRequest: desktopWindowLifecycleMock.listenForApplicationExitRequest,
    listenForCloseRequest: desktopWindowLifecycleMock.listenForCloseRequest,
  },
}));

enableAutoUnmount(afterEach);

describe('FleurTerm app shell', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setLocale('en-US');
    localStorage.clear();
    desktopMenuMock.commandHandler = null;
    desktopMenuMock.listen.mockClear();
    desktopMenuMock.setLocale.mockClear();
    desktopWindowLifecycleMock.closeRequestHandler = null;
    desktopWindowLifecycleMock.applicationExitRequestHandler = null;
    desktopWindowLifecycleMock.exitFailureHandler = null;
    desktopWindowLifecycleMock.listenForApplicationExitRequest.mockClear();
    desktopWindowLifecycleMock.listenForCloseRequest.mockClear();
    const appSettings = useAppSettingsStore();
    appSettings.replaceRuntimeSettings({
      ai: defaultAiSettings,
      appearance: defaultAppearanceSettings,
      startup: defaultStartupSettings,
    });
    appSettings.updateUpdateSettings({ automaticDownloadEnabled: false });
    appSettings.resetShortcutSettings();
    vi.spyOn(workspacePersistenceClient, 'load').mockResolvedValue(null);
    vi.spyOn(workspacePersistenceClient, 'save').mockResolvedValue();
  });

  it('mounts exactly one global context menu renderer', () => {
    const wrapper = mount(App, {
      global: {
        stubs: {
          AppContextMenu: { template: '<div data-testid="global-context-menu" />' },
          TerminalPane: true,
        },
      },
    });

    expect(wrapper.findAll('[data-testid="global-context-menu"]')).toHaveLength(1);
  });

  it('restores saved terminal tabs and the previously active connection on startup', async () => {
    localStorage.setItem(
      'fleurterm.connections',
      JSON.stringify([
        {
          id: 'production',
          name: 'Production',
          method: 'ssh',
          host: 'server.example.com',
          user: 'deploy',
          port: 22,
          authMethod: 'auto',
        },
      ]),
    );
    vi.mocked(workspacePersistenceClient.load).mockResolvedValue({
      version: 1,
      activeTabId: 'saved-ssh',
      tabs: [
        {
          id: 'saved-local',
          title: 'Project',
          launch: { type: 'local', shell: '/bin/zsh', cwd: '/tmp/project' },
        },
        {
          id: 'saved-ssh',
          title: 'Production terminal',
          launch: { type: 'savedConnection', connectionProfileId: 'production' },
        },
      ],
    });
    const store = useWorkspaceStore();
    store.openTab = vi.fn(async (options) => {
      const sessionId = `session-${store.workspace.tabs.length + 1}`;
      store.workspace =
        store.workspace.tabs.length === 0
          ? createWorkspace(sessionId, ids('tab-1', 'pane-1'), options.title)
          : addTab(store.workspace, sessionId, ids('tab-2', 'pane-2'), options.title);
    });

    const wrapper = mount(App, { global: { stubs: { TerminalPane: true } } });

    await vi.waitFor(() => expect(store.openTab).toHaveBeenCalledTimes(2));
    expect(store.openTab).toHaveBeenNthCalledWith(1, {
      shell: '/bin/zsh',
      cwd: '/tmp/project',
      title: 'Project',
    });
    expect(store.openTab).toHaveBeenNthCalledWith(2, {
      shell: 'ssh',
      args: ['-p', '22', 'deploy@server.example.com'],
      title: 'Production terminal',
      connectionProfileId: 'production',
      sftpConnectionProfileId: 'production',
    });
    expect(store.workspace.activeTabId).toBe('tab-2');
    expect(wrapper.get('[data-tab-id="tab-2"] [role="tab"]').attributes('aria-selected')).toBe(
      'true',
    );
  });

  it('opens one startup terminal only when restoration leaves the terminal workspace empty', async () => {
    useAppSettingsStore().updateStartupSettings({ openTerminalOnStartup: true });
    const store = useWorkspaceStore();
    store.openTab = vi.fn(async () => {
      store.workspace = createWorkspace('startup-session', ids('startup-tab', 'startup-pane'));
    });

    mount(App, { global: { stubs: { TerminalPane: true } } });

    await vi.waitFor(() => expect(store.openTab).toHaveBeenCalledOnce());
  });

  it('does not add a startup terminal when restoration recreated a terminal session', async () => {
    useAppSettingsStore().updateStartupSettings({ openTerminalOnStartup: true });
    vi.mocked(workspacePersistenceClient.load).mockResolvedValue({
      version: 2,
      activeTabId: 'saved-local',
      settingsTabIndex: null,
      tabs: [
        {
          id: 'saved-local',
          title: 'Project',
          launch: { type: 'local', shell: '/bin/zsh' },
        },
      ],
    });
    const store = useWorkspaceStore();
    store.openTab = vi.fn(async (options) => {
      store.workspace = createWorkspace(
        'restored-session',
        ids('restored-tab', 'restored-pane'),
        options.title,
      );
    });

    mount(App, { global: { stubs: { TerminalPane: true } } });

    await vi.waitFor(() => expect(store.openTab).toHaveBeenCalledOnce());
    expect(store.openTab).toHaveBeenCalledWith({ shell: '/bin/zsh', title: 'Project' });
  });

  it('continues restoring later tabs when one saved credential is unavailable', async () => {
    localStorage.setItem(
      'fleurterm.connections',
      JSON.stringify([
        {
          id: 'protected',
          name: 'Protected',
          method: 'ssh',
          host: 'protected.example.com',
          user: 'deploy',
          port: 22,
          authMethod: 'password',
          hasPassword: true,
        },
      ]),
    );
    vi.spyOn(settingsClient, 'loadPasswords').mockResolvedValue({});
    vi.mocked(workspacePersistenceClient.load).mockResolvedValue({
      version: 1,
      activeTabId: 'saved-local',
      tabs: [
        {
          id: 'saved-ssh',
          title: 'Protected',
          launch: { type: 'savedConnection', connectionProfileId: 'protected' },
        },
        {
          id: 'saved-local',
          title: 'Local fallback',
          launch: { type: 'local', shell: '/bin/zsh' },
        },
      ],
    });
    const store = useWorkspaceStore();
    store.openTab = vi.fn(async (options) => {
      store.workspace = createWorkspace(
        'session-local',
        ids('tab-local', 'pane-local'),
        options.title,
      );
    });

    mount(App, { global: { stubs: { TerminalPane: true } } });

    await vi.waitFor(() => expect(store.openTab).toHaveBeenCalledOnce());
    expect(store.openTab).toHaveBeenCalledWith({
      shell: '/bin/zsh',
      title: 'Local fallback',
    });
  });

  it('restores the settings tab position and active state', async () => {
    vi.mocked(workspacePersistenceClient.load).mockResolvedValue({
      version: 2,
      activeTabId: 'app-settings',
      settingsTabIndex: 0,
      tabs: [
        {
          id: 'saved-local',
          title: 'Project',
          launch: { type: 'local', shell: '/bin/zsh' },
        },
      ],
    });
    const store = useWorkspaceStore();
    store.openTab = vi.fn(async (options) => {
      store.workspace = createWorkspace(
        'runtime-session',
        ids('runtime-local', 'runtime-pane'),
        options.title,
        { type: 'local', shell: options.shell },
      );
    });

    const wrapper = mount(App, { global: { stubs: { TerminalPane: true } } });

    await vi.waitFor(() => expect(store.openTab).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(wrapper.findAll('.tab-item').map((tab) => tab.attributes('data-tab-id'))).toEqual([
        'app-settings',
        'runtime-local',
      ]),
    );
    expect(
      wrapper.get('[data-tab-id="app-settings"] [role="tab"]').attributes('aria-selected'),
    ).toBe('true');
    expect(wrapper.get('#settings-panel').attributes('aria-hidden')).toBe('false');
  });

  it('persists terminal tab changes after workspace restoration is ready', async () => {
    const store = useWorkspaceStore();
    mount(App, { global: { stubs: { TerminalPane: true } } });
    await vi.waitFor(() => expect(workspacePersistenceClient.load).toHaveBeenCalledOnce());
    await Promise.resolve();

    store.workspace = createWorkspace('runtime-session', ids('tab-1', 'pane-1'), 'Local project');

    await vi.waitFor(() => expect(workspacePersistenceClient.save).toHaveBeenCalledOnce());
    expect(workspacePersistenceClient.save).toHaveBeenCalledWith({
      version: 2,
      activeTabId: 'tab-1',
      settingsTabIndex: null,
      tabs: [
        {
          id: 'tab-1',
          title: 'Local project',
          launch: { type: 'local' },
        },
      ],
    });
  });

  it('persists the settings tab even when no terminal workspace state changes', async () => {
    const wrapper = mount(App, { global: { stubs: { TerminalPane: true } } });
    await vi.waitFor(() => expect(workspacePersistenceClient.load).toHaveBeenCalledOnce());

    await wrapper.get('[data-testid="tabbar-settings"]').trigger('click');

    await vi.waitFor(() => expect(workspacePersistenceClient.save).toHaveBeenCalledOnce());
    expect(workspacePersistenceClient.save).toHaveBeenCalledWith({
      version: 2,
      activeTabId: 'app-settings',
      settingsTabIndex: 0,
      tabs: [],
    });
  });

  it('persists settings opened during startup restoration', async () => {
    const pendingLoad = deferredPromise<null>();
    vi.mocked(workspacePersistenceClient.load).mockReturnValue(pendingLoad.promise);
    const wrapper = mount(App, { global: { stubs: { TerminalPane: true } } });

    await wrapper.get('[data-testid="tabbar-settings"]').trigger('click');
    expect(wrapper.find('[data-tab-id="app-settings"]').exists()).toBe(true);
    expect(workspacePersistenceClient.save).not.toHaveBeenCalled();

    pendingLoad.resolve(null);

    await vi.waitFor(() =>
      expect(wrapper.find('[data-tab-id="app-settings"]').exists()).toBe(true),
    );
    await vi.waitFor(() =>
      expect(workspacePersistenceClient.save).toHaveBeenCalledWith({
        version: 2,
        activeTabId: 'app-settings',
        settingsTabIndex: 0,
        tabs: [],
      }),
    );
  });

  it('keeps SSH, local, and settings tabs in the persisted application workspace', async () => {
    const store = useWorkspaceStore();
    store.workspace = createWorkspace('ssh-session', ids('ssh-tab', 'ssh-pane'), 'Production', {
      type: 'savedConnection',
      connectionProfileId: 'production',
    });
    store.openTab = vi.fn(async () => {
      store.workspace = addTab(
        store.workspace,
        'local-session',
        ids('local-tab', 'local-pane'),
        'Local Terminal 2',
        { type: 'local' },
      );
    });
    const wrapper = mount(App, { global: { stubs: { TerminalPane: true } } });
    await vi.waitFor(() => expect(workspacePersistenceClient.load).toHaveBeenCalledOnce());
    await wrapper.get('[data-testid="tabbar-settings"]').trigger('click');
    vi.mocked(workspacePersistenceClient.save).mockClear();

    await wrapper.get('[aria-label="New terminal"]').trigger('click');

    await vi.waitFor(() =>
      expect(workspacePersistenceClient.save).toHaveBeenLastCalledWith({
        version: 2,
        activeTabId: 'local-tab',
        settingsTabIndex: 1,
        tabs: [
          {
            id: 'ssh-tab',
            title: 'Production',
            launch: { type: 'savedConnection', connectionProfileId: 'production' },
          },
          {
            id: 'local-tab',
            title: 'Local Terminal 2',
            launch: { type: 'local' },
          },
        ],
      }),
    );
  });

  it('serializes rapid workspace saves without letting an older snapshot win', async () => {
    const firstSave = deferredPromise<void>();
    vi.mocked(workspacePersistenceClient.save)
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValue(undefined);
    const store = useWorkspaceStore();
    mount(App, { global: { stubs: { TerminalPane: true } } });
    await vi.waitFor(() => expect(workspacePersistenceClient.load).toHaveBeenCalledOnce());
    await Promise.resolve();

    store.workspace = createWorkspace('runtime-session-1', ids('tab-1', 'pane-1'), 'First');
    await vi.waitFor(() => expect(workspacePersistenceClient.save).toHaveBeenCalledOnce());
    store.workspace = createWorkspace('runtime-session-2', ids('tab-2', 'pane-2'), 'Second');
    await Promise.resolve();
    expect(workspacePersistenceClient.save).toHaveBeenCalledOnce();

    firstSave.resolve(undefined);

    await vi.waitFor(() => expect(workspacePersistenceClient.save).toHaveBeenCalledTimes(2));
    expect(workspacePersistenceClient.save).toHaveBeenLastCalledWith({
      version: 2,
      activeTabId: 'tab-2',
      settingsTabIndex: null,
      tabs: [
        {
          id: 'tab-2',
          title: 'Second',
          launch: { type: 'local' },
        },
      ],
    });
  });

  it('waits for startup restoration before opening a user-requested terminal', async () => {
    const pendingLoad = deferredPromise<null>();
    vi.mocked(workspacePersistenceClient.load).mockReturnValue(pendingLoad.promise);
    const store = useWorkspaceStore();
    store.openTab = vi.fn(async () => undefined);
    const wrapper = mount(App);

    await wrapper.get('[data-testid="start-new-terminal"]').trigger('click');
    expect(store.openTab).not.toHaveBeenCalled();

    pendingLoad.resolve(null);

    await vi.waitFor(() => expect(store.openTab).toHaveBeenCalledOnce());
  });

  it('flushes the latest workspace snapshot before allowing the window to close', async () => {
    const store = useWorkspaceStore();
    mount(App, { global: { stubs: { TerminalPane: true } } });
    await vi.waitFor(() => expect(workspacePersistenceClient.load).toHaveBeenCalledOnce());
    await Promise.resolve();
    store.workspace = createWorkspace('runtime-session', ids('tab-1', 'pane-1'), 'Local project');
    await vi.waitFor(() => expect(workspacePersistenceClient.save).toHaveBeenCalledOnce());
    vi.mocked(workspacePersistenceClient.save).mockClear();

    const closeRequestHandler = desktopWindowLifecycleMock.closeRequestHandler;
    if (closeRequestHandler === null) {
      throw new Error('expected a close request handler');
    }
    await expect(closeRequestHandler()).resolves.toBe(true);

    expect(workspacePersistenceClient.save).toHaveBeenCalledWith({
      version: 2,
      activeTabId: 'tab-1',
      settingsTabIndex: null,
      tabs: [
        {
          id: 'tab-1',
          title: 'Local project',
          launch: { type: 'local' },
        },
      ],
    });
  });

  it('waits for an in-flight terminal open before capturing the final workspace', async () => {
    const pendingOpen = deferredPromise<void>();
    const store = useWorkspaceStore();
    store.workspace = createWorkspace('ssh-session', ids('ssh-tab', 'ssh-pane'), 'Production', {
      type: 'savedConnection',
      connectionProfileId: 'production',
    });
    store.openTab = vi.fn(async () => {
      await pendingOpen.promise;
      store.workspace = addTab(
        store.workspace,
        'local-session',
        ids('local-tab', 'local-pane'),
        'Local Terminal 2',
        { type: 'local' },
      );
    });
    const wrapper = mount(App, { global: { stubs: { TerminalPane: true } } });
    await vi.waitFor(() => expect(workspacePersistenceClient.load).toHaveBeenCalledOnce());
    await wrapper.get('[aria-label="New terminal"]').trigger('click');
    const closeRequestHandler = desktopWindowLifecycleMock.closeRequestHandler;
    if (closeRequestHandler === null) {
      throw new Error('expected a close request handler');
    }

    const closeRequest = closeRequestHandler();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(workspacePersistenceClient.save).not.toHaveBeenCalled();
    pendingOpen.resolve(undefined);
    await expect(closeRequest).resolves.toBe(true);
    expect(workspacePersistenceClient.save).toHaveBeenLastCalledWith({
      version: 2,
      activeTabId: 'local-tab',
      settingsTabIndex: null,
      tabs: [
        {
          id: 'ssh-tab',
          title: 'Production',
          launch: { type: 'savedConnection', connectionProfileId: 'production' },
        },
        {
          id: 'local-tab',
          title: 'Local Terminal 2',
          launch: { type: 'local' },
        },
      ],
    });
  });

  it('includes settings requested during restoration in the final close snapshot', async () => {
    const pendingLoad = deferredPromise<{
      version: 2;
      activeTabId: string;
      settingsTabIndex: null;
      tabs: Array<{
        id: string;
        title: string;
        launch: { type: 'local'; shell: string };
      }>;
    }>();
    vi.mocked(workspacePersistenceClient.load).mockReturnValue(pendingLoad.promise);
    const store = useWorkspaceStore();
    store.openTab = vi.fn(async (options) => {
      store.workspace = createWorkspace(
        'runtime-session',
        ids('runtime-local', 'runtime-pane'),
        options.title,
        { type: 'local', shell: options.shell },
      );
    });
    const wrapper = mount(App, { global: { stubs: { TerminalPane: true } } });
    await vi.waitFor(() => expect(desktopWindowLifecycleMock.closeRequestHandler).not.toBeNull());
    await wrapper.get('[data-testid="tabbar-settings"]').trigger('click');
    const closeRequestHandler = desktopWindowLifecycleMock.closeRequestHandler;
    if (closeRequestHandler === null) {
      throw new Error('expected a close request handler');
    }

    const closeRequest = closeRequestHandler();
    pendingLoad.resolve({
      version: 2,
      activeTabId: 'saved-local',
      settingsTabIndex: null,
      tabs: [
        {
          id: 'saved-local',
          title: 'Project',
          launch: { type: 'local', shell: '/bin/zsh' },
        },
      ],
    });

    await expect(closeRequest).resolves.toBe(true);
    expect(workspacePersistenceClient.save).toHaveBeenLastCalledWith({
      version: 2,
      activeTabId: 'app-settings',
      settingsTabIndex: 1,
      tabs: [
        {
          id: 'runtime-local',
          title: 'Project',
          launch: { type: 'local', shell: '/bin/zsh' },
        },
      ],
    });
  });

  it('registers application-level exit requests for the same workspace flush', async () => {
    mount(App);

    await vi.waitFor(() =>
      expect(desktopWindowLifecycleMock.listenForApplicationExitRequest).toHaveBeenCalledOnce(),
    );
    expect(desktopWindowLifecycleMock.applicationExitRequestHandler).not.toBeNull();
  });

  it('keeps the window open and reports a workspace flush failure', async () => {
    const wrapper = mount(App);
    await vi.waitFor(() => expect(workspacePersistenceClient.load).toHaveBeenCalledOnce());
    await Promise.resolve();
    vi.mocked(workspacePersistenceClient.save).mockRejectedValueOnce(new Error('disk full'));

    const closeRequestHandler = desktopWindowLifecycleMock.closeRequestHandler;
    if (closeRequestHandler === null) {
      throw new Error('expected a close request handler');
    }
    await expect(closeRequestHandler()).resolves.toBe(false);

    expect(wrapper.get('[role="alert"]').text()).toContain('Unable to save terminal workspace');
    expect(wrapper.get('[role="alert"]').text()).not.toContain('disk full');
  });

  it('freezes terminal mutations while the final workspace save is pending', async () => {
    const pendingSave = deferredPromise<void>();
    vi.mocked(workspacePersistenceClient.save).mockReturnValueOnce(pendingSave.promise);
    const store = useWorkspaceStore();
    const first = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    store.workspace = addTab(first, 'session-b', ids('tab-2', 'pane-2'));
    store.openTab = vi.fn(async () => undefined);
    const wrapper = mount(App, { global: { stubs: { TerminalPane: true } } });
    await vi.waitFor(() => expect(workspacePersistenceClient.load).toHaveBeenCalledOnce());
    await Promise.resolve();
    const closeRequestHandler = desktopWindowLifecycleMock.closeRequestHandler;
    if (closeRequestHandler === null) {
      throw new Error('expected a close request handler');
    }

    const closeRequest = closeRequestHandler();
    await vi.waitFor(() => expect(workspacePersistenceClient.save).toHaveBeenCalledOnce());
    wrapper.getComponent({ name: 'TerminalTabs' }).vm.$emit('reorder', 'tab-2', 'tab-1', 'before');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', metaKey: true }));
    await Promise.resolve();

    expect(store.workspace.tabs.map((tab) => tab.id)).toEqual(['tab-1', 'tab-2']);
    expect(store.openTab).not.toHaveBeenCalled();
    pendingSave.resolve(undefined);
    await expect(closeRequest).resolves.toBe(true);
  });

  it('unfreezes terminal actions when the native close operation fails', async () => {
    const store = useWorkspaceStore();
    store.openTab = vi.fn(async () => undefined);
    mount(App);
    await vi.waitFor(() => expect(workspacePersistenceClient.load).toHaveBeenCalledOnce());
    const closeRequestHandler = desktopWindowLifecycleMock.closeRequestHandler;
    const exitFailureHandler = desktopWindowLifecycleMock.exitFailureHandler;
    if (closeRequestHandler === null || exitFailureHandler === null) {
      throw new Error('expected close lifecycle handlers');
    }
    await expect(closeRequestHandler()).resolves.toBe(true);

    exitFailureHandler();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', metaKey: true }));

    await vi.waitFor(() => expect(store.openTab).toHaveBeenCalledOnce());
  });

  it('checks for application updates when the app starts', async () => {
    const updateStore = useAppUpdateStore();
    updateStore.checkAtStartup = vi.fn(async () => undefined);

    mount(App);
    await Promise.resolve();

    expect(updateStore.checkAtStartup).toHaveBeenCalledOnce();
  });

  it('automatically prepares a detected update when automatic downloads are enabled', async () => {
    const appSettings = useAppSettingsStore();
    appSettings.updateUpdateSettings({ automaticDownloadEnabled: true });
    const updateStore = useAppUpdateStore();
    updateStore.checkAtStartup = vi.fn(async () => {
      updateStore.$patch({ status: 'available' });
    });
    updateStore.prepareUpdate = vi.fn(async () => undefined);
    updateStore.restartToApplyUpdate = vi.fn(async () => undefined);

    mount(App);

    await vi.waitFor(() => expect(updateStore.prepareUpdate).toHaveBeenCalledOnce());
    expect(updateStore.restartToApplyUpdate).not.toHaveBeenCalled();
  });

  it('does not prepare a detected update when automatic downloads are disabled', async () => {
    const updateStore = useAppUpdateStore();
    updateStore.checkAtStartup = vi.fn(async () => {
      updateStore.$patch({ status: 'available' });
    });
    updateStore.prepareUpdate = vi.fn(async () => undefined);

    mount(App);
    await vi.waitFor(() => expect(updateStore.checkAtStartup).toHaveBeenCalledOnce());
    await Promise.resolve();

    expect(updateStore.prepareUpdate).not.toHaveBeenCalled();
  });

  it('prepares an available update when automatic downloads are enabled later', async () => {
    const appSettings = useAppSettingsStore();
    const updateStore = useAppUpdateStore();
    updateStore.checkAtStartup = vi.fn(async () => {
      updateStore.$patch({ status: 'available' });
    });
    updateStore.prepareUpdate = vi.fn(async () => undefined);
    mount(App);
    await vi.waitFor(() => expect(updateStore.checkAtStartup).toHaveBeenCalledOnce());

    appSettings.updateUpdateSettings({ automaticDownloadEnabled: true });

    await vi.waitFor(() => expect(updateStore.prepareUpdate).toHaveBeenCalledOnce());
  });

  it('opens a local terminal from the empty workspace', async () => {
    const store = useWorkspaceStore();
    store.openTab = vi.fn(async () => undefined);
    const wrapper = mount(App);

    await wrapper.get('[data-testid="start-new-terminal"]').trigger('click');

    await vi.waitFor(() => expect(store.openTab).toHaveBeenCalledOnce());
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
    await vi.waitFor(() =>
      expect(workspacePersistenceClient.save).toHaveBeenLastCalledWith({
        version: 2,
        activeTabId: 'tab-1',
        settingsTabIndex: 1,
        tabs: [
          {
            id: 'tab-1',
            title: 'Local Terminal 1',
            launch: { type: 'local' },
          },
        ],
      }),
    );
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
    await vi.waitFor(() =>
      expect(workspacePersistenceClient.save).toHaveBeenLastCalledWith({
        version: 2,
        activeTabId: 'tab-1',
        settingsTabIndex: null,
        tabs: [
          {
            id: 'tab-1',
            title: 'Local Terminal 1',
            launch: { type: 'local' },
          },
        ],
      }),
    );
  });

  it('closes settings to the start page when no terminal exists', async () => {
    const wrapper = mount(App);

    await wrapper.get('[data-testid="start-settings"]').trigger('click');
    await wrapper.get('[aria-label="Close Settings"]').trigger('click');

    expect(wrapper.get('[aria-label="FleurTerm start page"]').exists()).toBe(true);
  });

  it('closes every terminal tab except a settings context-menu target', async () => {
    const store = useWorkspaceStore();
    const first = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    store.workspace = addTab(first, 'session-b', ids('tab-2', 'pane-2'));
    store.closeTab = vi.fn(async (tabId: string) => {
      store.workspace = closeWorkspaceTab(store.workspace, tabId);
    });
    const wrapper = mount(App, {
      attachTo: document.body,
      global: { stubs: { TerminalPane: true } },
    });
    await wrapper.get('[data-testid="tabbar-settings"]').trigger('click');
    await wrapper.get('[data-tab-id="tab-2"] .tab-button').trigger('click');
    expect(wrapper.get('#settings-panel').attributes('aria-hidden')).toBe('true');

    wrapper.getComponent({ name: 'TerminalTabs' }).vm.$emit('closeOtherTabs', 'app-settings');

    await vi.waitFor(() => expect(store.workspace.tabs).toHaveLength(0));
    expect(store.closeTab).toHaveBeenNthCalledWith(1, 'tab-1');
    expect(store.closeTab).toHaveBeenNthCalledWith(2, 'tab-2');
    expect(store.closeTab).not.toHaveBeenCalledWith('app-settings');
    expect(wrapper.get('[data-tab-id="app-settings"]').exists()).toBe(true);
    expect(wrapper.get('#settings-panel').attributes('aria-hidden')).toBe('false');
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(wrapper.get('#app-tab-app-settings').element),
    );
  });

  it('closes other app tabs sequentially while preserving a terminal target', async () => {
    const store = useWorkspaceStore();
    const first = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    store.workspace = addTab(first, 'session-b', ids('tab-2', 'pane-2'));
    const closeOrder: string[] = [];
    store.closeTab = vi.fn(async (tabId: string) => {
      closeOrder.push(tabId);
      store.workspace = closeWorkspaceTab(store.workspace, tabId);
    });
    const wrapper = mount(App, { global: { stubs: { TerminalPane: true } } });
    await wrapper.get('[data-testid="tabbar-settings"]').trigger('click');

    wrapper.getComponent({ name: 'TerminalTabs' }).vm.$emit('closeOtherTabs', 'tab-1');

    await vi.waitFor(() =>
      expect(wrapper.findAll('.tab-item').map((tab) => tab.attributes('data-tab-id'))).toEqual([
        'tab-1',
      ]),
    );
    expect(closeOrder).toEqual(['tab-2']);
    expect(store.closeTab).not.toHaveBeenCalledWith('tab-1');
    expect(wrapper.find('[data-tab-id="app-settings"]').exists()).toBe(false);
    expect(wrapper.get('#terminal-panel-tab-1').attributes('aria-hidden')).toBe('false');
  });

  it('waits for each tab close before starting the next close', async () => {
    const store = useWorkspaceStore();
    const first = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    const second = addTab(first, 'session-b', ids('tab-2', 'pane-2'));
    store.workspace = addTab(second, 'session-c', ids('tab-3', 'pane-3'));
    const firstClose = deferredPromise<void>();
    store.closeTab = vi.fn(async (tabId: string) => {
      if (tabId === 'tab-2') {
        await firstClose.promise;
      }
      store.workspace = closeWorkspaceTab(store.workspace, tabId);
    });
    const wrapper = mount(App, { global: { stubs: { TerminalPane: true } } });

    wrapper.getComponent({ name: 'TerminalTabs' }).vm.$emit('closeOtherTabs', 'tab-1');

    await vi.waitFor(() => expect(store.closeTab).toHaveBeenCalledTimes(1));
    expect(store.closeTab).toHaveBeenLastCalledWith('tab-2');
    expect(wrapper.get('[data-testid="tabbar-settings"]').attributes()).toHaveProperty('disabled');
    await wrapper.get('[data-testid="tabbar-settings"]').trigger('click');
    expect(wrapper.find('#settings-panel').exists()).toBe(false);
    firstClose.resolve(undefined);
    await vi.waitFor(() => expect(store.closeTab).toHaveBeenCalledTimes(2));
    expect(store.closeTab).toHaveBeenLastCalledWith('tab-3');
  });

  it('skips a second close-others request while the first transaction is pending', async () => {
    const store = useWorkspaceStore();
    const first = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    store.workspace = addTab(first, 'session-b', ids('tab-2', 'pane-2'));
    const pendingClose = deferredPromise<void>();
    store.closeTab = vi.fn(async (tabId: string) => {
      await pendingClose.promise;
      store.workspace = closeWorkspaceTab(store.workspace, tabId);
    });
    const wrapper = mount(App, { global: { stubs: { TerminalPane: true } } });
    await wrapper.get('[data-testid="tabbar-settings"]').trigger('click');
    const outsideInput = document.createElement('input');
    document.body.append(outsideInput);
    outsideInput.focus();

    wrapper.getComponent({ name: 'TerminalTabs' }).vm.$emit('closeOtherTabs', 'tab-1');
    await vi.waitFor(() => expect(store.closeTab).toHaveBeenCalledOnce());
    expect(wrapper.get('[aria-label="New terminal"]').attributes()).toHaveProperty('disabled');
    expect(wrapper.getComponent({ name: 'SettingsView' }).props('pending')).toBe(true);
    wrapper.getComponent({ name: 'TerminalTabs' }).vm.$emit('closeOtherTabs', 'tab-1');
    await new Promise((resolve) => window.setTimeout(resolve));

    expect(wrapper.find('[data-tab-id="app-settings"]').exists()).toBe(true);
    expect(document.activeElement).toBe(outsideInput);
    pendingClose.resolve(undefined);
    await vi.waitFor(() =>
      expect(wrapper.find('[data-tab-id="app-settings"]').exists()).toBe(false),
    );
    outsideInput.remove();
  });

  it('skips AI terminal opens while close-others is pending', async () => {
    const store = useWorkspaceStore();
    const first = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    store.workspace = addTab(first, 'session-b', ids('tab-2', 'pane-2'));
    const pendingClose = deferredPromise<void>();
    store.closeTab = vi.fn(async (tabId: string) => {
      await pendingClose.promise;
      store.workspace = closeWorkspaceTab(store.workspace, tabId);
    });
    store.openTab = vi.fn(async () => {
      store.workspace = addTab(store.workspace, 'session-c', ids('tab-3', 'pane-3'));
    });
    const wrapper = mount(App, {
      global: {
        stubs: {
          TerminalPane: true,
          AIPanel: {
            props: ['runAppAction'],
            template:
              '<button data-testid="ai-open-during-close" @click="runAppAction({ type: \'terminal.openLocal\' })">Open</button>',
          },
        },
      },
    });
    await wrapper.get('[data-testid="tabbar-ai"]').trigger('click');

    wrapper.getComponent({ name: 'TerminalTabs' }).vm.$emit('closeOtherTabs', 'tab-1');
    await vi.waitFor(() => expect(store.closeTab).toHaveBeenCalledOnce());
    await wrapper.get('[data-testid="ai-open-during-close"]').trigger('click');
    await new Promise((resolve) => window.setTimeout(resolve));

    expect(store.openTab).not.toHaveBeenCalled();
    pendingClose.resolve(undefined);
    await vi.waitFor(() => expect(store.workspace.tabs.map((tab) => tab.id)).toEqual(['tab-1']));
  });

  it('stops on the first close failure and retries only the remaining tabs', async () => {
    const store = useWorkspaceStore();
    const first = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    const second = addTab(first, 'session-b', ids('tab-2', 'pane-2'));
    store.workspace = addTab(second, 'session-c', ids('tab-3', 'pane-3'));
    let thirdTabAttempts = 0;
    store.closeTab = vi.fn(async (tabId: string) => {
      if (tabId === 'tab-3' && thirdTabAttempts === 0) {
        thirdTabAttempts += 1;
        throw new Error('batch close failed');
      }
      store.workspace = closeWorkspaceTab(store.workspace, tabId);
    });
    const wrapper = mount(App, {
      attachTo: document.body,
      global: {
        stubs: {
          TerminalPane: {
            emits: ['focus'],
            template: '<textarea class="xterm-helper-textarea" />',
          },
        },
      },
    });
    await wrapper.get('[data-testid="tabbar-settings"]').trigger('click');
    const targetTextarea = wrapper.get<HTMLTextAreaElement>(
      '#terminal-panel-tab-1 .xterm-helper-textarea',
    ).element;
    const outsideInput = document.createElement('input');
    document.body.append(outsideInput);
    outsideInput.focus();

    wrapper.getComponent({ name: 'TerminalTabs' }).vm.$emit('closeOtherTabs', 'tab-1');

    await vi.waitFor(() =>
      expect(wrapper.get('[role="alert"]').text()).toContain('batch close failed'),
    );
    expect(store.closeTab).toHaveBeenCalledTimes(2);
    expect(store.closeTab).toHaveBeenNthCalledWith(1, 'tab-2');
    expect(store.closeTab).toHaveBeenNthCalledWith(2, 'tab-3');
    expect(wrapper.find('[data-tab-id="app-settings"]').exists()).toBe(true);
    expect(document.activeElement).toBe(outsideInput);

    store.openTab = vi.fn(async () => undefined);
    wrapper.getComponent({ name: 'TerminalTabs' }).vm.$emit('newTerminal');
    await vi.waitFor(() => expect(store.openTab).toHaveBeenCalledOnce());
    expect(wrapper.get('[role="alert"]').text()).toContain('batch close failed');
    expect(wrapper.get('[data-testid="retry-action"]').exists()).toBe(true);

    await wrapper.get('[data-testid="retry-action"]').trigger('click');

    await vi.waitFor(() =>
      expect(wrapper.findAll('.tab-item').map((tab) => tab.attributes('data-tab-id'))).toEqual([
        'tab-1',
      ]),
    );
    expect(store.closeTab).toHaveBeenCalledTimes(3);
    expect(store.closeTab).toHaveBeenLastCalledWith('tab-3');
    await vi.waitFor(() => expect(wrapper.find('[role="alert"]').exists()).toBe(false));
    await vi.waitFor(() => expect(document.activeElement).toBe(targetTextarea));
    outsideInput.remove();
  });

  it('restores focus to the current terminal target after closing settings', async () => {
    const store = useWorkspaceStore();
    store.workspace = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    const wrapper = mount(App, {
      attachTo: document.body,
      global: {
        stubs: {
          TerminalPane: {
            emits: ['focus'],
            template: '<textarea class="xterm-helper-textarea" />',
          },
        },
      },
    });
    await wrapper.get('[data-testid="tabbar-settings"]').trigger('click');
    await wrapper.get('[data-tab-id="tab-1"] .tab-button').trigger('click');
    const targetTextarea = wrapper.get<HTMLTextAreaElement>(
      '#terminal-panel-tab-1 .xterm-helper-textarea',
    ).element;

    wrapper.getComponent({ name: 'TerminalTabs' }).vm.$emit('closeOtherTabs', 'tab-1');

    await vi.waitFor(() => expect(wrapper.find('#settings-panel').exists()).toBe(false));
    await vi.waitFor(() => expect(document.activeElement).toBe(targetTextarea));
  });

  it('wires settings terminal creation through the application shell', async () => {
    const store = useWorkspaceStore();
    store.openTab = vi.fn(async () => undefined);
    const wrapper = mount(App, { global: { stubs: { TerminalPane: true } } });
    await wrapper.get('[data-testid="start-settings"]').trigger('click');

    wrapper.getComponent({ name: 'SettingsView' }).vm.$emit('createTerminal');

    await vi.waitFor(() => expect(store.openTab).toHaveBeenCalledOnce());
  });

  it('uses the start-page footer as the only bottom bar when no terminal exists', () => {
    const wrapper = mount(App);

    expect(wrapper.get('.start-page-footer').exists()).toBe(true);
    expect(wrapper.find('.status-bar').exists()).toBe(false);
    expect(wrapper.get('.app-shell').classes()).toContain('start-page-active');
  });

  it('removes the FleurTerm title header and keeps the tab row at the top', () => {
    const wrapper = mount(App);

    expect(wrapper.find('.app-title-bar').exists()).toBe(false);
    expect(wrapper.get('.app-shell').element.firstElementChild?.classList).toContain(
      'terminal-tabs',
    );
  });

  it('does not expose split controls in the terminal workspace', () => {
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
    const wrapper = mount(App, {
      global: {
        stubs: {
          TerminalPane: {
            template: '<div class="terminal-stub" />',
          },
        },
      },
    });

    expect(wrapper.get('[role="tab"]').text()).toContain('Terminal 1');
    expect(wrapper.find('[data-testid="split-horizontal"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="split-vertical"]').exists()).toBe(false);
  });

  it('executes common application keyboard shortcuts', async () => {
    const store = useWorkspaceStore();
    store.workspace = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    store.openTab = vi.fn(async () => undefined);
    store.closeTab = vi.fn(async () => undefined);
    store.writeToFocusedSession = vi.fn(async () => undefined);
    const wrapper = mount(App, {
      global: { stubs: { TerminalPane: true } },
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', metaKey: true }));
    await vi.waitFor(() => expect(store.openTab).toHaveBeenCalledOnce());
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    await vi.waitFor(() => expect(store.writeToFocusedSession).toHaveBeenCalledWith('\x0c'));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.get('#settings-panel').attributes('aria-hidden')).toBe('false');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', metaKey: true }));
    await vi.waitFor(() => expect(wrapper.find('#settings-panel').exists()).toBe(false));
  });

  it('uses a customized keyboard shortcut immediately', async () => {
    const store = useWorkspaceStore();
    store.openTab = vi.fn(async () => undefined);
    useAppSettingsStore().updateShortcutSetting('new-terminal', {
      key: 'j',
      modifier: 'primary',
      shift: true,
    });
    mount(App);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true, shiftKey: true }));
    await vi.waitFor(() => expect(store.openTab).toHaveBeenCalledOnce());

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', metaKey: true }));
    await Promise.resolve();
    expect(store.openTab).toHaveBeenCalledOnce();
  });

  it('does not intercept terminal editing keyboard shortcuts', async () => {
    const store = useWorkspaceStore();
    store.workspace = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    mount(App, { global: { stubs: { TerminalPane: true } } });

    const events = ['c', 'v', 'a'].map(
      (key) => new KeyboardEvent('keydown', { key, metaKey: true, cancelable: true }),
    );
    events.forEach((event) => window.dispatchEvent(event));

    expect(events.every((event) => !event.defaultPrevented)).toBe(true);
  });

  it('executes native menu commands through the same application actions', async () => {
    const store = useWorkspaceStore();
    store.openTab = vi.fn(async () => undefined);
    const wrapper = mount(App);

    await vi.waitFor(() => expect(desktopMenuMock.listen).toHaveBeenCalledOnce());
    desktopMenuMock.commandHandler?.('new-terminal');
    await vi.waitFor(() => expect(store.openTab).toHaveBeenCalledOnce());

    desktopMenuMock.commandHandler?.('toggle-ai');
    await wrapper.vm.$nextTick();
    expect(wrapper.get('.ai-panel').exists()).toBe(true);

    desktopMenuMock.commandHandler?.('open-settings');
    await wrapper.vm.$nextTick();
    expect(wrapper.get('#settings-panel').attributes('aria-hidden')).toBe('false');
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
    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="retry-action"]').exists()).toBe(true),
    );
    await wrapper.get('[data-testid="retry-action"]').trigger('click');

    await vi.waitFor(() => expect(store.openTab).toHaveBeenCalledTimes(2));
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
      connectionProfileId: 'server',
      sftpConnectionProfileId: 'server',
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
    await wrapper.get('[data-connection-method="local"]').trigger('click');
    await wrapper.get('[data-testid="connection-cwd"]').setValue('D:\\IT\\Projects\\fleuruiterm');
    await wrapper.get('[data-testid="connection-shell"]').setValue('wsl.exe');
    await wrapper.get('[data-testid="save-connection"]').trigger('click');
    await wrapper.findAll('.settings-connection-main').at(-1)?.trigger('click');

    expect(store.openTab).toHaveBeenCalledWith({
      shell: 'wsl.exe',
      cwd: 'D:\\IT\\Projects\\fleuruiterm',
      title: 'Project',
      connectionProfileId: 'project',
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
    await wrapper.get('[data-connection-method="telnet"]').trigger('click');
    await wrapper.get('[data-testid="connection-host"]').setValue('10.0.0.1');
    await wrapper.get('[data-testid="connection-user"]').setValue('admin');
    await wrapper.get('[data-testid="connection-port"]').setValue(2323);
    await wrapper.get('[data-testid="save-connection"]').trigger('click');
    await wrapper.findAll('.settings-connection-main').at(-1)?.trigger('click');

    expect(store.openTab).toHaveBeenCalledWith({
      shell: 'telnet',
      args: ['10.0.0.1', '2323'],
      title: 'Telnet 10.0.0.1',
      connectionProfileId: 'router',
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
    await wrapper.get('[data-form-tab="ports"]').trigger('click');
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
      connectionProfileId: 'tunnel',
      sftpConnectionProfileId: 'tunnel',
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
    await wrapper.get('[data-form-tab="authentication"]').trigger('click');
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
      connectionProfileId: 'password-host',
      sftpConnectionProfileId: 'password-host',
    });
  });

  it('does not offer unsupported serial connections in the settings dialog', async () => {
    const wrapper = mount(App, {
      global: { stubs: { TerminalPane: true } },
    });

    await wrapper.get('[data-testid="tabbar-settings"]').trigger('click');
    await wrapper.get('[data-section="connections"]').trigger('click');
    await wrapper.get('[data-testid="add-connection"]').trigger('click');

    expect(wrapper.get('.connection-dialog-protocols').text()).not.toContain('Serial');
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
    await vi.waitFor(() =>
      expect(store.workspace.tabs.map((tab) => tab.id)).toEqual(['tab-2', 'tab-1']),
    );

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

  it('persists the settings tab after moving it before terminal tabs', async () => {
    const store = useWorkspaceStore();
    const first = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    store.workspace = addTab(first, 'session-b', ids('tab-2', 'pane-2'));
    const wrapper = mount(App, {
      global: { stubs: { TerminalPane: true } },
    });
    await wrapper.get('[data-testid="tabbar-settings"]').trigger('click');
    await vi.waitFor(() => expect(workspacePersistenceClient.save).toHaveBeenCalled());
    vi.mocked(workspacePersistenceClient.save).mockClear();

    wrapper
      .getComponent({ name: 'TerminalTabs' })
      .vm.$emit('reorder', 'app-settings', 'tab-1', 'before');

    await vi.waitFor(() =>
      expect(workspacePersistenceClient.save).toHaveBeenLastCalledWith({
        version: 2,
        activeTabId: 'app-settings',
        settingsTabIndex: 0,
        tabs: [
          {
            id: 'tab-1',
            title: 'Local Terminal 1',
            launch: { type: 'local' },
          },
          {
            id: 'tab-2',
            title: 'Local Terminal 2',
            launch: { type: 'local' },
          },
        ],
      }),
    );
    expect(wrapper.findAll('.tab-item').map((tab) => tab.attributes('data-tab-id'))).toEqual([
      'app-settings',
      'tab-1',
      'tab-2',
    ]);
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

  it('provides terminal write actions to the AI conversation runner', async () => {
    const store = useWorkspaceStore();
    store.workspace = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    store.writeToFocusedSession = vi.fn(async () => undefined);
    const wrapper = mount(App, {
      global: {
        stubs: {
          TerminalPane: true,
          AIPanel: {
            props: ['runAppAction'],
            template:
              '<button data-testid="ai-run-command" @click="runAppAction({ type: \'terminal.write\', input: \'pwd\' })">Run</button>',
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
            props: ['runAppAction'],
            template:
              '<button data-testid="ai-update-setting" @click="runAppAction({ type: \'settings.updateTerminal\', patch: { fontSize: 16 } })">Apply</button>',
          },
        },
      },
    });

    await wrapper.get('[data-testid="tabbar-ai"]').trigger('click');
    await wrapper.get('[data-testid="ai-update-setting"]').trigger('click');

    expect(appSettings.terminalSettings.value.fontSize).toBe(16);
  });

  it('lets AI application actions update every application setting group', async () => {
    const appSettings = useAppSettingsStore();
    const wrapper = mount(App, {
      global: {
        stubs: {
          AIPanel: {
            props: ['runAppAction'],
            template:
              "<button data-testid=\"ai-update-all-settings\" @click=\"runAppAction({ type: 'settings.update', patch: { startup: { openTerminalOnStartup: true }, appearance: { themeMode: 'light' }, terminal: { fontSize: 17 }, ai: { model: 'new-model' } } })\">Apply</button>",
          },
        },
      },
    });

    await wrapper.get('[data-testid="tabbar-ai"]').trigger('click');
    await wrapper.get('[data-testid="ai-update-all-settings"]').trigger('click');

    expect(appSettings.startupSettings.value.openTerminalOnStartup).toBe(true);
    expect(appSettings.appearanceSettings.value.themeMode).toBe('light');
    expect(document.documentElement.dataset.themeMode).toBe('light');
    expect(appSettings.terminalSettings.value.fontSize).toBe(17);
    expect(appSettings.aiSettings.value.model).toBe('new-model');
  });

  it('blocks AI application actions from changing the endpoint and token', async () => {
    const appSettings = useAppSettingsStore();
    appSettings.updateAiSettings({
      baseUrl: 'https://original.example.com/v1',
      token: 'original-token',
    });
    const wrapper = mount(App, {
      global: {
        stubs: {
          AIPanel: {
            props: ['runAppAction'],
            template: [
              '<div>',
              "<button data-testid=\"ai-update-sensitive-settings\" @click=\"runAppAction({ type: 'settings.update', patch: { ai: { baseUrl: 'https://blocked.example.com/v1', token: 'blocked-token' } } })\">Apply</button>",
              "<button data-testid=\"ai-update-sensitive-settings-legacy\" @click=\"runAppAction({ type: 'settings.updateAi', patch: { baseUrl: 'https://legacy-blocked.example.com/v1', token: 'legacy-blocked-token' } })\">Apply legacy</button>",
              '</div>',
            ].join(''),
          },
        },
      },
    });

    await wrapper.get('[data-testid="tabbar-ai"]').trigger('click');
    await wrapper.get('[data-testid="ai-update-sensitive-settings"]').trigger('click');

    expect(appSettings.aiSettings.value.baseUrl).toBe('https://original.example.com/v1');
    expect(appSettings.aiSettings.value.token).toBe('original-token');

    await wrapper.get('[data-testid="ai-update-sensitive-settings-legacy"]').trigger('click');

    expect(appSettings.aiSettings.value.baseUrl).toBe('https://original.example.com/v1');
    expect(appSettings.aiSettings.value.token).toBe('original-token');
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
            props: ['runAppAction'],
            template:
              "<button data-testid=\"ai-open-ssh\" @click=\"runAppAction({ type: 'terminal.openSsh', host: 'example.com', user: 'root', port: 2222 })\">Open</button>",
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

  it('lets AI activate an existing terminal without creating a new one', async () => {
    const store = useWorkspaceStore();
    store.workspace = addTab(
      createWorkspace('session-a', ids('tab-1', 'pane-1'), 'Production'),
      'session-b',
      ids('tab-2', 'pane-2'),
      'Staging',
    );
    store.openTab = vi.fn(async () => undefined);
    const wrapper = mount(App, {
      global: {
        stubs: {
          TerminalPane: true,
          AIPanel: {
            props: ['runAppAction'],
            template:
              '<button data-testid="ai-activate-terminal" @click="runAppAction({ type: \'terminal.activate\', target: \'production\' })">Activate</button>',
          },
        },
      },
    });

    await wrapper.get('[data-testid="tabbar-ai"]').trigger('click');
    await wrapper.get('[data-testid="ai-activate-terminal"]').trigger('click');

    expect(store.workspace.activeTabId).toBe('tab-1');
    expect(store.openTab).not.toHaveBeenCalled();
  });

  it('lets AI open a saved SSH connection by host', async () => {
    localStorage.setItem(
      'fleurterm.connections',
      JSON.stringify([
        {
          id: 'root-10-7-121-72',
          name: 'root@10.7.121.72',
          group: 'default',
          method: 'ssh',
          host: '10.7.121.72',
          user: 'root',
          port: 22,
          authMethod: 'password',
          hasPassword: true,
          password: '',
          privateKeys: [],
          forwardedPorts: [],
          loginScripts: '',
        },
      ]),
    );
    vi.spyOn(settingsClient, 'loadPasswords').mockResolvedValue({
      'root-10-7-121-72': 'secret',
    });
    const store = useWorkspaceStore();
    store.openTab = vi.fn(async () => {
      store.workspace = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    });
    const wrapper = mount(App, {
      global: {
        stubs: {
          TerminalPane: true,
          AIPanel: {
            props: ['runAppAction'],
            template:
              '<button data-testid="ai-open-saved" @click="runAppAction({ type: \'connection.open\', target: \'10.7.121.72\' })">Open</button>',
          },
        },
      },
    });

    await wrapper.get('[data-testid="tabbar-ai"]').trigger('click');
    await wrapper.get('[data-testid="ai-open-saved"]').trigger('click');
    await vi.waitFor(() => expect(store.openTab).toHaveBeenCalledOnce());

    expect(store.openTab).toHaveBeenCalledWith({
      shell: 'ssh',
      args: [
        '-p',
        '22',
        '-o',
        'PreferredAuthentications=password,keyboard-interactive',
        '-o',
        'PubkeyAuthentication=no',
        'root@10.7.121.72',
      ],
      password: 'secret',
      title: 'SSH root@10.7.121.72',
      connectionProfileId: 'root-10-7-121-72',
      sftpConnectionProfileId: 'root-10-7-121-72',
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

function deferredPromise<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value: T) {
      if (resolvePromise === undefined) {
        throw new Error('deferred promise is unavailable');
      }
      resolvePromise(value);
    },
  };
}
