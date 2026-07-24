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

  it('passes shell options to the terminal session client', async () => {
    const client = createClient();
    const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1'));
    const store = useStore();

    await store.openTab({
      shell: 'bash',
      args: ['-lc', 'pwd'],
      cwd: '/tmp/project',
      title: 'Project shell',
    });

    expect(client.openLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        shell: 'bash',
        args: ['-lc', 'pwd'],
        cwd: '/tmp/project',
      }),
      expect.any(Function),
      expect.any(Function),
    );
    expect(store.workspace.tabs[0]?.launch).toEqual({
      type: 'local',
      shell: 'bash',
      args: ['-lc', 'pwd'],
      cwd: '/tmp/project',
    });
  });

  it('stores only a saved connection reference for a restorable tab', async () => {
    const client = createClient();
    const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1'));
    const store = useStore();

    await store.openTab({
      shell: 'ssh',
      args: ['deploy@example.com'],
      password: 'secret',
      title: 'Production',
      connectionProfileId: 'production',
    });

    expect(store.workspace.tabs[0]?.launch).toEqual({
      type: 'savedConnection',
      connectionProfileId: 'production',
    });
    expect(JSON.stringify(store.workspace.tabs[0])).not.toContain('secret');
  });

  it('tracks the saved connection and state for its runtime session', async () => {
    const client = createClient();
    const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1'));
    const store = useStore();

    await store.openTab({
      shell: 'ssh',
      args: ['deploy@example.com'],
      connectionProfileId: 'production',
    });

    expect(store.connectionProfileIdForSession('session-1')).toBe('production');
    expect(store.sessionStateForSession('session-1')).toBe('ready');
  });

  it('does not inherit the SSH profile when a local pane is split from its tab', async () => {
    const client = createClient();
    const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1', 'split-1', 'pane-2'));
    const store = useStore();
    await store.openTab({ connectionProfileId: 'production' });

    await store.splitFocused('vertical');

    expect(store.connectionProfileIdForSession('session-1')).toBe('production');
    expect(store.connectionProfileIdForSession('session-2')).toBeNull();
  });

  it('removes runtime connection ownership when the terminal closes', async () => {
    const client = createClient();
    const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1'));
    const store = useStore();
    await store.openTab({ connectionProfileId: 'production' });

    await store.closeTab('tab-1');

    expect(store.connectionProfileIdForSession('session-1')).toBeNull();
    expect(store.sessionStateForSession('session-1')).toBeNull();
  });

  it('responds once to a password prompt when a session has a configured password', async () => {
    const client = createClient();
    const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1'));
    const store = useStore();

    await store.openTab({
      shell: 'ssh',
      args: ['deploy@example.com'],
      password: 'secret',
      title: 'SSH deploy@example.com',
    });
    store.subscribeToSession('session-1', vi.fn());
    await client.emit({
      sessionId: 'session-1',
      sequence: 1,
      payload: Array.from(new TextEncoder().encode("deploy@example.com's password: ")),
    });
    await client.emit({
      sessionId: 'session-1',
      sequence: 2,
      payload: Array.from(new TextEncoder().encode("deploy@example.com's password: ")),
    });

    expect(client.write).toHaveBeenCalledTimes(1);
    expect(client.write.mock.calls[0]?.[0]).toBe('session-1');
    expect(Array.from(client.write.mock.calls[0]?.[1] ?? [])).toEqual([
      115, 101, 99, 114, 101, 116, 13,
    ]);
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

    await client.emit(chunk);

    expect(listener).toHaveBeenCalledWith(chunk);
  });

  it('writes AI terminal input to the focused session', async () => {
    const client = createClient();
    const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1'));
    const store = useStore();
    await store.openTab();

    await store.writeToFocusedSession('pwd\r');

    expect(client.write).toHaveBeenCalledWith('session-1', new TextEncoder().encode('pwd\r'));
  });

  it('writes and interrupts the requested session even after focus changes', async () => {
    const client = createClient();
    const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1', 'tab-2', 'pane-2'));
    const store = useStore();
    await store.openTab();
    await store.openTab();

    await store.writeToSession('session-1', 'pwd\r');
    await store.interruptSession('session-1');

    expect(client.write).toHaveBeenCalledWith('session-1', new TextEncoder().encode('pwd\r'));
    expect(client.interrupt).toHaveBeenCalledWith('session-1');
  });

  it('exposes cleaned focused terminal output for AI context', async () => {
    const client = createClient();
    const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1'));
    const store = useStore();
    await store.openTab();
    store.subscribeToSession('session-1', vi.fn());

    await client.emit({
      sessionId: 'session-1',
      sequence: 1,
      payload: Array.from(new TextEncoder().encode('\x1B[32mhello\x1B[0m\r\n')),
    });

    expect(store.getFocusedTerminalOutput()).toBe('hello');
  });

  it('waits for focused terminal output after a cursor', async () => {
    vi.useFakeTimers();
    try {
      const client = createClient();
      const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1'));
      const store = useStore();
      await store.openTab();
      const cursor = store.getFocusedTerminalOutputCursor();
      if (cursor === null) {
        throw new Error('expected cursor');
      }

      const output = store.waitForFocusedTerminalOutput(cursor, {
        idleMs: 20,
        timeoutMs: 100,
      });
      await client.emit({
        sessionId: 'session-1',
        sequence: 1,
        payload: Array.from(new TextEncoder().encode('done\r\n')),
      });
      await vi.advanceTimersByTimeAsync(20);

      await expect(output).resolves.toBe('done');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports whether terminal output matched a completion marker or timed out', async () => {
    vi.useFakeTimers();
    try {
      const client = createClient();
      const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1'));
      const store = useStore();
      await store.openTab();

      const resultPromise = store.waitForSessionTerminalOutput(
        { sessionId: 'session-1', sequence: 0 },
        {
          settleOnIdle: false,
          timeoutMs: 20,
          until: (output) => output.includes('__DONE__'),
        },
      );
      await vi.advanceTimersByTimeAsync(20);

      await expect(resultPromise).resolves.toMatchObject({ reason: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a stable error when AI terminal input has no active session', async () => {
    const client = createClient();
    const useStore = createWorkspaceStore(client);
    const store = useStore();

    await expect(store.writeToFocusedSession('pwd\r')).rejects.toThrow(
      'No active terminal session',
    );

    expect(store.errorCode).toBe('WRITE_TERMINAL_FAILED');
    expect(store.errorMessage).toBe('No active terminal session');
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
      write: vi.fn(async () => undefined),
      interrupt: vi.fn(async () => undefined),
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

  it('removes a tab even when backend session close fails', async () => {
    const client = createClient();
    const useStore = createWorkspaceStore(client, ids('tab-1', 'pane-1', 'split-1', 'pane-2'));
    const store = useStore();
    await store.openTab();
    await store.splitPaneById('pane-1', 'vertical');
    client.close
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Unable to close second terminal'));

    await store.closeTab('tab-1');

    expect(store.workspace.tabs).toEqual([]);
    expect(store.snapshots['session-1']).toBeUndefined();
    expect(store.snapshots['session-2']).toBeUndefined();
    expect(store.errorMessage).toBeNull();
    expect(store.errorCode).toBeNull();
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
    interrupt: vi.fn(async () => undefined),
    write: vi.fn(async () => undefined),
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
