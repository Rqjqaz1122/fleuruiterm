import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AppSelect from './AppSelect.vue';

const options = [
  { value: 'ssh', label: 'SSH' },
  { value: 'telnet', label: 'Telnet' },
  { value: 'local', label: 'Local' },
];

describe('AppSelect', () => {
  it('opens a custom listbox without rendering a native select', async () => {
    const wrapper = mount(AppSelect, {
      props: {
        modelValue: 'ssh',
        options,
        ariaLabel: 'Method',
        testId: 'connection-method',
      },
    });

    expect(wrapper.find('select').exists()).toBe(false);

    await wrapper.get('[data-testid="connection-method"]').trigger('click');

    expect(wrapper.get('[role="listbox"]').text()).toContain('Telnet');
    expect(wrapper.get('[data-value="ssh"]').attributes('aria-selected')).toBe('true');
  });

  it('emits the selected value and closes the menu', async () => {
    const wrapper = mount(AppSelect, {
      props: {
        modelValue: 'ssh',
        options,
        ariaLabel: 'Method',
      },
    });

    await wrapper.get('.app-select-button').trigger('click');
    await wrapper.get('[data-value="local"]').trigger('click');

    expect(wrapper.emitted('update:modelValue')).toEqual([['local']]);
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
  });
});
