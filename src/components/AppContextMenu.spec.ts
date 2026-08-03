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

  it('bounds an oversized menu to the padded viewport and enables scrolling', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 140,
      height: 130,
      top: 0,
      right: 140,
      bottom: 130,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    });
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(100);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(100);
    mount(AppContextMenu);

    await openMenu([{ kind: 'action', id: 'copy', label: 'Copy', run: vi.fn() }]);

    expect(getMenu().style.maxWidth).toBe('84px');
    expect(getMenu().style.maxHeight).toBe('84px');
    expect(getMenu().style.overflow).toBe('auto');
    expect(getMenu().style.left).toBe('8px');
    expect(getMenu().style.top).toBe('8px');
  });

  it('focuses the first enabled action and skips disabled actions during keyboard navigation', async () => {
    mount(AppContextMenu);
    await openMenu([
      { kind: 'action', id: 'disabled', label: 'Disabled', disabled: true, run: vi.fn() },
      { kind: 'separator', id: 'separator' },
      { kind: 'action', id: 'first', label: 'First', run: vi.fn() },
      { kind: 'action', id: 'second', label: 'Second', run: vi.fn() },
    ]);
    const menu = getMenu();

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

  it.each(['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'])(
    'stops propagation for the handled %s key',
    async (key) => {
      const windowKeyDown = vi.fn();
      window.addEventListener('keydown', windowKeyDown);
      mount(AppContextMenu);
      await openMenu([{ kind: 'action', id: 'copy', label: 'Copy', run: vi.fn() }]);

      pressKey(getAction('copy'), key);

      expect(windowKeyDown).not.toHaveBeenCalled();
      window.removeEventListener('keydown', windowKeyDown);
    },
  );

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

  it.each(['click', 'keyboard'])('contains a rejected asynchronous %s action', async (trigger) => {
    const actionError = new Error('Action failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const run = vi.fn(async () => {
      throw actionError;
    });
    mount(AppContextMenu);
    await openMenu([{ kind: 'action', id: 'copy', label: 'Copy', run }]);

    if (trigger === 'click') {
      getAction('copy').click();
    } else {
      pressKey(getAction('copy'), 'Enter');
    }

    expect(contextMenu.state.value).toBeNull();
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith('Context menu action failed: copy', actionError),
    );
  });

  it('closes on Escape and restores focus to the invoking element', async () => {
    const invoker = document.createElement('button');
    document.body.append(invoker);
    invoker.focus();
    mount(AppContextMenu);
    await openMenu([{ kind: 'action', id: 'copy', label: 'Copy', run: vi.fn() }]);

    pressKey(getMenu(), 'Escape');
    await nextTick();

    expect(contextMenu.state.value).toBeNull();
    expect(document.activeElement).toBe(invoker);
    invoker.remove();
  });

  it('restores focus to the latest invoker after replacing an open request', async () => {
    const firstInvoker = document.createElement('button');
    const secondInvoker = document.createElement('button');
    document.body.append(firstInvoker, secondInvoker);
    firstInvoker.focus();
    mount(AppContextMenu);
    await openMenu([{ kind: 'action', id: 'first', label: 'First', run: vi.fn() }]);
    secondInvoker.addEventListener('contextmenu', (event) => {
      contextMenu.openAt(event, [{ kind: 'action', id: 'second', label: 'Second', run: vi.fn() }]);
    });

    secondInvoker.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await flushMenuRender();
    pressKey(getAction('second'), 'Escape');
    await nextTick();

    expect(document.activeElement).toBe(secondInvoker);
    firstInvoker.remove();
    secondInvoker.remove();
  });

  it('restores a terminal textarea after a non-focusable render node opens the menu', async () => {
    const terminalTextarea = document.createElement('textarea');
    terminalTextarea.className = 'xterm-helper-textarea';
    const terminalScreen = document.createElement('div');
    terminalScreen.className = 'xterm-screen';
    document.body.append(terminalTextarea, terminalScreen);
    mount(AppContextMenu);
    terminalTextarea.focus();
    terminalScreen.addEventListener('contextmenu', (event) => {
      contextMenu.openAt(event, [{ kind: 'action', id: 'copy', label: 'Copy', run: vi.fn() }]);
    });

    terminalScreen.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    await flushMenuRender();
    pressKey(getAction('copy'), 'Escape');
    await nextTick();

    expect(document.activeElement).toBe(terminalTextarea);
    terminalTextarea.remove();
    terminalScreen.remove();
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

  it('positions and focuses a request that exists before the renderer mounts', async () => {
    const invoker = document.createElement('button');
    document.body.append(invoker);
    invoker.focus();
    contextMenu.openAt({ x: 20, y: 30 }, [
      { kind: 'action', id: 'copy', label: 'Copy', run: vi.fn() },
    ]);

    mount(AppContextMenu);
    await flushMenuRender();

    expect(getMenu().style.left).toBe('20px');
    expect(getMenu().style.top).toBe('30px');
    expect(document.activeElement).toBe(getAction('copy'));
    invoker.remove();
  });

  it('removes global listeners before a renderer is remounted', async () => {
    const firstWrapper = mount(AppContextMenu);
    firstWrapper.unmount();
    mount(AppContextMenu);
    await openMenu([{ kind: 'action', id: 'copy', label: 'Copy', run: vi.fn() }]);
    const close = vi.spyOn(contextMenu, 'close');

    window.dispatchEvent(new Event('resize'));

    expect(close).toHaveBeenCalledOnce();
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
