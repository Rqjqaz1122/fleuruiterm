import { beforeEach, describe, expect, it, vi } from 'vitest';

import { contextMenu, type ContextMenuEntry } from './contextMenu';

describe('contextMenu', () => {
  beforeEach(() => {
    contextMenu.close();
  });

  it('opens one menu request at explicit viewport coordinates', () => {
    const invoker = document.createElement('button');
    document.body.append(invoker);
    invoker.focus();
    const entries: ContextMenuEntry[] = [
      { kind: 'action', id: 'copy', label: 'Copy', run: vi.fn() },
    ];

    contextMenu.openAt({ x: 20, y: 30 }, entries);

    expect(contextMenu.state.value).toEqual({ x: 20, y: 30, entries, invoker });
    invoker.remove();
  });

  it('replaces the active request when another menu opens', () => {
    const firstEntries: ContextMenuEntry[] = [
      { kind: 'action', id: 'copy', label: 'Copy', run: vi.fn() },
    ];
    const secondEntries: ContextMenuEntry[] = [{ kind: 'separator', id: 'separator' }];
    contextMenu.openAt({ x: 20, y: 30 }, firstEntries);

    contextMenu.openAt({ x: 40, y: 50 }, secondEntries);

    expect(contextMenu.state.value).toMatchObject({ x: 40, y: 50, entries: secondEntries });
  });

  it('preserves the original invoker when coordinates replace an open request', () => {
    const invoker = document.createElement('button');
    const menuAction = document.createElement('button');
    document.body.append(invoker, menuAction);
    invoker.focus();
    contextMenu.openAt({ x: 20, y: 30 }, [
      { kind: 'action', id: 'first', label: 'First', run: vi.fn() },
    ]);
    menuAction.focus();

    contextMenu.openAt({ x: 40, y: 50 }, [
      { kind: 'action', id: 'second', label: 'Second', run: vi.fn() },
    ]);

    expect(contextMenu.state.value?.invoker).toBe(invoker);
    invoker.remove();
    menuAction.remove();
  });

  it('uses event coordinates and prevents the browser context menu', () => {
    const entries: ContextMenuEntry[] = [
      { kind: 'action', id: 'paste', label: 'Paste', run: vi.fn() },
    ];
    const invoker = document.createElement('button');
    document.body.append(invoker);
    let event: MouseEvent | null = null;
    invoker.addEventListener('contextmenu', (contextMenuEvent) => {
      event = contextMenuEvent;
      contextMenu.openAt(contextMenuEvent, entries);
    });

    invoker.dispatchEvent(
      new MouseEvent('contextmenu', {
        clientX: 60,
        clientY: 70,
        cancelable: true,
      }),
    );

    expect(event?.defaultPrevented).toBe(true);
    expect(contextMenu.state.value).toEqual({ x: 60, y: 70, entries, invoker });
    invoker.remove();
  });

  it('uses the focusable ancestor of a nested event target as the invoker', () => {
    const activeInput = document.createElement('input');
    const button = document.createElement('button');
    const label = document.createElement('span');
    button.append(label);
    document.body.append(activeInput, button);
    activeInput.focus();
    button.addEventListener('contextmenu', (event) => {
      contextMenu.openAt(event, [{ kind: 'action', id: 'copy', label: 'Copy', run: vi.fn() }]);
    });

    label.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    expect(contextMenu.state.value?.invoker).toBe(button);
    activeInput.remove();
    button.remove();
  });

  it('uses the focusable ancestor of a nested SVG path as the invoker', () => {
    const activeInput = document.createElement('input');
    const button = document.createElement('button');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    icon.append(path);
    button.append(icon);
    document.body.append(activeInput, button);
    activeInput.focus();
    button.addEventListener('contextmenu', (event) => {
      contextMenu.openAt(event, [{ kind: 'action', id: 'copy', label: 'Copy', run: vi.fn() }]);
    });

    path.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    expect(contextMenu.state.value?.invoker).toBe(button);
    activeInput.remove();
    button.remove();
  });

  it('keeps the active element when the event target is not focusable', () => {
    const activeInput = document.createElement('input');
    const row = document.createElement('div');
    document.body.append(activeInput, row);
    activeInput.focus();
    row.addEventListener('contextmenu', (event) => {
      contextMenu.openAt(event, [{ kind: 'action', id: 'copy', label: 'Copy', run: vi.fn() }]);
    });

    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    expect(contextMenu.state.value?.invoker).toBe(activeInput);
    activeInput.remove();
    row.remove();
  });

  it('closes the active menu request', () => {
    contextMenu.openAt({ x: 20, y: 30 }, [
      { kind: 'action', id: 'copy', label: 'Copy', run: vi.fn() },
    ]);

    contextMenu.close();

    expect(contextMenu.state.value).toBeNull();
  });
});
