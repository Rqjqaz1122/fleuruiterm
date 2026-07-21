import type { AiToolDecision } from '@/stores/aiConversationStore';
import type {
  TerminalOutputCursor,
  TerminalOutputWaitResult,
  WaitForTerminalOutputOptions,
} from '@/stores/workspaceStore';

import type { AiTerminalToolCall, AiToolResult } from './aiToolProtocol';

export interface TerminalToolWorkspacePort {
  writeToSession(sessionId: string, input: string): Promise<void>;
  interruptSession(sessionId: string): Promise<void>;
  getTerminalOutputCursor(sessionId: string): TerminalOutputCursor;
  waitForSessionTerminalOutput(
    cursor: TerminalOutputCursor,
    options: WaitForTerminalOutputOptions,
  ): Promise<TerminalOutputWaitResult>;
}

export interface TerminalToolDecisionPort {
  updateToolCall(toolCallId: string, patch: Partial<AiTerminalToolCall>): void;
  waitForToolDecision(toolCallId: string): Promise<AiToolDecision>;
}

export interface TerminalToolExecutionOptions {
  onPhase?: (phase: 'waitingTerminal' | 'blocked') => void;
  shell: string;
  signal: AbortSignal;
}

export interface WrappedTerminalCommand {
  input: string;
  marker: string | null;
}

export interface TerminalToolRunner {
  execute(
    toolCall: AiTerminalToolCall,
    options: TerminalToolExecutionOptions,
  ): Promise<AiToolResult>;
}

export function createTerminalToolRunner(
  workspace: TerminalToolWorkspacePort,
  decisions: TerminalToolDecisionPort,
): TerminalToolRunner {
  return {
    async execute(toolCall, options) {
      return executeTerminalToolCall(workspace, decisions, toolCall, options);
    },
  };
}

export function wrapTerminalCommand(
  command: string,
  shell: string,
  callId: string,
): WrappedTerminalCommand {
  const marker = `__FLEURTERM_DONE_${sanitizeCallId(callId)}`;
  const shellName = normalizedShellName(shell);
  if (shellName === 'powershell' || shellName === 'powershell.exe' || shellName === 'pwsh') {
    return {
      marker,
      input: `& { ${command} }; Write-Output "${marker}:$LASTEXITCODE"\r`,
    };
  }
  if (shellName === 'cmd' || shellName === 'cmd.exe') {
    return { marker, input: `${command} & echo ${marker}:%errorlevel%\r` };
  }
  if (['ash', 'bash', 'dash', 'ksh', 'sh', 'zsh'].includes(shellName)) {
    return {
      marker,
      input: `{ ${command}; }; __fleurterm_exit=$?; printf '\\n${marker}:%s\\n' "$__fleurterm_exit"\r`,
    };
  }
  return { marker: null, input: `${command}\r` };
}

async function executeTerminalToolCall(
  workspace: TerminalToolWorkspacePort,
  decisions: TerminalToolDecisionPort,
  toolCall: AiTerminalToolCall,
  options: TerminalToolExecutionOptions,
): Promise<AiToolResult> {
  const targetSessionId = toolCall.targetSessionId;
  if (targetSessionId === null) {
    return failedResult(toolCall, 'No terminal session is available');
  }

  const startedAt = Date.now();
  decisions.updateToolCall(toolCall.id, { status: 'running', startedAt });
  const wrappedCommand = wrapTerminalCommand(toolCall.command, options.shell, toolCall.id);
  let cursor = workspace.getTerminalOutputCursor(targetSessionId);
  let collectedOutput = '';
  let truncated = false;

  try {
    if (options.signal.aborted) {
      return cancelExecution(workspace, decisions, toolCall, targetSessionId, collectedOutput);
    }
    await workspace.writeToSession(targetSessionId, wrappedCommand.input);
    if (options.signal.aborted) {
      return cancelExecution(workspace, decisions, toolCall, targetSessionId, collectedOutput);
    }
    options.onPhase?.('waitingTerminal');

    while (true) {
      decisions.updateToolCall(toolCall.id, { status: 'running', output: collectedOutput });
      const waitResult = await workspace.waitForSessionTerminalOutput(cursor, {
        settleOnIdle: wrappedCommand.marker === null,
        signal: options.signal,
        until: completionPredicate(wrappedCommand.marker),
      });
      collectedOutput = appendOutput(collectedOutput, waitResult.output);
      truncated ||= waitResult.truncated;

      switch (waitResult.reason) {
        case 'matched':
        case 'idle':
          return completeExecution(
            decisions,
            toolCall,
            wrappedCommand.marker,
            collectedOutput,
            truncated,
          );
        case 'cancelled':
          return cancelExecution(
            workspace,
            decisions,
            toolCall,
            targetSessionId,
            collectedOutput,
            truncated,
          );
        case 'sessionClosed':
          return failExecution(
            decisions,
            toolCall,
            collectedOutput,
            truncated,
            'Terminal session closed before the command completed',
          );
        case 'timeout': {
          options.onPhase?.('blocked');
          decisions.updateToolCall(toolCall.id, {
            status: 'blocked',
            output: cleanTerminalToolOutput(collectedOutput, wrappedCommand.marker),
            truncated,
          });
          const decision = await decisions.waitForToolDecision(toolCall.id);
          if (decision === 'continueWaiting') {
            cursor = workspace.getTerminalOutputCursor(targetSessionId);
            options.onPhase?.('waitingTerminal');
            continue;
          }
          if (decision === 'usePartialOutput') {
            return partialExecution(
              decisions,
              toolCall,
              collectedOutput,
              wrappedCommand.marker,
              truncated,
            );
          }
          return cancelExecution(
            workspace,
            decisions,
            toolCall,
            targetSessionId,
            collectedOutput,
            truncated,
          );
        }
      }
    }
  } catch (error) {
    if (options.signal.aborted) {
      return cancelExecution(
        workspace,
        decisions,
        toolCall,
        targetSessionId,
        collectedOutput,
        truncated,
      );
    }
    return failExecution(
      decisions,
      toolCall,
      collectedOutput,
      truncated,
      error instanceof Error ? error.message : 'Terminal command failed',
    );
  }
}

function completionPredicate(marker: string | null): ((output: string) => boolean) | undefined {
  if (marker === null) {
    return undefined;
  }
  const completionPattern = new RegExp(`${escapeRegularExpression(marker)}:-?\\d+`);
  return (output) => completionPattern.test(output);
}

function completeExecution(
  decisions: TerminalToolDecisionPort,
  toolCall: AiTerminalToolCall,
  marker: string | null,
  output: string,
  truncated: boolean,
): AiToolResult {
  const cleanedOutput = cleanTerminalToolOutput(output, marker);
  const exitCode = terminalExitCode(output, marker);
  if (exitCode !== null && exitCode !== 0) {
    return failExecution(
      decisions,
      toolCall,
      cleanedOutput,
      truncated,
      `Command exited with code ${exitCode}`,
    );
  }
  decisions.updateToolCall(toolCall.id, {
    status: 'completed',
    output: cleanedOutput,
    truncated,
    completedAt: Date.now(),
  });
  return {
    callId: toolCall.id,
    outcome: 'completed',
    command: toolCall.command,
    output: cleanedOutput,
    truncated,
  };
}

function partialExecution(
  decisions: TerminalToolDecisionPort,
  toolCall: AiTerminalToolCall,
  output: string,
  marker: string | null,
  truncated: boolean,
): AiToolResult {
  const cleanedOutput = cleanTerminalToolOutput(output, marker);
  decisions.updateToolCall(toolCall.id, {
    status: 'completed',
    output: cleanedOutput,
    truncated,
    completedAt: Date.now(),
  });
  return {
    callId: toolCall.id,
    outcome: 'partial',
    command: toolCall.command,
    output: cleanedOutput,
    truncated,
  };
}

async function cancelExecution(
  workspace: TerminalToolWorkspacePort,
  decisions: TerminalToolDecisionPort,
  toolCall: AiTerminalToolCall,
  sessionId: string,
  output: string,
  truncated = false,
): Promise<AiToolResult> {
  await workspace.interruptSession(sessionId);
  const cleanedOutput = cleanTerminalToolOutput(output, null);
  decisions.updateToolCall(toolCall.id, {
    status: 'cancelled',
    output: cleanedOutput,
    truncated,
    completedAt: Date.now(),
  });
  return {
    callId: toolCall.id,
    outcome: 'cancelled',
    command: toolCall.command,
    output: cleanedOutput,
    truncated,
  };
}

function failExecution(
  decisions: TerminalToolDecisionPort,
  toolCall: AiTerminalToolCall,
  output: string,
  truncated: boolean,
  errorMessage: string,
): AiToolResult {
  decisions.updateToolCall(toolCall.id, {
    status: 'failed',
    output,
    truncated,
    errorMessage,
    completedAt: Date.now(),
  });
  return failedResult(toolCall, errorMessage, output, truncated);
}

function failedResult(
  toolCall: AiTerminalToolCall,
  errorMessage: string,
  output = '',
  truncated = false,
): AiToolResult {
  return {
    callId: toolCall.id,
    outcome: 'failed',
    command: toolCall.command,
    output,
    truncated,
    errorMessage,
  };
}

function terminalExitCode(output: string, marker: string | null): number | null {
  if (marker === null) {
    return null;
  }
  const matches = Array.from(
    output.matchAll(new RegExp(`${escapeRegularExpression(marker)}:(-?\\d+)`, 'g')),
  );
  const exitCode = Number(matches.at(-1)?.[1]);
  return Number.isFinite(exitCode) ? exitCode : null;
}

function cleanTerminalToolOutput(output: string, marker: string | null): string {
  if (marker === null) {
    return output.trim();
  }
  return output
    .split('\n')
    .filter((line) => !line.includes(marker))
    .join('\n')
    .trim();
}

function appendOutput(currentOutput: string, nextOutput: string): string {
  if (!currentOutput) {
    return nextOutput;
  }
  if (!nextOutput) {
    return currentOutput;
  }
  return `${currentOutput}\n${nextOutput}`;
}

function normalizedShellName(shell: string): string {
  return shell.trim().toLowerCase().split(/[\\/]/).at(-1) ?? '';
}

function sanitizeCallId(callId: string): string {
  return callId.replace(/[^a-zA-Z0-9_]/g, '_');
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
