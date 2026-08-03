import { beforeEach, describe, expect, it, vi } from 'vitest';

import { contextMenu, type ContextMenuEntry } from './contextMenu';

describe('contextMenu', () => {
  beforeEach(() => {
    contextMenu.close();
  });

  it('opens one menu request at explicit viewport coordinates', () => {
    const entries: ContextMenuEntry[] = [
      { kind: 'action', id: 'copy', label: 'Copy', run: vi.fn() },
    ];

    contextMenu.openAt({ x: 20, y: 30 }, entries);

    expect(contextMenu.state.value).toEqual({ x: 20, y: 30, entries });
  });

  it('replaces the active request when another menu opens', () => {
    const firstEntries: ContextMenuEntry[] = [
      { kind: 'action', id: 'copy', label: 'Copy', run: vi.fn() },
    ];
    const secondEntries: ContextMenuEntry[] = [{ kind: 'separator', id: 'separator' }];
    contextMenu.openAt({ x: 20, y: 30 }, firstEntries);

    contextMenu.openAt({ x: 40, y: 50 }, secondEntries);

    expect(contextMenu.state.value).toEqual({ x: 40, y: 50, entries: secondEntries });
  });

  it('uses event coordinates and prevents the browser context menu', () => {
    const entries: ContextMenuEntry[] = [
      { kind: 'action', id: 'paste', label: 'Paste', run: vi.fn() },
    ];
    const event = new MouseEvent('contextmenu', {
      clientX: 60,
      clientY: 70,
      cancelable: true,
    });
    const preventDefault = vi.spyOn(event, 'preventDefault');

    contextMenu.openAt(event, entries);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(contextMenu.state.value).toEqual({ x: 60, y: 70, entries });
  });

  it('closes the active menu request', () => {
    contextMenu.openAt({ x: 20, y: 30 }, [
      { kind: 'action', id: 'copy', label: 'Copy', run: vi.fn() },
    ]);

    contextMenu.close();

    expect(contextMenu.state.value).toBeNull();
  });
});
