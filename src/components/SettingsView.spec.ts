import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setLocale } from '@/i18n/locale';
import { settingsClient } from '@/services/settingsClient';
import {
  defaultAiSettings,
  defaultTerminalSettings,
  useAppSettingsStore,
} from '@/stores/appSettingsStore';

import SettingsView from './SettingsView.vue';

describe('SettingsView', () => {
  beforeEach(() => {
    localStorage.clear();
    setLocale('en-US');
    useAppSettingsStore().replaceRuntimeSettings({
      ai: defaultAiSettings,
      terminal: defaultTerminalSettings,
    });
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
    expect((wrapper.get('[data-testid="settings-scrollback"]').element as HTMLInputElement).value).toBe(
      '25000',
    );
    expect(wrapper.get('[data-testid="settings-scroll-on-input"]').exists()).toBe(true);

    await wrapper.get('[data-section="hotkeys"]').trigger('click');
    expect(wrapper.get('[data-testid="settings-panel"]').text()).toContain('New terminal');
    expect(wrapper.get('[data-testid="settings-panel"]').text()).toContain('Ctrl T');

    await wrapper.get('[data-section="ai"]').trigger('click');
    expect(wrapper.get('[data-testid="settings-ai-provider"]').text()).toContain('Not configured');
    expect(wrapper.get('[data-testid="settings-ai-policy"]').text()).toContain('Ask every time');
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

  it('creates and opens an SSH connection from the connections section', async () => {
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-section="connections"]').trigger('click');
    await wrapper.get('[data-testid="add-connection"]').trigger('click');
    expect(wrapper.get('.app-dialog-layer').attributes('style')).toContain(
      '--app-dialog-width: 680px',
    );
    expect(wrapper.get('.connection-dialog-form').exists()).toBe(true);
    await wrapper.get('[data-testid="connection-name"]').setValue('Production');
    await wrapper.get('[data-testid="connection-host"]').setValue('prod.example.com');
    await wrapper.get('[data-testid="connection-user"]').setValue('deploy');
    await wrapper.get('[data-testid="connection-port"]').setValue(2222);
    await wrapper.get('[data-testid="save-connection"]').trigger('click');
    await wrapper.findAll('.settings-connection-main').at(-1)?.trigger('click');

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

  it('applies appearance controls to runtime theme and window opacity', async () => {
    const opacitySpy = vi.spyOn(settingsClient, 'setWindowOpacity').mockResolvedValue();
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-section="appearance"]').trigger('click');
    await wrapper.findAll('.settings-theme-inline-button').at(2)?.trigger('click');
    await wrapper.get('.connection-toggle').trigger('click');
    await wrapper.get('input[type="range"]').setValue(75);
    await wrapper.findAll('input[type="range"]').at(1)?.setValue(18);
    await wrapper.findAll('input[type="color"]').at(0)?.setValue('#123456');

    expect(document.documentElement.dataset.themeMode).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--color-canvas')).toBe('#f4f6f8');
    expect(document.documentElement.style.getPropertyValue('--theme-terminal-fg')).toBe('#123456');
    expect(document.documentElement.style.getPropertyValue('--app-layer-blur')).toBe('18px');
    expect(opacitySpy).toHaveBeenLastCalledWith(0.75);
  });

  it('uses neutral black and gray surfaces for the dark theme', async () => {
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-section="appearance"]').trigger('click');
    await wrapper.findAll('.settings-theme-inline-button').at(1)?.trigger('click');

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

    expect((wrapper.get('[data-testid="settings-ai-base-url"]').element as HTMLInputElement).value).toBe(
      'https://api.openai.com/v1',
    );
    await wrapper.get('[data-testid="settings-ai-base-url"]').setValue('');
    expect((wrapper.get('[data-testid="settings-ai-base-url"]').element as HTMLInputElement).value).toBe(
      '',
    );
    await wrapper.get('[data-testid="settings-ai-base-url"]').setValue('https://openai-proxy.example/v1');
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
