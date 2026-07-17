import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type {
  SessionSnapshot,
  SessionState,
  SessionStateChanged,
  TerminalChunk,
} from '@/domain/session';
import {
  activateTab as activateWorkspaceTab,
  addTab,
  closePane as closeWorkspacePane,
  createWorkspace,
  focusPane as focusWorkspacePane,
  mergeTabIntoPane as mergeWorkspaceTabIntoPane,
  reorderTab as reorderWorkspaceTab,
  splitPane,
  type IdGenerator,
  type PaneDropPosition,
  type SplitDirection,
  type TabDropPlacement,
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
    onOutput: (chunk: TerminalChunk) => void | Promise<void>,
    onState?: (event: SessionStateChanged) => void,
  ): Promise<SessionSnapshot>;
  close(sessionId: string): Promise<void>;
}

type ChunkListener = (chunk: TerminalChunk) => void | Promise<void>;

interface PendingConsumption {
  resolve: () => void;
  reject: (error: unknown) => void;
}

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
    const pendingSessionStates = new Map<string, SessionState>();
    const pendingConsumptions = new Map<string, Map<number, PendingConsumption>>();

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
      const paneId = workspace.value.focusedPaneId;
      if (paneId === null) {
        throw new Error('cannot split without a focused pane');
      }
      await splitPaneById(paneId, direction);
    }

    async function splitPaneById(paneId: string, direction: SplitDirection): Promise<void> {
      workspace.value = focusWorkspacePane(workspace.value, paneId);
      const snapshot = await openSession();
      workspace.value = splitPane(
        workspace.value,
        paneId,
        direction,
        snapshot.sessionId,
        generateId,
      );
    }

    function focusPane(paneId: string): void {
      workspace.value = focusWorkspacePane(workspace.value, paneId);
    }

    function activateTab(tabId: string): void {
      workspace.value = activateWorkspaceTab(workspace.value, tabId);
    }

    function reorderTabById(
      sourceTabId: string,
      targetTabId: string,
      placement: TabDropPlacement,
    ): void {
      workspace.value = reorderWorkspaceTab(workspace.value, sourceTabId, targetTabId, placement);
    }

    function mergeTabIntoPane(
      sourceTabId: string,
      targetPaneId: string,
      position: PaneDropPosition,
    ): void {
      workspace.value = mergeWorkspaceTabIntoPane(
        workspace.value,
        sourceTabId,
        targetPaneId,
        position,
        generateId,
      );
    }

    async function closePane(paneId: string): Promise<void> {
      const sessionId = findPaneSessionId(workspace.value, paneId);
      errorMessage.value = null;
      try {
        await sessionClient.close(sessionId);
        workspace.value = closeWorkspacePane(workspace.value, paneId);
        removeSessionState(sessionId);
      } catch (error) {
        errorMessage.value = userVisibleError(error, 'Unable to close terminal');
        throw error;
      }
    }

    async function closeTab(tabId: string): Promise<void> {
      const tab = workspace.value.tabs.find((candidate) => candidate.id === tabId);
      if (tab === undefined) {
        throw new Error(`unknown tab: ${tabId}`);
      }
      const panes = collectPanes(tab.root);
      errorMessage.value = null;
      const closeResults = await Promise.allSettled(
        panes.map((pane) => sessionClient.close(pane.sessionId)),
      );
      let nextWorkspace = workspace.value;
      closeResults.forEach((result, index) => {
        if (result.status !== 'fulfilled') {
          return;
        }
        const pane = panes[index];
        if (pane !== undefined) {
          nextWorkspace = closeWorkspacePane(nextWorkspace, pane.paneId);
          removeSessionState(pane.sessionId);
        }
      });
      workspace.value = nextWorkspace;
      const firstFailure = closeResults.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (firstFailure !== undefined) {
        errorMessage.value = userVisibleError(firstFailure.reason, 'Unable to close terminal tab');
        throw firstFailure.reason;
      }
    }

    function subscribeToSession(sessionId: string, listener: ChunkListener): () => void {
      const listeners = chunkListeners.get(sessionId) ?? new Set<ChunkListener>();
      listeners.add(listener);
      chunkListeners.set(sessionId, listeners);
      const history = outputHistory.get(sessionId) ?? [];
      history.forEach((chunk) => {
        void Promise.resolve(listener(chunk)).then(
          () => settlePendingConsumption(chunk.sessionId, chunk.sequence),
          (error: unknown) => rejectPendingConsumption(chunk.sessionId, chunk.sequence, error),
        );
      });

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
          updateSessionState,
        );
        const pendingState = pendingSessionStates.get(snapshot.sessionId);
        pendingSessionStates.delete(snapshot.sessionId);
        const currentSnapshot =
          pendingState === undefined ? snapshot : { ...snapshot, state: pendingState };
        snapshots.value = { ...snapshots.value, [snapshot.sessionId]: currentSnapshot };
        return currentSnapshot;
      } catch (error) {
        errorMessage.value = userVisibleError(error, 'Unable to open local terminal');
        throw error;
      }
    }

    async function publishChunk(chunk: TerminalChunk): Promise<void> {
      lastOutputSequence.set(chunk.sessionId, chunk.sequence);
      appendOutputHistory(chunk);
      const listeners = chunkListeners.get(chunk.sessionId);
      if (listeners !== undefined && listeners.size > 0) {
        await Promise.all(Array.from(listeners, (listener) => listener(chunk)));
        return;
      }
      await waitForTerminalConsumption(chunk);
    }

    function updateSessionState(event: SessionStateChanged): void {
      const snapshot = snapshots.value[event.sessionId];
      if (snapshot === undefined) {
        pendingSessionStates.set(event.sessionId, event.state);
        return;
      }
      snapshots.value = {
        ...snapshots.value,
        [event.sessionId]: { ...snapshot, state: event.state },
      };
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
      pendingSessionStates.delete(sessionId);
      settlePendingSession(sessionId);
    }

    function waitForTerminalConsumption(chunk: TerminalChunk): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const sessionConsumptions =
          pendingConsumptions.get(chunk.sessionId) ?? new Map<number, PendingConsumption>();
        sessionConsumptions.set(chunk.sequence, { resolve, reject });
        pendingConsumptions.set(chunk.sessionId, sessionConsumptions);
      });
    }

    function settlePendingConsumption(sessionId: string, sequence: number): void {
      const sessionConsumptions = pendingConsumptions.get(sessionId);
      const consumption = sessionConsumptions?.get(sequence);
      if (consumption === undefined) {
        return;
      }
      sessionConsumptions?.delete(sequence);
      if (sessionConsumptions?.size === 0) {
        pendingConsumptions.delete(sessionId);
      }
      consumption.resolve();
    }

    function rejectPendingConsumption(sessionId: string, sequence: number, error: unknown): void {
      const sessionConsumptions = pendingConsumptions.get(sessionId);
      const consumption = sessionConsumptions?.get(sequence);
      if (consumption === undefined) {
        return;
      }
      sessionConsumptions?.delete(sequence);
      if (sessionConsumptions?.size === 0) {
        pendingConsumptions.delete(sessionId);
      }
      consumption.reject(error);
    }

    function settlePendingSession(sessionId: string): void {
      const sessionConsumptions = pendingConsumptions.get(sessionId);
      pendingConsumptions.delete(sessionId);
      sessionConsumptions?.forEach((consumption) => consumption.resolve());
    }

    return {
      workspace,
      snapshots,
      activeSnapshot,
      errorMessage,
      openTab,
      splitFocused,
      splitPaneById,
      focusPane,
      activateTab,
      reorderTabById,
      mergeTabIntoPane,
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

function collectPanes(node: TerminalNode): Array<{ paneId: string; sessionId: string }> {
  if (node.kind === 'pane') {
    return [{ paneId: node.id, sessionId: node.sessionId }];
  }
  return [...collectPanes(node.children[0]), ...collectPanes(node.children[1])];
}

function emptyWorkspace(): WorkspaceState {
  return {
    tabs: [],
    activeTabId: null,
    focusedPaneId: null,
    focusedSessionId: null,
  };
}

function userVisibleError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
