import { readFileSync } from 'node:fs';

import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLocale } from '@/i18n/locale';
import { settingsClient } from '@/services/settingsClient';
import {
  defaultAiSettings,
  defaultTerminalSettings,
  useAppSettingsStore,
} from '@/stores/appSettingsStore';

import SettingsView from './SettingsView.vue';

const globalStyles = readFileSync('src/styles/global.css', 'utf8');

enableAutoUnmount(afterEach);

describe('SettingsView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    setLocale('en-US');
    useAppSettingsStore().replaceRuntimeSettings({
      ai: defaultAiSettings,
      terminal: defaultTerminalSettings,
    });
    useAppSettingsStore().resetShortcutSettings();
    document.documentElement.removeAttribute('style');
    vi.restoreAllMocks();
  });

  it('uses the FleurUI settings sections', () => {
    const wrapper = mount(SettingsView);

    expect(wrapper.get('.settings-nav').text()).toContain('General');
    expect(wrapper.get('.settings-nav').text()).toContain('Appearance');
    expect(wrapper.get('.settings-nav').text()).toContain('Terminal');
    expect(wrapper.get('.settings-nav').text()).toContain('Profiles & connections');
    expect(wrapper.get('.settings-nav').text()).toContain('Hotkeys');
    expect(wrapper.get('.settings-nav').text()).toContain('AI');
    expect(wrapper.get('.settings-nav').text()).toContain('Advanced');
    expect(wrapper.findAll('.settings-nav-icon')).toHaveLength(7);
    expect(wrapper.get('[data-section="general"]').classes()).toContain('is-active');
  });

  it('shows document-defined settings pages as static presentations', async () => {
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-section="terminal"]').trigger('click');
    expect(
      (wrapper.get('[data-testid="settings-scrollback"]').element as HTMLInputElement).value,
    ).toBe('25000');
    expect(wrapper.get('[data-testid="settings-scroll-on-input"]').exists()).toBe(true);

    await wrapper.get('[data-section="hotkeys"]').trigger('click');
    expect(wrapper.get('[data-testid="settings-panel"]').text()).toContain('New terminal');
    expect(wrapper.findAll('.settings-shortcut-row').length).toBeGreaterThanOrEqual(8);
    expect(wrapper.get('[data-testid="settings-panel"]').text()).toContain('Open settings');
    expect(wrapper.get('[data-testid="settings-panel"]').text()).toContain('Clear terminal');
    expect(wrapper.get('[data-testid="settings-panel"]').text()).not.toContain('Split');
    expect(wrapper.findAll('button[data-testid^="record-"]')).toHaveLength(10);
    expect(wrapper.get('[data-testid="settings-panel"]').text()).not.toContain('System shortcut');

    await wrapper.get('[data-section="ai"]').trigger('click');
    expect(wrapper.get('[data-testid="settings-ai-provider"]').text()).toContain('Not configured');
    expect(wrapper.get('[data-testid="settings-ai-policy"]').text()).toContain('Ask every time');
  });

  it('records, applies, and removes an editable shortcut', async () => {
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-section="hotkeys"]').trigger('click');
    const newTerminalShortcut = wrapper.get('[data-shortcut-id="new-terminal"]');
    expect(newTerminalShortcut.text()).toContain('New terminal');
    expect(newTerminalShortcut.text()).toContain('(new-terminal)');
    expect(newTerminalShortcut.get('.settings-shortcut-remove svg').exists()).toBe(true);

    await newTerminalShortcut.get('[data-testid="record-new-terminal"]').trigger('click');
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'j', metaKey: true, shiftKey: true, bubbles: true }),
    );
    await wrapper.vm.$nextTick();

    expect(newTerminalShortcut.text()).toContain('J');
    expect(useAppSettingsStore().shortcutSettings.value['new-terminal']).toEqual({
      key: 'j',
      modifier: 'primary',
      shift: true,
    });
    expect(JSON.parse(localStorage.getItem('fleurterm.runtimeSettings') ?? '{}').shortcuts).toEqual(
      {
        'new-terminal': { key: 'j', modifier: 'primary', shift: true },
      },
    );

    await newTerminalShortcut.get('[data-testid="remove-new-terminal"]').trigger('click');
    expect(useAppSettingsStore().shortcutSettings.value['new-terminal']).toBeNull();
    expect(newTerminalShortcut.text()).toContain('Add shortcut');
  });

  it('keeps the existing shortcut when a recorded binding conflicts', async () => {
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-section="hotkeys"]').trigger('click');
    await wrapper
      .get('[data-shortcut-id="close-tab"] [data-testid="record-close-tab"]')
      .trigger('click');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', metaKey: true, bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[role="alert"]').text()).toContain('New terminal');
    expect(useAppSettingsStore().shortcutSettings.value['close-tab']).toBeUndefined();
  });

  it('switches the application language from the general section', async () => {
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-testid="settings-language-select"]').trigger('click');
    await wrapper.get('[data-value="zh-CN"]').trigger('click');

    expect(localStorage.getItem('fleurterm.locale')).toBe('zh-CN');
    expect(wrapper.get('.settings-value-pill').text()).toBe('简体中文');
    expect(wrapper.get('.settings-nav').text()).toContain('通用');
    expect(wrapper.get('.settings-sidebar-copy').text()).toContain('设置');
  });

  it('shows complete Chinese labels in terminal settings', async () => {
    setLocale('zh-CN');
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-section="terminal"]').trigger('click');
    const terminalSettingsText = wrapper.get('[data-testid="settings-panel"]').text();

    expect(terminalSettingsText).toContain('行高');
    expect(terminalSettingsText).toContain('新打开终端的垂直行距。');
    expect(terminalSettingsText).toContain('重置终端');
    expect(terminalSettingsText).not.toContain('Line height');
    expect(terminalSettingsText).not.toContain('Reset terminal');
  });

  it('prevents selecting settings copy while keeping editable text selectable', () => {
    const settingsViewRule = /\.settings-tab\.settings-view\s*\{([^}]*)\}/.exec(globalStyles)?.[1];
    const editableTextRule =
      /\.settings-tab\.settings-view input,\s*\.settings-tab\.settings-view textarea,\s*\.settings-tab\.settings-view \[contenteditable='true'\]\s*\{([^}]*)\}/.exec(
        globalStyles,
      )?.[1];

    expect(settingsViewRule).toContain('user-select: none');
    expect(editableTextRule).toContain('user-select: text');
  });

  it('shows one software update card in the general section', async () => {
    const wrapper = mount(SettingsView);

    expect(wrapper.findAll('[data-testid="software-update-card"]')).toHaveLength(1);
    await wrapper.get('[data-section="terminal"]').trigger('click');
    await wrapper.get('[data-section="general"]').trigger('click');

    expect(wrapper.findAll('[data-testid="software-update-card"]')).toHaveLength(1);
  });

  it('does not read saved passwords when the settings page opens', async () => {
    vi.spyOn(settingsClient, 'available', 'get').mockReturnValue(true);
    const loadSettingsSpy = vi.spyOn(settingsClient, 'load').mockResolvedValue({
      exists: true,
      path: '/tmp/settings.json',
      settings: {
        workbench: {
          connections: [],
          recentConnectionIds: [],
        },
      },
      error: null,
    });
    const loadPasswordsSpy = vi.spyOn(settingsClient, 'loadPasswords').mockResolvedValue({});

    mount(SettingsView);

    await vi.waitFor(() => expect(loadSettingsSpy).toHaveBeenCalledOnce());
    expect(loadPasswordsSpy).not.toHaveBeenCalled();
  });

  it('loads a saved password without prompting for a master password', async () => {
    vi.spyOn(settingsClient, 'available', 'get').mockReturnValue(true);
    const loadSettingsSpy = vi.spyOn(settingsClient, 'load').mockResolvedValue({
      exists: true,
      path: '/tmp/settings.json',
      settings: {
        workbench: {
          connections: [
            {
              id: 'production',
              name: 'Production',
              group: 'Servers',
              method: 'ssh',
              host: 'prod.example.com',
              user: 'deploy',
              port: 22,
              authMethod: 'password',
              hasPassword: true,
              password: '',
            },
          ],
          recentConnectionIds: [],
        },
      },
      error: null,
    });
    const loadPasswordsSpy = vi
      .spyOn(settingsClient, 'loadPasswords')
      .mockResolvedValue({ production: 'ssh-password' });
    const wrapper = mount(SettingsView);

    await vi.waitFor(() => expect(loadSettingsSpy).toHaveBeenCalledOnce());
    await wrapper.get('[data-section="connections"]').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Production'));
    const productionCard = wrapper
      .findAll('.settings-connection-card')
      .find((card) => card.text().includes('Production'));
    await productionCard?.get('.settings-connection-main').trigger('click');

    await vi.waitFor(() => {
      expect(loadPasswordsSpy).toHaveBeenCalledWith(['production']);
      expect(wrapper.emitted('openConnection')?.at(-1)).toEqual([
        expect.objectContaining({ id: 'production', password: 'ssh-password' }),
      ]);
    });
    expect(wrapper.find('[data-testid="vault-passphrase"]').exists()).toBe(false);
  });

  it('saves the first connection password without creating a master password', async () => {
    vi.spyOn(settingsClient, 'available', 'get').mockReturnValue(true);
    const loadSettingsSpy = vi.spyOn(settingsClient, 'load').mockResolvedValue({
      exists: true,
      path: '/tmp/settings.json',
      settings: {
        workbench: {
          connections: [],
          recentConnectionIds: [],
        },
      },
      error: null,
    });
    vi.spyOn(settingsClient, 'save').mockResolvedValue();
    const savePasswordSpy = vi.spyOn(settingsClient, 'savePassword').mockResolvedValue();
    const wrapper = mount(SettingsView);

    await vi.waitFor(() => expect(loadSettingsSpy).toHaveBeenCalledOnce());
    await wrapper.get('[data-section="connections"]').trigger('click');
    await wrapper.get('[data-testid="add-connection"]').trigger('click');
    await wrapper.get('[data-testid="connection-name"]').setValue('Production');
    await wrapper.get('[data-testid="connection-host"]').setValue('prod.example.com');
    await wrapper.get('[data-testid="connection-user"]').setValue('deploy');
    await wrapper.get('[data-form-tab="authentication"]').trigger('click');
    await wrapper
      .findAll('.connection-auth-actions .connection-dialog-secondary-button')
      .at(0)
      ?.trigger('click');
    await wrapper.get('.connection-dialog-password input[type="password"]').setValue('secret');
    await wrapper
      .get('.password-dialog-actions .connection-dialog-primary-button')
      .trigger('click');
    await wrapper.get('[data-testid="save-connection"]').trigger('click');

    await vi.waitFor(() => {
      expect(savePasswordSpy).toHaveBeenCalledWith(expect.any(String), 'secret');
    });
    expect(wrapper.find('[data-testid="vault-passphrase"]').exists()).toBe(false);
  });

  it('asks for a replacement password when a legacy password is unavailable', async () => {
    vi.spyOn(settingsClient, 'available', 'get').mockReturnValue(true);
    const loadSettingsSpy = vi.spyOn(settingsClient, 'load').mockResolvedValue({
      exists: true,
      path: '/tmp/settings.json',
      settings: {
        workbench: {
          connections: [
            {
              id: 'production',
              name: 'Production',
              group: 'Servers',
              method: 'ssh',
              host: 'prod.example.com',
              user: 'deploy',
              port: 22,
              authMethod: 'password',
              hasPassword: true,
              password: '',
            },
          ],
          recentConnectionIds: [],
        },
      },
      error: null,
    });
    vi.spyOn(settingsClient, 'loadPasswords').mockResolvedValue({});
    const savePasswordSpy = vi.spyOn(settingsClient, 'savePassword').mockResolvedValue();
    const wrapper = mount(SettingsView);

    await vi.waitFor(() => expect(loadSettingsSpy).toHaveBeenCalledOnce());
    await wrapper.get('[data-section="connections"]').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Production'));
    const productionCard = wrapper
      .findAll('.settings-connection-card')
      .find((card) => card.text().includes('Production'));
    await productionCard?.get('.settings-connection-main').trigger('click');

    await vi.waitFor(() => {
      expect(wrapper.get('.connection-dialog-password').exists()).toBe(true);
      expect(wrapper.text()).toContain('save it again');
    });
    expect(wrapper.find('[data-testid="vault-passphrase"]').exists()).toBe(false);

    await wrapper
      .get('.connection-dialog-password input[type="password"]')
      .setValue('replacement-password');
    await wrapper
      .get('.password-dialog-actions .connection-dialog-primary-button')
      .trigger('click');
    await wrapper.get('[data-testid="save-connection"]').trigger('click');

    await vi.waitFor(() => {
      expect(savePasswordSpy).toHaveBeenCalledWith('production', 'replacement-password');
    });
  });

  it('creates and opens an SSH connection from the connections section', async () => {
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-section="connections"]').trigger('click');
    await wrapper.get('[data-testid="add-connection"]').trigger('click');
    expect(wrapper.get('.app-dialog-layer').attributes('style')).toContain(
      '--app-dialog-width: 860px',
    );
    expect(wrapper.get('.connection-dialog-form').exists()).toBe(true);
    expect(wrapper.get('.connection-dialog-title-icon').exists()).toBe(true);
    expect(wrapper.get('.connection-dialog-layout').exists()).toBe(true);
    expect(wrapper.get('.connection-dialog-summary').exists()).toBe(true);
    expect(wrapper.get('.connection-panel-heading').text()).toContain('Connection method');
    expect(wrapper.get('.connection-dialog-protocols').findAll('button')).toHaveLength(3);
    expect(wrapper.get('.connection-dialog-protocols').text()).toContain('SSH');
    expect(wrapper.get('.connection-dialog-protocols').text()).toContain('Telnet');
    expect(wrapper.get('.connection-dialog-protocols').text()).toContain('Local');
    expect(wrapper.get('.connection-editor-tabs').text()).toContain('Authentication');
    expect(wrapper.get('.connection-editor-tabs').text()).toContain('Tunnels & proxy');
    expect(wrapper.get('.connection-dialog-footer-hint').text()).toContain('required');
    const hostInput = wrapper.get('[data-testid="connection-host"]');
    const userInput = wrapper.get('[data-testid="connection-user"]');
    expect((hostInput.element as HTMLInputElement).value).toBe('');
    expect(hostInput.attributes('placeholder')).toBe('localhost');
    expect((userInput.element as HTMLInputElement).value).toBe('');
    expect(userInput.attributes('placeholder')).toBe('local');

    await wrapper.get('[data-connection-method="local"]').trigger('click');
    await wrapper.get('[data-connection-method="ssh"]').trigger('click');
    expect((wrapper.get('[data-testid="connection-host"]').element as HTMLInputElement).value).toBe(
      '',
    );
    expect((wrapper.get('[data-testid="connection-user"]').element as HTMLInputElement).value).toBe(
      '',
    );

    await wrapper.get('[data-testid="connection-name"]').setValue('Production');
    await wrapper.get('[data-testid="connection-host"]').setValue('prod.example.com');
    await wrapper.get('[data-testid="connection-user"]').setValue('deploy');
    await wrapper.get('[data-testid="connection-port"]').setValue(2222);
    expect(wrapper.get('.connection-summary-copy strong').text()).toBe('Production');
    expect(wrapper.get('.connection-summary-copy code').text()).toBe(
      'deploy@prod.example.com:2222',
    );
    await wrapper.get('[data-testid="save-connection"]').trigger('click');
    await vi.waitFor(() => {
      expect(
        wrapper
          .findAll('.settings-connection-card')
          .some((card) => card.text().includes('Production')),
      ).toBe(true);
    });
    const productionCard = wrapper
      .findAll('.settings-connection-card')
      .find((card) => card.text().includes('Production'));
    await productionCard!.get('.settings-connection-main').trigger('click');

    expect(wrapper.text()).toContain('deploy@Production');
    expect(wrapper.emitted('openConnection')?.at(-1)).toEqual([
      expect.objectContaining({
        method: 'ssh',
        host: 'prod.example.com',
        user: 'deploy',
        port: 2222,
      }),
    ]);
  });

  it('keeps saved connection passwords out of local storage', async () => {
    const savePasswordSpy = vi.spyOn(settingsClient, 'savePassword').mockResolvedValue();
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-section="connections"]').trigger('click');
    await wrapper.get('[data-testid="add-connection"]').trigger('click');
    await wrapper.get('[data-testid="connection-name"]').setValue('Production');
    await wrapper.get('[data-testid="connection-host"]').setValue('prod.example.com');
    await wrapper.get('[data-testid="connection-user"]').setValue('deploy');
    await wrapper.get('[data-form-tab="authentication"]').trigger('click');
    await wrapper
      .findAll('.connection-auth-actions .connection-dialog-secondary-button')
      .at(0)
      ?.trigger('click');
    await wrapper.get('.connection-dialog-password input[type="password"]').setValue('secret');
    await wrapper
      .get('.password-dialog-actions .connection-dialog-primary-button')
      .trigger('click');
    await wrapper.get('[data-testid="save-connection"]').trigger('click');

    await vi.waitFor(() => {
      expect(savePasswordSpy).toHaveBeenCalledWith(expect.any(String), 'secret');
    });
    const cachedConnections = JSON.parse(
      localStorage.getItem('fleurterm.connections') ?? '[]',
    ) as Array<{ hasPassword: boolean; password: string }>;
    const productionConnection = cachedConnections.find((connection) => connection.hasPassword);

    expect(productionConnection).toMatchObject({ hasPassword: true, password: '' });
  });

  it('saves an empty connection group as default', async () => {
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-section="connections"]').trigger('click');
    await wrapper.get('[data-testid="add-connection"]').trigger('click');
    await wrapper.get('[data-testid="connection-name"]').setValue('Production');
    await wrapper.get('[data-testid="connection-host"]').setValue('prod.example.com');
    await wrapper.get('[data-testid="connection-user"]').setValue('deploy');
    await wrapper.get('[data-testid="connection-group"]').setValue('');

    expect(wrapper.get('[data-testid="save-connection"]').attributes('disabled')).toBeUndefined();
    await wrapper.get('[data-testid="save-connection"]').trigger('click');

    const cachedConnections = JSON.parse(
      localStorage.getItem('fleurterm.connections') ?? '[]',
    ) as Array<{ name: string; group: string }>;
    expect(cachedConnections.find((connection) => connection.name === 'Production')?.group).toBe(
      'default',
    );
  });

  it('disables native text suggestions and capitalization in the connection dialog', async () => {
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-section="connections"]').trigger('click');
    await wrapper.get('[data-testid="add-connection"]').trigger('click');

    const groupInput = wrapper.get('[data-testid="connection-group"]');
    expect(groupInput.attributes('list')).toBeUndefined();
    expect(wrapper.find('#connection-group-options').exists()).toBe(false);

    for (const field of wrapper.findAll(
      '.connection-dialog-form input:not([type="number"]):not([type="password"]), .connection-dialog-form textarea',
    )) {
      expect(field.attributes()).toMatchObject({
        autocomplete: 'off',
        autocapitalize: 'none',
        autocorrect: 'off',
        spellcheck: 'false',
      });
    }
  });

  it('supports keyboard navigation between connection form tabs', async () => {
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-section="connections"]').trigger('click');
    await wrapper.get('[data-testid="add-connection"]').trigger('click');

    const generalTab = wrapper.get('[data-form-tab="general"]');
    expect(wrapper.get('.connection-editor-tabs').attributes('role')).toBe('tablist');
    expect(generalTab.attributes('role')).toBe('tab');
    expect(generalTab.attributes('aria-selected')).toBe('true');
    expect(generalTab.attributes('aria-controls')).toBe('connection-panel-general');
    expect(wrapper.get('.connection-editor-panel').attributes('role')).toBe('tabpanel');

    await generalTab.trigger('keydown', { key: 'ArrowRight' });

    expect(wrapper.get('[data-form-tab="authentication"]').attributes('aria-selected')).toBe(
      'true',
    );
    expect(wrapper.get('.connection-editor-panel').attributes('id')).toBe(
      'connection-panel-authentication',
    );
  });

  it('keeps independent terminal colors for dark and light appearance modes', async () => {
    const opacitySpy = vi.spyOn(settingsClient, 'setWindowOpacity').mockResolvedValue();
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-section="appearance"]').trigger('click');
    expect(wrapper.get('.settings-appearance-layout').exists()).toBe(true);
    expect(wrapper.findAll('.settings-appearance-card')).toHaveLength(3);
    expect(wrapper.findAll('.settings-theme-card')).toHaveLength(3);

    await wrapper.get('[data-theme-mode="light"]').trigger('click');
    expect(document.documentElement.style.getPropertyValue('--theme-terminal-fg')).toBe('#1f2937');

    await wrapper.get('[data-palette-tone="dark"]').trigger('click');
    await wrapper.get('[data-testid="terminal-foreground-color"]').setValue('#123456');
    expect(document.documentElement.style.getPropertyValue('--theme-terminal-fg')).toBe('#1f2937');

    await wrapper.get('[data-palette-tone="light"]').trigger('click');
    await wrapper.get('[data-testid="terminal-foreground-color"]').setValue('#234567');
    expect(document.documentElement.style.getPropertyValue('--theme-terminal-fg')).toBe('#234567');

    await wrapper.get('[data-theme-mode="dark"]').trigger('click');
    expect(document.documentElement.style.getPropertyValue('--theme-terminal-fg')).toBe('#123456');

    await wrapper.get('.connection-toggle').trigger('click');
    await wrapper.get('input[type="range"]').setValue(75);
    await wrapper.findAll('input[type="range"]').at(1)?.setValue(18);

    expect(document.documentElement.dataset.themeMode).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--app-layer-blur')).toBe('18px');
    expect(opacitySpy).toHaveBeenLastCalledWith(0.75);

    const persistedTheme = JSON.parse(localStorage.getItem('fleurterm.theme') ?? '{}') as {
      config: {
        palettes: { dark: { terminalForeground: string }; light: { terminalForeground: string } };
      };
    };
    expect(persistedTheme.config.palettes.dark.terminalForeground).toBe('#123456');
    expect(persistedTheme.config.palettes.light.terminalForeground).toBe('#234567');
  });

  it('migrates the saved terminal palette without using light text on a light background', async () => {
    localStorage.setItem(
      'fleurterm.theme',
      JSON.stringify({
        mode: 'dark',
        config: {
          tone: 'dark',
          palette: { terminalForeground: '#abcdef', terminalMuted: '#789abc' },
        },
      }),
    );
    const wrapper = mount(SettingsView);

    expect(document.documentElement.style.getPropertyValue('--theme-terminal-fg')).toBe('#abcdef');
    await wrapper.get('[data-section="appearance"]').trigger('click');
    await wrapper.get('[data-theme-mode="light"]').trigger('click');

    expect(document.documentElement.style.getPropertyValue('--theme-terminal-fg')).toBe('#1f2937');
    expect(document.documentElement.style.getPropertyValue('--theme-terminal-muted')).toBe(
      '#667085',
    );
  });

  it('uses neutral black and gray surfaces for the dark theme', async () => {
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-section="appearance"]').trigger('click');
    await wrapper.get('[data-theme-mode="dark"]').trigger('click');

    expect(document.documentElement.dataset.themeTone).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--color-canvas')).toBe('#000000');
    expect(document.documentElement.style.getPropertyValue('--color-surface')).toBe('#111111');
    expect(document.documentElement.style.getPropertyValue('--color-surface-raised')).toBe(
      '#202020',
    );
    expect(document.documentElement.style.getPropertyValue('--color-terminal')).toBe('#202020');
  });

  it('configures AI provider endpoint and authentication settings', async () => {
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-section="ai"]').trigger('click');
    await wrapper.get('[data-testid="settings-ai-provider"]').trigger('click');
    await wrapper.get('[data-value="openai"]').trigger('click');
    await wrapper.get('[data-testid="settings-ai-model"]').setValue('gpt-test');
    await wrapper.get('[data-testid="settings-ai-token"]').setValue('token-a');
    expect(useAppSettingsStore().aiSettings.value.streamingEnabled).toBe(true);
    await wrapper.get('[data-testid="settings-ai-streaming"]').trigger('click');
    await wrapper.get('[data-testid="settings-ai-policy"]').trigger('click');
    expect(wrapper.get('.app-select-menu').classes()).toContain('app-select-menu-top');
    expect(wrapper.get('[data-value="fullAccess"]').text()).toBe('Full terminal access');
    await wrapper.get('[data-value="fullAccess"]').trigger('click');
    expect(useAppSettingsStore().aiSettings.value.streamingEnabled).toBe(false);
    await wrapper.get('[data-testid="settings-ai-streaming"]').trigger('click');

    expect(
      (wrapper.get('[data-testid="settings-ai-base-url"]').element as HTMLInputElement).value,
    ).toBe('https://api.openai.com/v1');
    await wrapper.get('[data-testid="settings-ai-base-url"]').setValue('');
    expect(
      (wrapper.get('[data-testid="settings-ai-base-url"]').element as HTMLInputElement).value,
    ).toBe('');
    await wrapper
      .get('[data-testid="settings-ai-base-url"]')
      .setValue('https://openai-proxy.example/v1');
    expect(useAppSettingsStore().aiSettings.value).toMatchObject({
      provider: 'openai',
      baseUrl: 'https://openai-proxy.example/v1',
      model: 'gpt-test',
      token: 'token-a',
      tokenHeaderName: 'Authorization',
      tokenPrefix: 'Bearer',
      streamingEnabled: true,
      commandPolicy: 'fullAccess',
    });

    await wrapper.get('[data-testid="settings-ai-provider"]').trigger('click');
    await wrapper.get('[data-value="custom"]').trigger('click');
    await wrapper.get('[data-testid="settings-ai-base-url"]').setValue('https://proxy.example/v1');
    await wrapper.get('[data-testid="settings-ai-token-header"]').setValue('X-API-Key');
    await wrapper.get('[data-testid="settings-ai-token-prefix"]').setValue('');

    expect(useAppSettingsStore().aiSettings.value).toMatchObject({
      provider: 'custom',
      baseUrl: 'https://proxy.example/v1',
      tokenHeaderName: 'X-API-Key',
      tokenPrefix: '',
    });
  });

  it('localizes AI settings controls in Chinese', async () => {
    setLocale('zh-CN');
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-section="ai"]').trigger('click');
    await wrapper.get('[data-testid="settings-ai-policy"]').trigger('click');

    const panelText = wrapper.get('[data-testid="settings-panel"]').text();
    expect(panelText).toContain('服务提供方');
    expect(panelText).toContain('接口地址');
    expect(panelText).toContain('模型');
    expect(panelText).toContain('认证令牌');
    expect(panelText).toContain('流式输出');
    expect(panelText).toContain('工作目录');
    expect(wrapper.get('[data-value="fullAccess"]').text()).toBe('完全访问');
    expect(panelText).not.toContain('Provider');
    expect(panelText).not.toContain('Authentication token');
    expect(panelText).not.toContain('Streaming output');
    expect(panelText).not.toContain('Working directory');
  });

  it('applies workbench configuration from the advanced editor', async () => {
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-section="advanced"]').trigger('click');
    await wrapper.get('[data-testid="settings-json-editor"]').setValue(
      JSON.stringify({
        locale: 'en-US',
        workbench: {
          recentConnectionIds: ['staging'],
          connections: [
            {
              id: 'staging',
              name: 'Staging',
              group: 'Servers',
              icon: 'S',
              color: '#4fadff',
              method: 'ssh',
              host: 'staging.example.com',
              user: 'admin',
              port: 22,
              shell: '',
              authMethod: 'auto',
              password: '',
              privateKeys: [],
              loginScripts: '',
              terminalColorScheme: 'auto',
              behaviorOnSessionEnd: 'auto',
              clearServiceMessagesOnConnect: true,
              disableDynamicTitle: false,
              forwardedPorts: [],
              cwd: '',
            },
          ],
        },
      }),
    );
    await wrapper.get('[data-testid="apply-settings-json"]').trigger('click');
    await wrapper.get('[data-section="connections"]').trigger('click');

    expect(wrapper.text()).toContain('admin@Staging');
  });
});
