import { describe, expect, it } from 'vitest';

import {
  WorkspaceError,
  activateTab,
  addTab,
  closePane,
  closeTab,
  createWorkspace,
  focusPane,
  splitPane,
  type IdGenerator,
} from './workspace';

function ids(...values: string[]): IdGenerator {
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) {
      throw new Error('test ID generator exhausted');
    }
    index += 1;
    return value;
  };
}

describe('workspace domain', () => {
  it('creates a workspace focused on its first terminal', () => {
    const workspace = createWorkspace('session-a', ids('tab-1', 'pane-1'));

    expect(workspace.activeTabId).toBe('tab-1');
    expect(workspace.focusedPaneId).toBe('pane-1');
    expect(workspace.focusedSessionId).toBe('session-a');
  });

  it('splits the focused pane horizontally with a new session', () => {
    const workspace = createWorkspace('session-a', ids('tab-1', 'pane-1'));

    const updated = splitPane(
      workspace,
      workspace.focusedPaneId,
      'horizontal',
      'session-b',
      ids('split-1', 'pane-2'),
    );

    expect(updated.tabs[0]?.root).toMatchObject({
      kind: 'split',
      direction: 'horizontal',
    });
    expect(updated.focusedPaneId).toBe('pane-2');
    expect(updated.focusedSessionId).toBe('session-b');
  });

  it('collapses a split after its focused pane closes', () => {
    const workspace = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    const split = splitPane(workspace, 'pane-1', 'vertical', 'session-b', ids('split-1', 'pane-2'));

    const updated = closePane(split, 'pane-2');

    expect(updated.tabs[0]?.root).toEqual({
      kind: 'pane',
      id: 'pane-1',
      sessionId: 'session-a',
    });
    expect(updated.focusedSessionId).toBe('session-a');
  });

  it('removes the final tab after its only pane closes', () => {
    const workspace = createWorkspace('session-a', ids('tab-1', 'pane-1'));

    const updated = closePane(workspace, 'pane-1');

    expect(updated.tabs).toEqual([]);
    expect(updated.activeTabId).toBeNull();
    expect(updated.focusedPaneId).toBeNull();
  });

  it('keeps the active tab when an inactive tab closes', () => {
    const first = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    const withSecond = addTab(first, 'session-b', ids('tab-2', 'pane-2'));
    const activeFirst = activateTab(withSecond, 'tab-1');

    const updated = closeTab(activeFirst, 'tab-2');

    expect(updated.activeTabId).toBe('tab-1');
    expect(updated.focusedSessionId).toBe('session-a');
  });

  it('rejects an unknown pane without mutating the workspace', () => {
    const workspace = createWorkspace('session-a', ids('tab-1', 'pane-1'));

    expect(() =>
      splitPane(workspace, 'missing-pane', 'vertical', 'session-b', ids('split-1', 'pane-2')),
    ).toThrow(WorkspaceError);
    expect(workspace.tabs[0]?.root).toEqual({
      kind: 'pane',
      id: 'pane-1',
      sessionId: 'session-a',
    });
  });

  it('focuses the requested pane and its owning tab', () => {
    const first = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    const workspace = addTab(first, 'session-b', ids('tab-2', 'pane-2'));

    const updated = focusPane(workspace, 'pane-1');

    expect(updated.activeTabId).toBe('tab-1');
    expect(updated.focusedPaneId).toBe('pane-1');
    expect(updated.focusedSessionId).toBe('session-a');
  });
});
