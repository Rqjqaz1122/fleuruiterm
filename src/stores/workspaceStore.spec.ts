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
});

function createClient() {
  let sessionNumber = 0;
  const outputHandlers = new Map<string, (chunk: TerminalChunk) => void>();
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
    emit(chunk: TerminalChunk) {
      outputHandlers.get(chunk.sessionId)?.(chunk);
    },
  } satisfies WorkspaceSessionClient & { emit: (chunk: TerminalChunk) => void };
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
