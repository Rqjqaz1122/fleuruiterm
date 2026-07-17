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

  it('emits close from the back action', async () => {
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-testid="close-settings"]').trigger('click');

    expect(wrapper.emitted('close')).toEqual([[]]);
  });
});
