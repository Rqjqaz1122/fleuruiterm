import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import TerminalTabs from './TerminalTabs.vue';

const tabs = [
  {
    id: 'tab-1',
    kind: 'terminal' as const,
    title: 'Local Terminal 1',
    panelId: 'terminal-panel-tab-1',
  },
  {
    id: 'app-settings',
    kind: 'settings' as const,
    title: 'Settings',
    panelId: 'settings-panel',
  },
];

describe('TerminalTabs', () => {
  it('uses a roving tab stop and links every app tab to its panel', () => {
    const wrapper = mount(TerminalTabs, { props: { tabs, activeTabId: 'tab-1' } });
    const tabButtons = wrapper.findAll('[role="tab"]');

    expect(tabButtons[0]?.attributes()).toMatchObject({
      id: 'app-tab-tab-1',
      tabindex: '0',
      'aria-controls': 'terminal-panel-tab-1',
    });
    expect(tabButtons[1]?.attributes()).toMatchObject({
      id: 'app-tab-app-settings',
      tabindex: '-1',
      'aria-controls': 'settings-panel',
    });
  });

  it('navigates across terminal and settings tabs with arrow keys', async () => {
    const wrapper = mount(TerminalTabs, { props: { tabs, activeTabId: 'tab-1' } });

    await wrapper.findAll('[role="tab"]')[0]?.trigger('keydown', { key: 'ArrowRight' });

    expect(wrapper.emitted('activate')).toEqual([['app-settings']]);
  });

  it('uses a settings icon instead of a terminal status dot for settings', () => {
    const wrapper = mount(TerminalTabs, { props: { tabs, activeTabId: 'app-settings' } });

    expect(wrapper.find('[data-tab-id="tab-1"] .status-dot').exists()).toBe(true);
    expect(wrapper.find('[data-tab-id="app-settings"] .status-dot').exists()).toBe(false);
    expect(wrapper.get('[data-tab-id="app-settings"] .settings-tab-icon').exists()).toBe(true);
  });

  it('places new-terminal and settings actions in the top tab row', () => {
    const wrapper = mount(TerminalTabs, { props: { tabs: [], activeTabId: null } });

    expect(wrapper.get('.terminal-tabs').attributes()).toHaveProperty('data-tauri-drag-region');
    expect(wrapper.get('[aria-label="New terminal"]').classes()).toContain('add-tab');
    expect(wrapper.get('[aria-label="Open settings"]').classes()).toContain('tabbar-settings');
  });

  it('emits the selected application action', async () => {
    const wrapper = mount(TerminalTabs, { props: { tabs, activeTabId: 'app-settings' } });

    await wrapper.get('[aria-label="Close Settings"]').trigger('click');
    await wrapper.get('[aria-label="Open settings"]').trigger('click');

    expect(wrapper.emitted('close')).toEqual([['app-settings']]);
    expect(wrapper.emitted('openSettings')).toEqual([[]]);
  });

  it('reorders draggable tabs at the indicated side of the drop target', async () => {
    const wrapper = mount(TerminalTabs, { props: { tabs, activeTabId: 'tab-1' } });
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: vi.fn(),
    };
    const tabItems = wrapper.findAll('.tab-item');

    await tabItems[0]?.trigger('dragstart', { dataTransfer });
    await tabItems[1]?.trigger('dragover', { clientX: 0, dataTransfer });
    await tabItems[1]?.trigger('drop', { clientX: 0, dataTransfer });

    expect(tabItems[0]?.attributes('draggable')).toBe('true');
    expect(wrapper.emitted('reorder')).toEqual([['tab-1', 'app-settings', 'before']]);
  });

  it('activates a terminal tab when another terminal tab is dragged over it', async () => {
    const terminalTabs = [
      tabs[0],
      {
        id: 'tab-2',
        kind: 'terminal' as const,
        title: 'Local Terminal 2',
        panelId: 'terminal-panel-tab-2',
      },
    ];
    const wrapper = mount(TerminalTabs, {
      props: { tabs: terminalTabs, activeTabId: 'tab-1' },
    });
    const dataTransfer = { effectAllowed: 'none', setData: vi.fn() };
    const tabItems = wrapper.findAll('.tab-item');

    await tabItems[0]?.trigger('dragstart', { dataTransfer });
    await tabItems[1]?.trigger('dragenter');

    expect(wrapper.emitted('dragHover')).toEqual([['tab-2']]);
  });
});
