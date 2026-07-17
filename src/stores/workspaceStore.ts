import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type { SessionSnapshot, TerminalChunk } from '@/domain/session';
import {
  activateTab as activateWorkspaceTab,
  addTab,
  closePane as closeWorkspacePane,
  closeTab as closeWorkspaceTab,
  createWorkspace,
  splitPane,
  type IdGenerator,
  type SplitDirection,
  type TerminalNode,
  type WorkspaceState,
} from '@/domain/workspace';
import { SessionClient, type OpenLocalSessionOptions } from '@/services/sessionClient';

const DEFAULT_TERMINAL_COLUMNS = 80;
const DEFAULT_TERMINAL_ROWS = 24;
const MAX_OUTPUT_HISTORY_BYTES = 2 * 1024 * 1024;

export interface WorkspaceSessionClient {
  openLocal(
    options: OpenLocalSessionOptions,
    onOutput: (chunk: TerminalChunk) => void,
  ): Promise<SessionSnapshot>;
  close(sessionId: string): Promise<void>;
}

type ChunkListener = (chunk: TerminalChunk) => void;

export function createWorkspaceStore(
  sessionClient: WorkspaceSessionClient,
  generateId: IdGenerator = () => crypto.randomUUID(),
) {
  return defineStore('workspace', () => {
    const workspace = ref<WorkspaceState>(emptyWorkspace());
    const snapshots = ref<Record<string, SessionSnapshot>>({});
    const errorMessage = ref<string | null>(null);
    const chunkListeners = new Map<string, Set<ChunkListener>>();
    const outputHistory = new Map<string, TerminalChunk[]>();
    const outputHistoryBytes = new Map<string, number>();
    const lastOutputSequence = new Map<string, number>();

    const activeSnapshot = computed(() => {
      const sessionId = workspace.value.focusedSessionId;
      return sessionId === null ? null : (snapshots.value[sessionId] ?? null);
    });

    async function openTab(): Promise<void> {
      const snapshot = await openSession();
      workspace.value =
        workspace.value.tabs.length === 0
          ? createWorkspace(snapshot.sessionId, generateId)
          : addTab(workspace.value, snapshot.sessionId, generateId);
    }

    async function splitFocused(direction: SplitDirection): Promise<void> {
      const snapshot = await openSession();
      workspace.value = splitPane(
        workspace.value,
        workspace.value.focusedPaneId,
        direction,
        snapshot.sessionId,
        generateId,
      );
    }

    function activateTab(tabId: string): void {
      workspace.value = activateWorkspaceTab(workspace.value, tabId);
    }

    async function closePane(paneId: string): Promise<void> {
      const sessionId = findPaneSessionId(workspace.value, paneId);
      await sessionClient.close(sessionId);
      workspace.value = closeWorkspacePane(workspace.value, paneId);
      removeSessionState(sessionId);
    }

    async function closeTab(tabId: string): Promise<void> {
      const tab = workspace.value.tabs.find((candidate) => candidate.id === tabId);
      if (tab === undefined) {
        throw new Error(`unknown tab: ${tabId}`);
      }
      const sessionIds = collectSessionIds(tab.root);
      await Promise.all(sessionIds.map((sessionId) => sessionClient.close(sessionId)));
      workspace.value = closeWorkspaceTab(workspace.value, tabId);
      sessionIds.forEach(removeSessionState);
    }

    function subscribeToSession(sessionId: string, listener: ChunkListener): () => void {
      const listeners = chunkListeners.get(sessionId) ?? new Set<ChunkListener>();
      listeners.add(listener);
      chunkListeners.set(sessionId, listeners);
      const history = outputHistory.get(sessionId) ?? [];
      history.forEach((chunk) => listener(chunk));

      return () => {
        const current = chunkListeners.get(sessionId);
        current?.delete(listener);
        if (current?.size === 0) {
          chunkListeners.delete(sessionId);
        }
      };
    }

    function nextOutputSequence(sessionId: string): number {
      const earliestHistory = outputHistory.get(sessionId)?.[0];
      if (earliestHistory !== undefined) {
        return earliestHistory.sequence;
      }
      return (lastOutputSequence.get(sessionId) ?? 0) + 1;
    }

    async function openSession(): Promise<SessionSnapshot> {
      errorMessage.value = null;
      try {
        const snapshot = await sessionClient.openLocal(
          { columns: DEFAULT_TERMINAL_COLUMNS, rows: DEFAULT_TERMINAL_ROWS },
          publishChunk,
        );
        snapshots.value = { ...snapshots.value, [snapshot.sessionId]: snapshot };
        return snapshot;
      } catch (error) {
        errorMessage.value =
          error instanceof Error ? error.message : 'Unable to open local terminal';
        throw error;
      }
    }

    function publishChunk(chunk: TerminalChunk): void {
      lastOutputSequence.set(chunk.sessionId, chunk.sequence);
      appendOutputHistory(chunk);
      const listeners = chunkListeners.get(chunk.sessionId);
      if (listeners !== undefined && listeners.size > 0) {
        listeners.forEach((listener) => listener(chunk));
      }
    }

    function appendOutputHistory(chunk: TerminalChunk): void {
      const history = outputHistory.get(chunk.sessionId) ?? [];
      let historyBytes = (outputHistoryBytes.get(chunk.sessionId) ?? 0) + chunk.payload.length;
      history.push(chunk);
      while (historyBytes > MAX_OUTPUT_HISTORY_BYTES && history.length > 1) {
        const removed = history.shift();
        historyBytes -= removed?.payload.length ?? 0;
      }
      outputHistory.set(chunk.sessionId, history);
      outputHistoryBytes.set(chunk.sessionId, historyBytes);
    }

    function removeSessionState(sessionId: string): void {
      const nextSnapshots = { ...snapshots.value };
      delete nextSnapshots[sessionId];
      snapshots.value = nextSnapshots;
      chunkListeners.delete(sessionId);
      outputHistory.delete(sessionId);
      outputHistoryBytes.delete(sessionId);
      lastOutputSequence.delete(sessionId);
    }

    return {
      workspace,
      snapshots,
      activeSnapshot,
      errorMessage,
      openTab,
      splitFocused,
      activateTab,
      closePane,
      closeTab,
      subscribeToSession,
      nextOutputSequence,
    };
  });
}

export const useWorkspaceStore = createWorkspaceStore(new SessionClient());

function findPaneSessionId(workspace: WorkspaceState, paneId: string): string {
  for (const tab of workspace.tabs) {
    const sessionId = findSessionId(tab.root, paneId);
    if (sessionId !== null) {
      return sessionId;
    }
  }
  throw new Error(`unknown pane: ${paneId}`);
}

function findSessionId(node: TerminalNode, paneId: string): string | null {
  if (node.kind === 'pane') {
    return node.id === paneId ? node.sessionId : null;
  }
  return findSessionId(node.children[0], paneId) ?? findSessionId(node.children[1], paneId);
}

function collectSessionIds(node: TerminalNode): string[] {
  if (node.kind === 'pane') {
    return [node.sessionId];
  }
  return [...collectSessionIds(node.children[0]), ...collectSessionIds(node.children[1])];
}

function emptyWorkspace(): WorkspaceState {
  return {
    tabs: [],
    activeTabId: null,
    focusedPaneId: null,
    focusedSessionId: null,
  };
}
