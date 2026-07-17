import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TerminalChunk } from '@/domain/session';

import { createWorkspaceStore, type WorkspaceSessionClient } from './workspaceStore';

describe('workspace store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('opens independent local terminal tabs', async () => {
    const client = createClient();
    const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1', 'tab-2', 'pane-2'));
    const store = useStore();

    await store.openTab();
    await store.openTab();

    expect(store.workspace.tabs).toHaveLength(2);
    expect(store.workspace.activeTabId).toBe('tab-2');
    expect(client.openLocal).toHaveBeenCalledTimes(2);
  });

  it('splits the focused pane with a newly opened session', async () => {
    const client = createClient();
    const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1', 'split-1', 'pane-2'));
    const store = useStore();
    await store.openTab();

    await store.splitFocused('vertical');

    expect(store.workspace.tabs[0]?.root).toMatchObject({
      kind: 'split',
      direction: 'vertical',
    });
    expect(store.workspace.focusedSessionId).toBe('session-2');
  });

  it('splits the pane identified by the initiating toolbar', async () => {
    const client = createClient();
    const useStore = createWorkspaceStore(
      client,
      ids('tab-1', 'pane-1', 'split-1', 'pane-2', 'split-2', 'pane-3'),
    );
    const store = useStore();
    await store.openTab();
    await store.splitPaneById('pane-1', 'vertical');

    await store.splitPaneById('pane-1', 'horizontal');

    expect(store.workspace.tabs[0]?.root).toMatchObject({
      kind: 'split',
      direction: 'vertical',
      children: [
        {
          kind: 'split',
          direction: 'horizontal',
          children: [
            { kind: 'pane', id: 'pane-1', sessionId: 'session-1' },
            { kind: 'pane', id: 'pane-3', sessionId: 'session-3' },
          ],
        },
        { kind: 'pane', id: 'pane-2', sessionId: 'session-2' },
      ],
    });
  });

  it('closes the backend session before removing its pane', async () => {
    const client = createClient();
    const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1'));
    const store = useStore();
    await store.openTab();

    await store.closePane('pane-1');

    expect(client.close).toHaveBeenCalledWith('session-1');
    expect(store.workspace.tabs).toEqual([]);
  });

  it('publishes channel output to subscribers of the matching session', async () => {
    const client = createClient();
    const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1'));
    const store = useStore();
    await store.openTab();
    const listener = vi.fn();
    store.subscribeToSession('session-1', listener);
    const chunk: TerminalChunk = { sessionId: 'session-1', sequence: 1, payload: [97] };

    client.emit(chunk);

    expect(listener).toHaveBeenCalledWith(chunk);
  });

  it('preserves the earliest buffered sequence for terminal remount', async () => {
    const client = createClient();
    const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1'));
    const store = useStore();
    await store.openTab();

    client.emit({ sessionId: 'session-1', sequence: 971, payload: [97] });
    client.emit({ sessionId: 'session-1', sequence: 972, payload: [98] });

    expect(store.nextOutputSequence('session-1')).toBe(971);
  });

  it('replays bounded session history after a terminal remount', async () => {
    const client = createClient();
    const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1'));
    const store = useStore();
    await store.openTab();
    const firstListener = vi.fn();
    const unsubscribe = store.subscribeToSession('session-1', firstListener);
    const chunk: TerminalChunk = { sessionId: 'session-1', sequence: 1, payload: [97] };
    client.emit(chunk);
    unsubscribe();
    const remountedListener = vi.fn();

    store.subscribeToSession('session-1', remountedListener);

    expect(remountedListener).toHaveBeenCalledWith(chunk);
  });

  it('applies a lifecycle event that arrives before the open snapshot', async () => {
    const client = {
      openLocal: vi.fn(async (_options, _onOutput, onState) => {
        onState?.({ sessionId: 'session-1', state: 'closed' });
        return {
          sessionId: 'session-1',
          backendType: 'local' as const,
          state: 'ready' as const,
          shell: '/bin/zsh',
        };
      }),
      close: vi.fn(async () => undefined),
    } satisfies WorkspaceSessionClient;
    const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1'));
    const store = useStore();

    await store.openTab();

    expect(store.snapshots['session-1']?.state).toBe('closed');
  });

  it('waits for a mounted terminal to consume buffered output', async () => {
    const client = createClient();
    const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1'));
    const store = useStore();
    await store.openTab();
    let finishTerminalWrite: (() => void) | undefined;
    let consumed = false;

    const consumption = client.emit({
      sessionId: 'session-1',
      sequence: 1,
      payload: [97],
    });
    void consumption.then(() => {
      consumed = true;
    });
    await Promise.resolve();
    expect(consumed).toBe(false);

    store.subscribeToSession(
      'session-1',
      () =>
        new Promise<void>((resolve) => {
          finishTerminalWrite = resolve;
        }),
    );
    await Promise.resolve();
    expect(consumed).toBe(false);

    finishTerminalWrite?.();
    await consumption;
    expect(consumed).toBe(true);
  });

  it('publishes close failures without removing the pane', async () => {
    const client = createClient();
    client.close.mockRejectedValueOnce(new Error('Unable to close terminal'));
    const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1'));
    const store = useStore();
    await store.openTab();

    await expect(store.closePane('pane-1')).rejects.toThrow('Unable to close terminal');

    expect(store.errorMessage).toBe('Unable to close terminal');
    expect(store.errorCode).toBe('CLOSE_TERMINAL_FAILED');
    expect(store.workspace.tabs[0]?.root).toMatchObject({ id: 'pane-1' });
  });

  it('publishes a stable error code when a terminal cannot be opened', async () => {
    const client = createClient();
    client.openLocal.mockRejectedValueOnce(new Error('internal shell launch detail'));
    const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1'));
    const store = useStore();

    await expect(store.openTab()).rejects.toThrow('internal shell launch detail');

    expect(store.errorCode).toBe('OPEN_TERMINAL_FAILED');
    expect(store.errorMessage).toBe('internal shell launch detail');
  });

  it('removes sessions that closed before a partial tab-close failure', async () => {
    const client = createClient();
    const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1', 'split-1', 'pane-2'));
    const store = useStore();
    await store.openTab();
    await store.splitPaneById('pane-1', 'vertical');
    client.close
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Unable to close second terminal'));

    await expect(store.closeTab('tab-1')).rejects.toThrow('Unable to close second terminal');

    expect(store.workspace.tabs[0]?.root).toEqual({
      kind: 'pane',
      id: 'pane-2',
      sessionId: 'session-2',
    });
    expect(store.snapshots['session-1']).toBeUndefined();
    expect(store.snapshots['session-2']).toBeDefined();
    expect(store.errorMessage).toBe('Unable to close second terminal');
  });

  it('reorders existing tabs without opening or closing sessions', async () => {
    const client = createClient();
    const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1', 'tab-2', 'pane-2'));
    const store = useStore();
    await store.openTab();
    await store.openTab();

    store.reorderTabById('tab-2', 'tab-1', 'before');

    expect(store.workspace.tabs.map((tab) => tab.id)).toEqual(['tab-2', 'tab-1']);
    expect(client.openLocal).toHaveBeenCalledTimes(2);
    expect(client.close).not.toHaveBeenCalled();
  });

  it('merges a source tab into a target pane without closing either session', async () => {
    const client = createClient();
    const useStore = createWorkspaceStore(
      client,
      ids('tab-1', 'pane-1', 'tab-2', 'pane-2', 'split-1'),
    );
    const store = useStore();
    await store.openTab();
    await store.openTab();

    store.mergeTabIntoPane('tab-1', 'pane-2', 'right');

    expect(store.workspace.tabs).toHaveLength(1);
    expect(store.workspace.tabs[0]?.root).toMatchObject({
      kind: 'split',
      direction: 'vertical',
    });
    expect(client.close).not.toHaveBeenCalled();
    expect(store.snapshots['session-1']).toBeDefined();
    expect(store.snapshots['session-2']).toBeDefined();
  });
});

function createClient() {
  let sessionNumber = 0;
  const outputHandlers = new Map<string, (chunk: TerminalChunk) => void | Promise<void>>();
  const client = {
    openLocal: vi.fn(async (_options, onOutput) => {
      sessionNumber += 1;
      const sessionId = `session-${sessionNumber}`;
      outputHandlers.set(sessionId, onOutput);
      return {
        sessionId,
        backendType: 'local' as const,
        state: 'ready' as const,
        shell: '/bin/zsh',
      };
    }),
    close: vi.fn(async () => undefined),
    emit(chunk: TerminalChunk): Promise<void> {
      return Promise.resolve(outputHandlers.get(chunk.sessionId)?.(chunk));
    },
  } satisfies WorkspaceSessionClient & { emit: (chunk: TerminalChunk) => Promise<void> };
  return client;
}

function ids(...values: string[]) {
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
