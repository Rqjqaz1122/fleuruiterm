import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setLocale } from '@/i18n/locale';
import { settingsClient } from '@/services/settingsClient';

import SettingsView from './SettingsView.vue';

describe('SettingsView', () => {
  beforeEach(() => {
    localStorage.clear();
    setLocale('en-US');
    document.documentElement.removeAttribute('style');
    vi.restoreAllMocks();
  });

  it('uses the FleurUI settings sections', () => {
    const wrapper = mount(SettingsView);

    expect(wrapper.get('.settings-nav').text()).toContain('General');
    expect(wrapper.get('.settings-nav').text()).toContain('Connections');
    expect(wrapper.get('.settings-nav').text()).toContain('Appearance');
    expect(wrapper.get('.settings-nav').text()).toContain('Advanced');
  });

  it('switches the application language from the general section', async () => {
    const wrapper = mount(SettingsView);

    await wrapper.get('.settings-locale-toggle button:nth-child(2)').trigger('click');

    expect(localStorage.getItem('fleurterm.locale')).toBe('zh-CN');
    expect(wrapper.get('.settings-value-pill').text()).toBe('简体中文');
    expect(wrapper.get('.settings-nav').text()).toContain('通用');
    expect(wrapper.get('.settings-sidebar-copy').text()).toContain('设置');
  });

  it('creates and opens an SSH connection from the connections section', async () => {
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-section="connections"]').trigger('click');
    await wrapper.get('[data-testid="add-connection"]').trigger('click');
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
