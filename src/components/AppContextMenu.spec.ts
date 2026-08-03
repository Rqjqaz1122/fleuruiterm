import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import { contextMenu, type ContextMenuEntry } from '@/services/contextMenu';

import AppContextMenu from './AppContextMenu.vue';

enableAutoUnmount(afterEach);

describe('AppContextMenu', () => {
  beforeEach(() => {
    contextMenu.close();
  });

  afterEach(() => {
    contextMenu.close();
    vi.restoreAllMocks();
  });

  it('teleports accessible actions and separators to the document body', async () => {
    mount(AppContextMenu);

    await openMenu([
      { kind: 'action', id: 'copy', label: 'Copy', run: vi.fn() },
      { kind: 'separator', id: 'separator' },
      { kind: 'action', id: 'delete', label: 'Delete', danger: true, run: vi.fn() },
    ]);

    const menu = getMenu();
    expect(menu.parentElement).toBe(document.body);
    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
    expect(menu.querySelector('[role="separator"]')).not.toBeNull();
    expect(menu.querySelector('[data-context-action="delete"]')?.classList).toContain('danger');
  });

  it('clamps the rendered menu inside the viewport', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 40,
      height: 30,
      top: 0,
      right: 40,
      bottom: 30,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    });
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(100);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(100);
    mount(AppContextMenu);

    contextMenu.openAt({ x: 95, y: 95 }, [
      { kind: 'action', id: 'copy', label: 'Copy', run: vi.fn() },
    ]);
    await flushMenuRender();

    expect(getMenu().style.left).toBe('52px');
    expect(getMenu().style.top).toBe('62px');
  });

  it('skips disabled actions while navigating with arrow, Home, and End keys', async () => {
    mount(AppContextMenu);
    await openMenu([
      { kind: 'action', id: 'disabled', label: 'Disabled', disabled: true, run: vi.fn() },
      { kind: 'separator', id: 'separator' },
      { kind: 'action', id: 'first', label: 'First', run: vi.fn() },
      { kind: 'action', id: 'second', label: 'Second', run: vi.fn() },
    ]);
    const menu = getMenu();

    pressKey(menu, 'ArrowDown');
    expect(document.activeElement).toBe(getAction('first'));

    pressKey(menu, 'ArrowDown');
    expect(document.activeElement).toBe(getAction('second'));

    pressKey(menu, 'ArrowDown');
    expect(document.activeElement).toBe(getAction('first'));

    pressKey(menu, 'ArrowUp');
    expect(document.activeElement).toBe(getAction('second'));

    pressKey(menu, 'Home');
    expect(document.activeElement).toBe(getAction('first'));

    pressKey(menu, 'End');
    expect(document.activeElement).toBe(getAction('second'));
  });

  it.each(['Enter', ' '])('runs the focused action with the %s key and closes', async (key) => {
    const run = vi.fn();
    mount(AppContextMenu);
    await openMenu([{ kind: 'action', id: 'copy', label: 'Copy', run }]);
    const menu = getMenu();
    pressKey(menu, 'ArrowDown');

    pressKey(getAction('copy'), key);
    await nextTick();

    expect(run).toHaveBeenCalledOnce();
    expect(contextMenu.state.value).toBeNull();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('does not run a disabled action', async () => {
    const run = vi.fn();
    mount(AppContextMenu);
    await openMenu([{ kind: 'action', id: 'disabled', label: 'Disabled', disabled: true, run }]);

    getAction('disabled').click();

    expect(run).not.toHaveBeenCalled();
    expect(contextMenu.state.value).not.toBeNull();
  });

  it('runs an enabled clicked action and closes', async () => {
    const run = vi.fn();
    mount(AppContextMenu);
    await openMenu([{ kind: 'action', id: 'copy', label: 'Copy', run }]);

    getAction('copy').click();
    await nextTick();

    expect(run).toHaveBeenCalledOnce();
    expect(contextMenu.state.value).toBeNull();
  });

  it('closes when Escape is pressed', async () => {
    mount(AppContextMenu);
    await openMenu([{ kind: 'action', id: 'copy', label: 'Copy', run: vi.fn() }]);

    pressKey(getMenu(), 'Escape');

    expect(contextMenu.state.value).toBeNull();
  });

  it('closes on an outside pointerdown but stays open for an inside pointerdown', async () => {
    mount(AppContextMenu);
    await openMenu([{ kind: 'action', id: 'copy', label: 'Copy', run: vi.fn() }]);

    getMenu().dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(contextMenu.state.value).not.toBeNull();

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(contextMenu.state.value).toBeNull();
  });

  it.each(['scroll', 'resize', 'blur'])('closes on window %s', async (eventName) => {
    mount(AppContextMenu);
    await openMenu([{ kind: 'action', id: 'copy', label: 'Copy', run: vi.fn() }]);

    window.dispatchEvent(new Event(eventName));

    expect(contextMenu.state.value).toBeNull();
  });
});

async function openMenu(entries: ContextMenuEntry[]): Promise<void> {
  contextMenu.openAt({ x: 20, y: 30 }, entries);
  await flushMenuRender();
}

async function flushMenuRender(): Promise<void> {
  await nextTick();
  await nextTick();
}

function getMenu(): HTMLElement {
  const menu = document.querySelector<HTMLElement>('.app-context-menu');
  if (menu === null) {
    throw new Error('Expected the context menu to be rendered');
  }
  return menu;
}

function getAction(id: string): HTMLButtonElement {
  const action = document.querySelector<HTMLButtonElement>(`[data-context-action="${id}"]`);
  if (action === null) {
    throw new Error(`Expected context menu action: ${id}`);
  }
  return action;
}

function pressKey(target: Element, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}
