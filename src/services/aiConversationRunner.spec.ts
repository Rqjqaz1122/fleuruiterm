import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionSnapshot } from '@/domain/session';
import { defaultAiSettings, type AiCommandPolicy } from '@/stores/appSettingsStore';
import { useAiConversationStore } from '@/stores/aiConversationStore';

import { createAiConversationRunner } from './aiConversationRunner';
import type { AiChatMessage } from './aiClient';
import type { AiTerminalToolCall, AiToolResult } from './aiToolProtocol';

describe('AI conversation runner', () => {
  const conversation = useAiConversationStore();

  beforeEach(() => {
    conversation.clearConversation();
  });

  it('keeps ask mode active through approval, execution, result return, and continuation', async () => {
    const { runner, sendChat, terminalRunner } = createRunner('ask');
    sendChat
      .mockResolvedValueOnce('<terminal-command>pwd</terminal-command>')
      .mockResolvedValueOnce('The directory is `/project`.');
    terminalRunner.execute.mockImplementation(async (call) => completedResult(call, '/project'));

    const turn = runner.send('where am I?', snapshot());
    await vi.waitFor(() => {
      expect(conversation.status.value).toBe('awaitingApproval');
    });
    const callId = conversation.toolCalls.value[0]?.id;
    if (!callId) {
      throw new Error('expected a terminal tool call');
    }
    runner.approve(callId);
    await turn;

    expect(sendChat).toHaveBeenCalledTimes(2);
    const continuationMessages = sendChat.mock.calls[1]?.[1] as AiChatMessage[];
    expect(continuationMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining('/project') }),
      ]),
    );
    expect(conversation.status.value).toBe('idle');
  });

  it('returns a denied result to the model without executing the command', async () => {
    const { runner, sendChat, terminalRunner } = createRunner('ask');
    sendChat
      .mockResolvedValueOnce('<terminal-command>rm -rf dist</terminal-command>')
      .mockResolvedValueOnce('I did not run it.');

    const turn = runner.send('clean it', snapshot());
    await vi.waitFor(() => {
      expect(conversation.status.value).toBe('awaitingApproval');
    });
    runner.deny(conversation.toolCalls.value[0]!.id);
    await turn;

    expect(terminalRunner.execute).not.toHaveBeenCalled();
    expect(sendChat.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining('denied') }),
      ]),
    );
  });

  it('automatically executes safe commands in auto mode', async () => {
    const { runner, sendChat, terminalRunner } = createRunner('auto');
    sendChat
      .mockResolvedValueOnce('<terminal-command>git status</terminal-command>')
      .mockResolvedValueOnce('Clean.');
    terminalRunner.execute.mockImplementation(async (call) => completedResult(call, 'clean'));

    await runner.send('status', snapshot());

    expect(terminalRunner.execute).toHaveBeenCalledTimes(1);
    expect(conversation.status.value).toBe('idle');
  });

  it('requires approval for risky commands in auto mode', async () => {
    const { runner, sendChat, terminalRunner } = createRunner('auto');
    sendChat
      .mockResolvedValueOnce('<terminal-command>npm install</terminal-command>')
      .mockResolvedValueOnce('Installed.');
    terminalRunner.execute.mockImplementation(async (call) => completedResult(call, 'done'));

    const turn = runner.send('install', snapshot());
    await vi.waitFor(() => {
      expect(conversation.status.value).toBe('awaitingApproval');
    });
    runner.approve(conversation.toolCalls.value[0]!.id);
    await turn;

    expect(terminalRunner.execute).toHaveBeenCalledTimes(1);
  });

  it('keeps the turn active while a terminal tool is blocked', async () => {
    const { runner, sendChat, terminalRunner } = createRunner('fullAccess');
    sendChat
      .mockResolvedValueOnce('<terminal-command>pwd</terminal-command>')
      .mockResolvedValueOnce('Done.');
    let finishTool: ((result: AiToolResult) => void) | null = null;
    terminalRunner.execute.mockImplementation(
      (call, options) =>
        new Promise((resolve) => {
          finishTool = resolve;
          options.onPhase?.('blocked');
          conversation.updateToolCall(call.id, { status: 'blocked' });
        }),
    );

    const turn = runner.send('run', snapshot());
    await vi.waitFor(() => {
      expect(conversation.status.value).toBe('blocked');
    });
    expect(conversation.turnActive.value).toBe(true);
    finishTool?.({
      callId: conversation.toolCalls.value[0]!.id,
      outcome: 'partial',
      command: 'pwd',
      output: 'partial',
      truncated: false,
    });
    await turn;

    expect(conversation.status.value).toBe('idle');
  });

  it('stops an active model request without returning to idle', async () => {
    const { runner, sendChat } = createRunner('ask');
    sendChat.mockImplementation((_settings, _messages, options) => {
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          reject(new DOMException('Stopped', 'AbortError'));
        });
      });
    });

    const turn = runner.send('wait', snapshot());
    await vi.waitFor(() => {
      expect(conversation.status.value).toBe('thinking');
    });
    runner.stop();
    await turn;

    expect(conversation.status.value).toBe('stopped');
  });

  it('limits automatic execution to six tool calls', async () => {
    const { runner, sendChat, terminalRunner } = createRunner('fullAccess');
    sendChat.mockResolvedValue('<terminal-command>pwd</terminal-command>');
    terminalRunner.execute.mockImplementation(async (call) => completedResult(call, 'result'));

    await runner.send('repeat', snapshot());

    expect(terminalRunner.execute).toHaveBeenCalledTimes(6);
    expect(conversation.messages.value.at(-1)?.content).toContain('step limit');
  });
});

function createRunner(commandPolicy: AiCommandPolicy) {
  const sendChat = vi.fn();
  const terminalRunner = { execute: vi.fn() };
  const runner = createAiConversationRunner({
    sendChat,
    conversation: useAiConversationStore(),
    settings: {
      aiSettings: ref({
        ...defaultAiSettings,
        provider: 'openai',
        baseUrl: 'https://example.test/v1',
        model: 'test-model',
        token: 'token',
        streamingEnabled: false,
        commandPolicy,
      }),
    },
    terminalRunner,
    runAppAction: vi.fn(async (action) => ({
      callId: `app-${action.type}`,
      outcome: 'completed',
      command: action.type,
      output: 'submitted',
      truncated: false,
    })),
  });
  return { runner, sendChat, terminalRunner };
}

function snapshot(): SessionSnapshot {
  return {
    sessionId: 'session-1',
    backendType: 'local',
    state: 'ready',
    shell: '/bin/zsh',
  };
}

function completedResult(call: AiTerminalToolCall, output: string): AiToolResult {
  return {
    callId: call.id,
    outcome: 'completed',
    command: call.command,
    output,
    truncated: false,
  };
}
