import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import StartPage from './StartPage.vue';

describe('StartPage', () => {
  it('shows the approved FleurTerm start actions without development labels', () => {
    const wrapper = mount(StartPage, { props: { pending: false } });

    expect(wrapper.get('h1').text()).toBe('FleurTerm');
    expect(wrapper.text()).toContain('Profiles & connections');
    expect(wrapper.text()).toContain('New terminal');
    expect(wrapper.text()).toContain('Recent connections');
    expect(wrapper.text()).toContain('Settings');
    expect(wrapper.text()).not.toContain('Coming soon');
  });

  it('emits only the implemented start-page actions', async () => {
    const wrapper = mount(StartPage, { props: { pending: false } });

    await wrapper.get('[data-testid="start-new-terminal"]').trigger('click');
    await wrapper.get('[data-testid="start-settings"]').trigger('click');

    expect(wrapper.emitted('createTerminal')).toEqual([[]]);
    expect(wrapper.emitted('openSettings')).toEqual([[]]);
    expect(wrapper.get('[data-testid="profiles-entry"]').attributes('aria-disabled')).toBe('true');
    expect(wrapper.get('[data-testid="recent-entry"]').attributes('aria-disabled')).toBe('true');
  });

  it('disables terminal creation while a terminal action is pending', () => {
    const wrapper = mount(StartPage, { props: { pending: true } });

    expect(wrapper.get('[data-testid="start-new-terminal"]').attributes()).toHaveProperty(
      'disabled',
    );
  });
});
