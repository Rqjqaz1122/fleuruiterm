import { describe, expect, it, vi } from 'vitest';

import type { AiToolDecision } from '@/stores/aiConversationStore';

import { createTerminalToolRunner, type TerminalToolDecisionPort } from './terminalToolRunner';
import type { AiTerminalToolCall } from './aiToolProtocol';

describe('terminal tool runner', () => {
  it('binds execution to the initial session and completes on the marker', async () => {
    const workspace = createWorkspacePort();
    workspace.waitForSessionTerminalOutput.mockResolvedValue({
      output: 'result\n__FLEURTERM_DONE_call_1:0',
      reason: 'matched',
      truncated: false,
    });
    const decisions = createDecisionPort();
    const runner = createTerminalToolRunner(workspace, decisions);

    const result = await runner.execute(createCall(), {
      shell: 'zsh',
      signal: new AbortController().signal,
    });

    expect(workspace.writeToSession).toHaveBeenCalledWith(
      'session-1',
      expect.stringContaining('__FLEURTERM_DONE_call_1'),
    );
    expect(result).toMatchObject({ outcome: 'completed', output: 'result' });
  });

  it('stays blocked until the user uses the current output', async () => {
    const workspace = createWorkspacePort();
    workspace.waitForSessionTerminalOutput.mockResolvedValueOnce({
      output: 'Password:',
      reason: 'timeout',
      truncated: false,
    });
    const decisions = createDecisionPort();
    const runner = createTerminalToolRunner(workspace, decisions);

    const resultPromise = runner.execute(createCall(), {
      shell: 'zsh',
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => {
      expect(decisions.waitForToolDecision).toHaveBeenCalledWith('call-1');
    });
    decisions.resolve('usePartialOutput');

    await expect(resultPromise).resolves.toMatchObject({
      outcome: 'partial',
      output: 'Password:',
    });
  });

  it('interrupts the bound session when the user stops a blocked command', async () => {
    const workspace = createWorkspacePort();
    workspace.waitForSessionTerminalOutput.mockResolvedValueOnce({
      output: 'waiting',
      reason: 'timeout',
      truncated: false,
    });
    const decisions = createDecisionPort();
    const runner = createTerminalToolRunner(workspace, decisions);

    const resultPromise = runner.execute(createCall(), {
      shell: 'zsh',
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => {
      expect(decisions.waitForToolDecision).toHaveBeenCalled();
    });
    decisions.resolve('interrupt');

    await expect(resultPromise).resolves.toMatchObject({ outcome: 'cancelled' });
    expect(workspace.interruptSession).toHaveBeenCalledWith('session-1');
  });

  it('interrupts execution and releases the wait when the turn is aborted', async () => {
    const workspace = createWorkspacePort();
    workspace.waitForSessionTerminalOutput.mockImplementation((_cursor, options) => {
      return new Promise((resolve) => {
        options.signal?.addEventListener('abort', () => {
          resolve({ output: '', reason: 'cancelled', truncated: false });
        });
      });
    });
    const decisions = createDecisionPort();
    const runner = createTerminalToolRunner(workspace, decisions);
    const controller = new AbortController();

    const resultPromise = runner.execute(createCall(), {
      shell: 'zsh',
      signal: controller.signal,
    });
    controller.abort();

    await expect(resultPromise).resolves.toMatchObject({ outcome: 'cancelled' });
    expect(workspace.interruptSession).toHaveBeenCalledWith('session-1');
  });
});

function createCall(): AiTerminalToolCall {
  return {
    id: 'call-1',
    type: 'terminal.command',
    command: 'pwd',
    targetSessionId: 'session-1',
    risk: 'safe',
    status: 'approved',
    output: '',
    errorMessage: null,
    truncated: false,
    createdAt: 1,
    startedAt: null,
    completedAt: null,
  };
}

function createWorkspacePort() {
  return {
    writeToSession: vi.fn(async () => undefined),
    interruptSession: vi.fn(async () => undefined),
    getTerminalOutputCursor: vi.fn(() => ({ sessionId: 'session-1', sequence: 0 })),
    waitForSessionTerminalOutput: vi.fn(),
  };
}

function createDecisionPort(): TerminalToolDecisionPort & {
  resolve: (decision: AiToolDecision) => void;
} {
  let resolveDecision: ((decision: AiToolDecision) => void) | null = null;
  return {
    updateToolCall: vi.fn(),
    waitForToolDecision: vi.fn(
      () =>
        new Promise((resolve) => {
          resolveDecision = resolve;
        }),
    ),
    resolve(decision) {
      resolveDecision?.(decision);
    },
  };
}
