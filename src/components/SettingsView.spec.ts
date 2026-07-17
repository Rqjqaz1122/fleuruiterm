import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SettingsView from './SettingsView.vue';

describe('SettingsView', () => {
  it('shows all approved settings sections', () => {
    const wrapper = mount(SettingsView);

    for (const label of [
      'General',
      'Appearance',
      'Terminal',
      'Profiles & connections',
      'Hotkeys',
      'AI',
    ]) {
      expect(wrapper.get('[aria-label="Settings sections"]').text()).toContain(label);
    }
  });

  it('switches the presentation panel without persisting settings', async () => {
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-section="appearance"]').trigger('click');

    expect(wrapper.get('[data-testid="settings-panel"]').text()).toContain('Window opacity');
    expect(wrapper.get('[data-testid="opacity-value"]').text()).toBe('100%');
    expect(wrapper.get('input[type="range"]').attributes()).toHaveProperty('disabled');
  });

  it('shows Tabby scroll defaults without a page-level back action', async () => {
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-section="terminal"]').trigger('click');

    const settingsPanel = wrapper.get('[data-testid="settings-panel"]');
    expect(settingsPanel.text()).toContain('Scrollback');
    expect(settingsPanel.get('[data-testid="scrollback-lines"]').attributes('value')).toBe('25000');
    expect(settingsPanel.text()).toContain('Scroll on input');
    expect(settingsPanel.get('[data-testid="scroll-on-input"]').attributes()).toHaveProperty(
      'checked',
    );
    expect(wrapper.find('[data-testid="close-settings"]').exists()).toBe(false);
  });

  it('switches the application language between English and Chinese', async () => {
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-testid="language-select"]').setValue('zh-CN');

    expect(wrapper.get('[aria-label="设置分类"]').text()).toContain('常规');
    expect(wrapper.get('[data-testid="settings-panel"]').text()).toContain('语言');
    expect(localStorage.getItem('fleurterm.locale')).toBe('zh-CN');
  });
});
