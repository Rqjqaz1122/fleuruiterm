import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import appLogoUrl from '../../src-tauri/icons/app-icon-source.png';
import StartPage from './StartPage.vue';

describe('StartPage', () => {
  it('shows the FleurTerm brand with the project logo and supplied version', () => {
    const wrapper = mount(StartPage, { props: { pending: false, version: '0.0.6' } });

    expect(wrapper.get('[data-testid="start-logo"]').attributes('src')).toBe(appLogoUrl);
    expect(wrapper.get('[data-testid="start-logo"]').attributes('alt')).toBe('FleurTerm');
    expect(wrapper.get('h1').text()).toBe('FleurTerm');
    expect(wrapper.get('[data-testid="start-version"]').text()).toBe('v0.0.6');
  });

  it('matches the reference action order in a compact vertical menu', () => {
    const wrapper = mount(StartPage, { props: { pending: false } });
    const actionTestIds = wrapper
      .findAll('.start-menu-action')
      .map((action) => action.attributes('data-testid'));

    expect(actionTestIds).toEqual([
      'start-new-terminal',
      'profiles-entry',
      'recent-entry',
      'start-settings',
    ]);
  });

  it('removes the previous prompt and numbered command presentation', () => {
    const wrapper = mount(StartPage, { props: { pending: false } });

    expect(wrapper.get('.start-menu').exists()).toBe(true);
    expect(wrapper.find('.start-prompt').exists()).toBe(false);
    expect(wrapper.find('.start-command-list').exists()).toBe(false);
    expect(wrapper.find('.start-launchpad').exists()).toBe(false);
  });

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
    await wrapper.get('[data-testid="profiles-entry"]').trigger('click');
    await wrapper.get('[data-testid="recent-entry"]').trigger('click');
    await wrapper.get('[data-testid="start-settings"]').trigger('click');

    expect(wrapper.emitted('createTerminal')).toEqual([[]]);
    expect(wrapper.emitted('openSettings')).toEqual([[], [], []]);
    expect(wrapper.get('[data-testid="profiles-entry"]').attributes('type')).toBe('button');
    expect(wrapper.get('[data-testid="recent-entry"]').attributes('type')).toBe('button');
  });

  it('disables terminal creation while a terminal action is pending', () => {
    const wrapper = mount(StartPage, { props: { pending: true } });

    expect(wrapper.get('[data-testid="start-new-terminal"]').attributes()).toHaveProperty(
      'disabled',
    );
  });
});
