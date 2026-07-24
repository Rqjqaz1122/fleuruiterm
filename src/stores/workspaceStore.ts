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
  closeTab as closeWorkspaceTab,
  createWorkspace,
  focusPane as focusWorkspacePane,
  mergeTabIntoPane as mergeWorkspaceTabIntoPane,
  reorderTab as reorderWorkspaceTab,
  splitPane,
  type IdGenerator,
  type PaneDropPosition,
  type SplitDirection,
  type TabDropPlacement,
  type TerminalLaunch,
  type TerminalNode,
  type WorkspaceState,
} from '@/domain/workspace';
import { SessionClient, type OpenLocalSessionOptions } from '@/services/sessionClient';

const DEFAULT_TERMINAL_COLUMNS = 80;
const DEFAULT_TERMINAL_ROWS = 24;
const MAX_OUTPUT_HISTORY_BYTES = 2 * 1024 * 1024;
const DEFAULT_AI_OUTPUT_CONTEXT_BYTES = 16 * 1024;
const DEFAULT_TERMINAL_OUTPUT_IDLE_MS = 900;
const DEFAULT_TERMINAL_OUTPUT_TIMEOUT_MS = 12_000;

export interface OpenTerminalTabOptions {
  shell?: string;
  args?: string[];
  cwd?: string;
  password?: string;
  title?: string;
  connectionProfileId?: string;
}

export interface TerminalOutputCursor {
  sessionId: string;
  sequence: number;
}

export interface WaitForTerminalOutputOptions {
  idleMs?: number;
  maxBytes?: number;
  settleOnIdle?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  until?: (output: string) => boolean;
}

export interface TerminalOutputWaitResult {
  output: string;
  reason: 'matched' | 'idle' | 'timeout' | 'sessionClosed' | 'cancelled';
  truncated: boolean;
}

export type WorkspaceErrorCode =
  | 'OPEN_TERMINAL_FAILED'
  | 'CLOSE_TERMINAL_FAILED'
  | 'CLOSE_TAB_FAILED'
  | 'INTERRUPT_TERMINAL_FAILED'
  | 'PERSIST_WORKSPACE_FAILED'
  | 'WRITE_TERMINAL_FAILED';

export interface WorkspaceSessionClient {
  openLocal(
    options: OpenLocalSessionOptions,
    onOutput: (chunk: TerminalChunk) => void | Promise<void>,
    onState?: (event: SessionStateChanged) => void,
  ): Promise<SessionSnapshot>;
  write(sessionId: string, input: Uint8Array): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
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
    const errorCode = ref<WorkspaceErrorCode | null>(null);
    const chunkListeners = new Map<string, Set<ChunkListener>>();
    const outputHistory = new Map<string, TerminalChunk[]>();
    const outputHistoryBytes = new Map<string, number>();
    const lastOutputSequence = new Map<string, number>();
    const pendingSessionStates = new Map<string, SessionState>();
    const pendingConsumptions = new Map<string, Map<number, PendingConsumption>>();
    const activeOutputWaitClosers = new Map<string, Set<() => void>>();
    const passwordPromptResponses = new Map<string, string>();

    const activeSnapshot = computed(() => {
      const sessionId = workspace.value.focusedSessionId;
      return sessionId === null ? null : (snapshots.value[sessionId] ?? null);
    });

    async function openTab(options: OpenTerminalTabOptions = {}): Promise<void> {
      const snapshot = await openSession(options);
      const title = options.title;
      const launch = createTerminalLaunch(options);
      workspace.value =
        workspace.value.tabs.length === 0
          ? createWorkspace(snapshot.sessionId, generateId, title, launch)
          : addTab(workspace.value, snapshot.sessionId, generateId, title, launch);
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
      errorCode.value = null;
      try {
        await sessionClient.close(sessionId);
        workspace.value = closeWorkspacePane(workspace.value, paneId);
        removeSessionState(sessionId);
      } catch (error) {
        errorCode.value = 'CLOSE_TERMINAL_FAILED';
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
      errorCode.value = null;
      workspace.value = closeWorkspaceTab(workspace.value, tabId);
      panes.forEach((pane) => removeSessionState(pane.sessionId));
      await Promise.allSettled(panes.map((pane) => sessionClient.close(pane.sessionId)));
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

    async function writeToFocusedSession(input: string): Promise<void> {
      const sessionId = workspace.value.focusedSessionId;
      if (sessionId === null) {
        const error = new Error('No active terminal session');
        errorCode.value = 'WRITE_TERMINAL_FAILED';
        errorMessage.value = error.message;
        throw error;
      }
      await writeToSession(sessionId, input);
    }

    async function writeToSession(sessionId: string, input: string): Promise<void> {
      errorMessage.value = null;
      errorCode.value = null;
      try {
        await sessionClient.write(sessionId, encodeTerminalInput(input));
      } catch (error) {
        errorCode.value = 'WRITE_TERMINAL_FAILED';
        errorMessage.value = userVisibleError(error, 'Unable to write to terminal');
        throw error;
      }
    }

    async function interruptSession(sessionId: string): Promise<void> {
      errorMessage.value = null;
      errorCode.value = null;
      try {
        await sessionClient.interrupt(sessionId);
      } catch (error) {
        errorCode.value = 'INTERRUPT_TERMINAL_FAILED';
        errorMessage.value = userVisibleError(error, 'Unable to interrupt terminal');
        throw error;
      }
    }

    function getFocusedTerminalOutput(maxBytes = DEFAULT_AI_OUTPUT_CONTEXT_BYTES): string {
      const sessionId = workspace.value.focusedSessionId;
      return sessionId === null ? '' : collectTerminalOutput(sessionId, 0, maxBytes);
    }

    function getFocusedTerminalOutputCursor(): TerminalOutputCursor | null {
      const sessionId = workspace.value.focusedSessionId;
      if (sessionId === null) {
        return null;
      }
      return getTerminalOutputCursor(sessionId);
    }

    function getTerminalOutputCursor(sessionId: string): TerminalOutputCursor {
      return { sessionId, sequence: lastOutputSequence.get(sessionId) ?? 0 };
    }

    function waitForFocusedTerminalOutput(
      cursor: TerminalOutputCursor,
      options: WaitForTerminalOutputOptions = {},
    ): Promise<string> {
      const sessionId = workspace.value.focusedSessionId;
      if (sessionId === null || sessionId !== cursor.sessionId) {
        return Promise.resolve('');
      }
      return waitForSessionTerminalOutput(cursor, options).then((result) => result.output);
    }

    async function openSession(options: OpenTerminalTabOptions = {}): Promise<SessionSnapshot> {
      errorMessage.value = null;
      errorCode.value = null;
      try {
        const snapshot = await sessionClient.openLocal(
          {
            shell: options.shell,
            args: options.args,
            cwd: options.cwd,
            columns: DEFAULT_TERMINAL_COLUMNS,
            rows: DEFAULT_TERMINAL_ROWS,
          },
          publishChunk,
          updateSessionState,
        );
        const pendingState = pendingSessionStates.get(snapshot.sessionId);
        pendingSessionStates.delete(snapshot.sessionId);
        const currentSnapshot =
          pendingState === undefined ? snapshot : { ...snapshot, state: pendingState };
        snapshots.value = { ...snapshots.value, [snapshot.sessionId]: currentSnapshot };
        if (options.password) {
          passwordPromptResponses.set(snapshot.sessionId, options.password);
        }
        return currentSnapshot;
      } catch (error) {
        errorCode.value = 'OPEN_TERMINAL_FAILED';
        errorMessage.value = userVisibleError(error, 'Unable to open local terminal');
        throw error;
      }
    }

    async function publishChunk(chunk: TerminalChunk): Promise<void> {
      lastOutputSequence.set(chunk.sessionId, chunk.sequence);
      appendOutputHistory(chunk);
      await respondToPasswordPrompt(chunk);
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
      resolveActiveOutputWaits(sessionId);
      const nextSnapshots = { ...snapshots.value };
      delete nextSnapshots[sessionId];
      snapshots.value = nextSnapshots;
      chunkListeners.delete(sessionId);
      outputHistory.delete(sessionId);
      outputHistoryBytes.delete(sessionId);
      lastOutputSequence.delete(sessionId);
      pendingSessionStates.delete(sessionId);
      passwordPromptResponses.delete(sessionId);
      settlePendingSession(sessionId);
    }

    function waitForSessionTerminalOutput(
      cursor: TerminalOutputCursor,
      options: WaitForTerminalOutputOptions,
    ): Promise<TerminalOutputWaitResult> {
      const maxBytes = options.maxBytes ?? DEFAULT_AI_OUTPUT_CONTEXT_BYTES;
      const idleMs = options.idleMs ?? DEFAULT_TERMINAL_OUTPUT_IDLE_MS;
      const timeoutMs = options.timeoutMs ?? DEFAULT_TERMINAL_OUTPUT_TIMEOUT_MS;
      const settleOnIdle = options.settleOnIdle ?? true;

      return new Promise((resolve) => {
        let idleTimer: ReturnType<typeof setTimeout> | null = null;
        let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
        let settled = false;
        const listeners = chunkListeners.get(cursor.sessionId) ?? new Set<ChunkListener>();

        const listener: ChunkListener = (chunk) => {
          if (chunk.sequence <= cursor.sequence) {
            return;
          }
          evaluateOutput();
        };
        const unregister = () => {
          options.signal?.removeEventListener('abort', abortWait);
          listeners.delete(listener);
          if (listeners.size === 0) {
            chunkListeners.delete(cursor.sessionId);
          }
          const sessionWaitClosers = activeOutputWaitClosers.get(cursor.sessionId);
          sessionWaitClosers?.delete(closeWait);
          if (sessionWaitClosers?.size === 0) {
            activeOutputWaitClosers.delete(cursor.sessionId);
          }
        };
        const settle = (reason: TerminalOutputWaitResult['reason']) => {
          if (settled) {
            return;
          }
          settled = true;
          if (idleTimer !== null) {
            clearTimeout(idleTimer);
          }
          if (timeoutTimer !== null) {
            clearTimeout(timeoutTimer);
          }
          unregister();
          const collectedOutput = collectTerminalOutputResult(
            cursor.sessionId,
            cursor.sequence,
            maxBytes,
          );
          resolve({ ...collectedOutput, reason });
        };
        const closeWait = () => settle('sessionClosed');
        const abortWait = () => settle('cancelled');
        const scheduleIdle = () => {
          if (!settleOnIdle) {
            return;
          }
          if (idleTimer !== null) {
            clearTimeout(idleTimer);
          }
          idleTimer = setTimeout(() => settle('idle'), idleMs);
        };
        const evaluateOutput = () => {
          const collectedOutput = collectTerminalOutputResult(
            cursor.sessionId,
            cursor.sequence,
            maxBytes,
          );
          if (options.until?.(collectedOutput.output)) {
            settle('matched');
            return;
          }
          if (collectedOutput.output.trim()) {
            scheduleIdle();
          }
        };

        listeners.add(listener);
        chunkListeners.set(cursor.sessionId, listeners);
        const sessionWaitClosers = activeOutputWaitClosers.get(cursor.sessionId) ?? new Set();
        sessionWaitClosers.add(closeWait);
        activeOutputWaitClosers.set(cursor.sessionId, sessionWaitClosers);
        options.signal?.addEventListener('abort', abortWait, { once: true });
        timeoutTimer = setTimeout(() => settle('timeout'), timeoutMs);
        if (options.signal?.aborted) {
          abortWait();
        } else {
          evaluateOutput();
        }
      });
    }

    function collectTerminalOutput(
      sessionId: string,
      afterSequence: number,
      maxBytes: number,
    ): string {
      return collectTerminalOutputResult(sessionId, afterSequence, maxBytes).output;
    }

    function collectTerminalOutputResult(
      sessionId: string,
      afterSequence: number,
      maxBytes: number,
    ): Pick<TerminalOutputWaitResult, 'output' | 'truncated'> {
      const chunks = (outputHistory.get(sessionId) ?? []).filter(
        (chunk) => chunk.sequence > afterSequence,
      );
      const selectedChunks: TerminalChunk[] = [];
      let byteCount = 0;
      for (let index = chunks.length - 1; index >= 0; index -= 1) {
        const chunk = chunks[index];
        if (chunk === undefined) {
          continue;
        }
        selectedChunks.unshift(chunk);
        byteCount += chunk.payload.length;
        if (byteCount >= maxBytes) {
          break;
        }
      }
      const payload = selectedChunks.flatMap((chunk) => chunk.payload);
      const truncated = selectedChunks.length < chunks.length || payload.length > maxBytes;
      const boundedPayload = payload.slice(Math.max(0, payload.length - maxBytes));
      return {
        output: stripTerminalControlSequences(decodeTerminalPayload(boundedPayload)),
        truncated,
      };
    }

    async function respondToPasswordPrompt(chunk: TerminalChunk): Promise<void> {
      const password = passwordPromptResponses.get(chunk.sessionId);
      if (!password) {
        return;
      }
      const output = decodeTerminalPayload(chunk.payload).toLowerCase();
      if (!/password(?: for [^:]+)?:\s*$/.test(output) && !output.includes("'s password:")) {
        return;
      }
      passwordPromptResponses.delete(chunk.sessionId);
      await sessionClient.write(chunk.sessionId, encodeTerminalInput(`${password}\r`));
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

    function resolveActiveOutputWaits(sessionId: string): void {
      const sessionWaitClosers = activeOutputWaitClosers.get(sessionId);
      Array.from(sessionWaitClosers ?? []).forEach((closeWait) => closeWait());
    }

    return {
      workspace,
      snapshots,
      activeSnapshot,
      errorMessage,
      errorCode,
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
      writeToSession,
      writeToFocusedSession,
      interruptSession,
      getFocusedTerminalOutput,
      getTerminalOutputCursor,
      getFocusedTerminalOutputCursor,
      waitForSessionTerminalOutput,
      waitForFocusedTerminalOutput,
    };
  });
}

const terminalTextDecoder = new TextDecoder();
const terminalTextEncoder = new TextEncoder();

function decodeTerminalPayload(payload: number[]): string {
  return terminalTextDecoder.decode(new Uint8Array(payload));
}

function stripTerminalControlSequences(output: string): string {
  return output
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

function encodeTerminalInput(input: string): Uint8Array {
  return terminalTextEncoder.encode(input);
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

function createTerminalLaunch(options: OpenTerminalTabOptions): TerminalLaunch {
  if (options.connectionProfileId !== undefined) {
    return {
      type: 'savedConnection',
      connectionProfileId: options.connectionProfileId,
    };
  }
  return {
    type: 'local',
    ...(options.shell === undefined ? {} : { shell: options.shell }),
    ...(options.args === undefined ? {} : { args: [...options.args] }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  };
}

function userVisibleError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
