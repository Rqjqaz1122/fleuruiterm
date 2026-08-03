import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { contextMenu, type ContextMenuActionEntry } from '@/services/contextMenu';

import TerminalTabs from './TerminalTabs.vue';

const coreApi = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined),
}));

const windowApi = vi.hoisted(() => ({
  startDragging: vi.fn(async () => undefined),
}));

vi.mock('@tauri-apps/api/core', () => coreApi);

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => windowApi,
}));

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
  beforeEach(() => {
    vi.clearAllMocks();
    contextMenu.close();
  });

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

  it('activates a tab on pointer release when no drag occurred', async () => {
    const wrapper = mount(TerminalTabs, { props: { tabs, activeTabId: 'tab-1' } });
    const settingsTab = wrapper.get('[data-tab-id="app-settings"]');

    await settingsTab.trigger('pointerdown', {
      button: 0,
      clientX: 80,
      pointerId: 1,
    });
    await settingsTab.trigger('pointerup', {
      clientX: 80,
      pointerId: 1,
    });

    expect(wrapper.emitted('activate')).toEqual([['app-settings']]);
  });

  it('uses a settings icon instead of a terminal status dot for settings', () => {
    const wrapper = mount(TerminalTabs, { props: { tabs, activeTabId: 'app-settings' } });

    expect(wrapper.find('[data-tab-id="tab-1"] .status-dot').exists()).toBe(true);
    expect(wrapper.find('[data-tab-id="app-settings"] .status-dot').exists()).toBe(false);
    expect(wrapper.get('[data-tab-id="app-settings"] .settings-tab-icon').exists()).toBe(true);
  });

  it('places new-terminal, AI and settings actions in the top tab row', () => {
    const wrapper = mount(TerminalTabs, {
      props: { tabs: [], activeTabId: null, platform: 'windows' },
    });

    expect(wrapper.get('.terminal-tabs').attributes()).not.toHaveProperty('data-tauri-drag-region');
    expect(wrapper.get('.tabbar-actions').exists()).toBe(true);
    expect(wrapper.get('.tabbar-drag-region').attributes()).not.toHaveProperty(
      'data-tauri-drag-region',
    );
    expect(wrapper.get('.window-controls').exists()).toBe(true);
    expect(wrapper.get('[aria-label="Open AI panel"]').classes()).toContain('tabbar-ai');
    expect(wrapper.get('[aria-label="Open settings"]').classes()).toContain('tabbar-settings');
    expect(wrapper.text()).not.toContain('Recent connections');
  });

  it('drags and maximizes the frameless window from non-interactive tabbar space', async () => {
    const wrapper = mount(TerminalTabs, {
      props: { tabs: [], activeTabId: null, platform: 'windows' },
    });

    await wrapper.get('.tabbar-drag-region').trigger('pointerdown', { button: 0 });
    await wrapper.get('.tabbar-drag-region').trigger('dblclick', { button: 0 });

    expect(windowApi.startDragging).toHaveBeenCalledOnce();
    expect(coreApi.invoke).toHaveBeenCalledWith('toggle_window_zoom');
  });

  it('uses custom window controls for the frameless window', async () => {
    const wrapper = mount(TerminalTabs, {
      props: { tabs: [], activeTabId: null, platform: 'windows' },
    });

    await wrapper.get('[aria-label="Minimize window"]').trigger('click');
    await wrapper.get('[aria-label="Maximize window"]').trigger('click');
    await wrapper.get('[aria-label="Close window"]').trigger('click');

    expect(coreApi.invoke).toHaveBeenCalledWith('minimize_window');
    expect(coreApi.invoke).toHaveBeenCalledWith('toggle_window_zoom');
    expect(coreApi.invoke).toHaveBeenCalledWith('close_window');
  });

  it('keeps window controls out of the drag and double-click maximize regions', async () => {
    const wrapper = mount(TerminalTabs, {
      props: { tabs: [], activeTabId: null, platform: 'windows' },
    });

    await wrapper.get('.window-controls').trigger('pointerdown', { button: 0 });
    await wrapper.get('.window-controls').trigger('dblclick', { button: 0 });

    expect(windowApi.startDragging).not.toHaveBeenCalled();
    expect(coreApi.invoke).not.toHaveBeenCalled();
  });

  it('uses custom dragging and zoom on macOS to avoid native frame scaling', async () => {
    const wrapper = mount(TerminalTabs, {
      props: { tabs: [], activeTabId: null, platform: 'macos' },
    });

    expect(wrapper.find('.window-controls').exists()).toBe(false);
    expect(wrapper.get('.macos-window-control-space').attributes()).not.toHaveProperty(
      'data-tauri-drag-region',
    );
    expect(wrapper.get('.tabbar-drag-region').attributes()).not.toHaveProperty(
      'data-tauri-drag-region',
    );

    await wrapper.get('.tabbar-drag-region').trigger('pointerdown', { button: 0 });
    await wrapper.get('.tabbar-drag-region').trigger('dblclick', { button: 0 });

    expect(windowApi.startDragging).toHaveBeenCalledOnce();
    expect(coreApi.invoke).toHaveBeenCalledWith('toggle_window_zoom');
  });

  it('does not zoom when double-clicking an interactive tab control', async () => {
    const wrapper = mount(TerminalTabs, {
      props: { tabs, activeTabId: 'tab-1', platform: 'macos' },
    });

    await wrapper.get('[data-tab-id="tab-1"] .tab-button').trigger('dblclick', { button: 0 });

    expect(coreApi.invoke).not.toHaveBeenCalled();
  });

  it('emits the selected application action', async () => {
    const wrapper = mount(TerminalTabs, { props: { tabs, activeTabId: 'app-settings' } });

    await wrapper.get('[aria-label="Close Settings"]').trigger('click');
    await wrapper.get('[aria-label="Open AI panel"]').trigger('click');
    await wrapper.get('[aria-label="Open settings"]').trigger('click');

    expect(wrapper.emitted('close')).toEqual([['app-settings']]);
    expect(wrapper.emitted('openAI')).toEqual([[]]);
    expect(wrapper.emitted('openSettings')).toEqual([[]]);
  });

  it('opens tab actions for the right-clicked tab instead of the active tab', async () => {
    const wrapper = mount(TerminalTabs, { props: { tabs, activeTabId: 'tab-1' } });
    const settingsTab = wrapper.get('[data-tab-id="app-settings"]');

    await settingsTab.trigger('pointerdown', { button: 2, pointerId: 1 });
    await settingsTab.trigger('contextmenu');

    expect(contextMenu.state.value?.entries.map((entry) => entry.id)).toEqual([
      'new-terminal',
      'tab-actions-separator',
      'close-tab',
      'close-other-tabs',
    ]);
    await contextAction('close-tab').run();
    await contextAction('close-other-tabs').run();

    expect(wrapper.emitted('close')).toEqual([['app-settings']]);
    expect(wrapper.emitted('closeOtherTabs')).toEqual([['app-settings']]);
    expect(wrapper.emitted('activate')).toBeUndefined();
    expect(windowApi.startDragging).not.toHaveBeenCalled();
  });

  it('opens only the new-terminal action from blank tab-bar space', async () => {
    const wrapper = mount(TerminalTabs, { props: { tabs, activeTabId: 'tab-1' } });

    await wrapper.get('.tabbar-drag-region').trigger('contextmenu');

    expect(contextMenu.state.value?.entries.map((entry) => entry.id)).toEqual(['new-terminal']);
    await contextAction('new-terminal').run();
    expect(wrapper.emitted('newTerminal')).toEqual([[]]);
  });

  it('disables closing other tabs when the right-clicked tab is the only tab', async () => {
    const wrapper = mount(TerminalTabs, {
      props: { tabs: [tabs[0]!], activeTabId: 'tab-1' },
    });

    await wrapper.get('[data-tab-id="tab-1"]').trigger('contextmenu');

    expect(contextAction('close-other-tabs').disabled).toBe(true);
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

    expect(tabItems[0]?.attributes('draggable')).toBe('false');
    expect(dataTransfer.setData).toHaveBeenCalledWith('application/x-fleurterm-tab', 'tab-1');
    expect(wrapper.emitted('reorder')).toEqual([['tab-1', 'app-settings', 'before']]);
  });

  it('reorders tabs with pointer movement for desktop webviews', async () => {
    const wrapper = mount(TerminalTabs, { props: { tabs, activeTabId: 'tab-1' } });
    const tabItems = wrapper.findAll<HTMLElement>('.tab-item');
    vi.spyOn(tabItems[0]!.element, 'getBoundingClientRect').mockReturnValue(rect(0, 150));
    vi.spyOn(tabItems[1]!.element, 'getBoundingClientRect').mockReturnValue(rect(150, 150));

    await tabItems[0]?.trigger('pointerdown', {
      button: 0,
      clientX: 20,
      pointerId: 1,
    });
    await tabItems[0]?.trigger('pointermove', {
      clientX: 160,
      pointerId: 1,
    });
    await tabItems[0]?.trigger('pointerup', {
      clientX: 160,
      pointerId: 1,
    });

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

function contextAction(id: string): ContextMenuActionEntry {
  const entry = contextMenu.state.value?.entries.find((candidate) => candidate.id === id);
  if (entry?.kind !== 'action') {
    throw new Error(`Expected context-menu action: ${id}`);
  }
  return entry;
}

function rect(left: number, width: number): DOMRect {
  return {
    left,
    width,
    right: left + width,
    top: 0,
    bottom: 38,
    height: 38,
    x: left,
    y: 0,
    toJSON: () => ({}),
  };
}
