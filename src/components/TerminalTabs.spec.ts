import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import TerminalTabs from './TerminalTabs.vue';

const tabs = [
  {
    id: 'tab-1',
    title: 'Local Terminal 1',
    root: { kind: 'pane' as const, id: 'pane-1', sessionId: 'session-1' },
  },
  {
    id: 'tab-2',
    title: 'Local Terminal 2',
    root: { kind: 'pane' as const, id: 'pane-2', sessionId: 'session-2' },
  },
];

describe('TerminalTabs', () => {
  it('uses a roving tab stop and links tabs to their panel', () => {
    const wrapper = mount(TerminalTabs, { props: { tabs, activeTabId: 'tab-1' } });
    const tabButtons = wrapper.findAll('[role="tab"]');

    expect(tabButtons[0]?.attributes()).toMatchObject({
      id: 'terminal-tab-tab-1',
      tabindex: '0',
      'aria-controls': 'terminal-panel-tab-1',
    });
    expect(tabButtons[1]?.attributes('tabindex')).toBe('-1');
  });

  it('activates the adjacent tab with arrow keys', async () => {
    const wrapper = mount(TerminalTabs, { props: { tabs, activeTabId: 'tab-1' } });

    await wrapper.findAll('[role="tab"]')[0]?.trigger('keydown', { key: 'ArrowRight' });

    expect(wrapper.emitted('activate')).toEqual([['tab-2']]);
  });

  it('keeps compact tab labels and actions accessible', () => {
    const wrapper = mount(TerminalTabs, { props: { tabs, activeTabId: 'tab-1' } });

    expect(wrapper.get('.tab-label').text()).toBe('Local Terminal 1');
    expect(wrapper.get('[aria-label="New terminal"]').classes()).toContain('add-tab');
    expect(wrapper.get('[aria-label="Close Local Terminal 1"]').classes()).toContain('tab-close');
    expect(wrapper.get('.tab-item.active').exists()).toBe(true);
  });
});
