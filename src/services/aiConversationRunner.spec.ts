import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionSnapshot } from '@/domain/session';
import type { AppLocale } from '@/i18n/locale';
import {
  defaultAiSettings,
  defaultAppearanceSettings,
  defaultStartupSettings,
  defaultTerminalSettings,
  type AiCommandPolicy,
} from '@/stores/appSettingsStore';
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

  it.each([
    '你当前执行的命令是什么？',
    '请告诉我刚才执行了什么命令',
    'What command did you just run?',
  ])('answers command-review question without another execution: %s', async (prompt) => {
    const { runner, sendChat, terminalRunner } = createRunner('ask');
    sendChat.mockResolvedValue(
      'The command that ran was:\n<terminal-command>ls</terminal-command>',
    );

    const turn = runner.send(prompt, snapshot());
    await vi.waitFor(() => {
      expect(['awaitingApproval', 'idle']).toContain(conversation.status.value);
    });
    const settledStatus = conversation.status.value;
    if (settledStatus === 'awaitingApproval') {
      runner.stop();
    }
    await turn;

    expect(settledStatus).toBe('idle');
    expect(terminalRunner.execute).not.toHaveBeenCalled();
    expect(conversation.toolCalls.value).toEqual([]);
    expect(conversation.messages.value.at(-1)?.content).toContain('```terminal\nls\n```');
  });

  it('allows an explicit execution request that also asks for an explanation', async () => {
    const { runner, sendChat, terminalRunner } = createRunner('ask');
    sendChat
      .mockResolvedValueOnce('<terminal-command>ls</terminal-command>')
      .mockResolvedValueOnce('执行完成。');
    terminalRunner.execute.mockImplementation(async (call) => completedResult(call, 'file.txt'));

    const turn = runner.send('解释这个命令，然后执行 ls', snapshot());
    await vi.waitFor(() => {
      expect(['awaitingApproval', 'idle']).toContain(conversation.status.value);
    });
    const executionStatus = conversation.status.value;
    if (executionStatus === 'awaitingApproval') {
      runner.approve(conversation.toolCalls.value[0]!.id);
    }
    await turn;

    expect(executionStatus).toBe('awaitingApproval');
    expect(terminalRunner.execute).toHaveBeenCalledOnce();
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

  it('does not request approval again when the model repeats a denied command', async () => {
    const { runner, sendChat, terminalRunner } = createRunner('ask');
    sendChat.mockResolvedValue('<terminal-command>rm -rf dist</terminal-command>');

    const turn = runner.send('clean it', snapshot());
    await vi.waitFor(() => {
      expect(conversation.status.value).toBe('awaitingApproval');
    });
    runner.deny(conversation.toolCalls.value[0]!.id);
    await turn;

    expect(terminalRunner.execute).not.toHaveBeenCalled();
    expect(sendChat).toHaveBeenCalledTimes(2);
    expect(conversation.toolCalls.value).toHaveLength(1);
    expect(conversation.messages.value.at(-1)?.content).toContain('denied');
  });

  it('allows the model to request a different command after a denial', async () => {
    const { runner, sendChat, terminalRunner } = createRunner('ask');
    sendChat
      .mockResolvedValueOnce('<terminal-command>rm -rf dist</terminal-command>')
      .mockResolvedValueOnce('<terminal-command>ls dist</terminal-command>')
      .mockResolvedValueOnce('The directory still exists.');
    terminalRunner.execute.mockImplementation(async (call) => completedResult(call, 'file.js'));

    const turn = runner.send('clean it', snapshot());
    await vi.waitFor(() => {
      expect(conversation.status.value).toBe('awaitingApproval');
    });
    runner.deny(conversation.toolCalls.value[0]!.id);
    await vi.waitFor(() => {
      expect(conversation.toolCalls.value).toHaveLength(2);
    });
    runner.approve(conversation.toolCalls.value[1]!.id);
    await turn;

    expect(terminalRunner.execute).toHaveBeenCalledOnce();
    expect(terminalRunner.execute.mock.calls[0]?.[0].command).toBe('ls dist');
    expect(sendChat).toHaveBeenCalledTimes(3);
  });

  it('stops after an existing terminal target is not found', async () => {
    const { runner, runAppAction, sendChat } = createRunner('ask');
    sendChat
      .mockResolvedValueOnce(
        '<fleurterm-action>{"type":"terminal.activate","target":"missing"}</fleurterm-action>',
      )
      .mockResolvedValueOnce(
        '<fleurterm-action>{"type":"terminal.openLocal","title":"missing"}</fleurterm-action>',
      );
    runAppAction.mockResolvedValueOnce({
      callId: 'app-terminal.activate',
      outcome: 'failed',
      command: 'terminal.activate',
      output: '',
      truncated: false,
      errorMessage: 'Terminal "missing" was not found.',
    });

    await runner.send('open missing terminal', snapshot());

    expect(sendChat).toHaveBeenCalledTimes(1);
    expect(runAppAction).toHaveBeenCalledTimes(1);
    expect(conversation.messages.value.at(-1)?.content).toBe('Terminal "missing" was not found.');
  });

  it('provides saved connection targets to the model', async () => {
    const savedConnections = [
      {
        id: 'root-10-7-121-72',
        name: 'root@10.7.121.72',
        method: 'ssh',
        host: '10.7.121.72',
        user: 'root',
        port: 22,
      },
    ];
    const { runner, sendChat } = createRunner('ask', savedConnections);
    sendChat.mockResolvedValueOnce('Ready.');

    await runner.send('open 10.7.121.72', snapshot());

    const requestMessages = sendChat.mock.calls[0]?.[1] as AiChatMessage[];
    expect(requestMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('root@10.7.121.72'),
        }),
      ]),
    );
  });

  it('provides the complete settings action contract and current non-secret values to the model', async () => {
    const { runner, sendChat } = createRunner('ask');
    sendChat.mockResolvedValueOnce('Ready.');

    await runner.send('make the terminal font larger', snapshot());

    const requestMessages = sendChat.mock.calls[0]?.[1] as AiChatMessage[];
    const systemContext = requestMessages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n');
    expect(systemContext).toContain('settings.update');
    expect(systemContext).toContain(JSON.stringify(defaultTerminalSettings));
    expect(systemContext).toContain(JSON.stringify(defaultStartupSettings));
    expect(systemContext).toContain(JSON.stringify(defaultAppearanceSettings));
    expect(systemContext).toContain('ai.baseUrl and ai.token are read-only');
    expect(systemContext).not.toContain('"token":"token"');
  });

  it('applies complete setting actions immediately in ask mode', async () => {
    const { runner, runAppAction, sendChat } = createRunner('ask');
    sendChat
      .mockResolvedValueOnce(
        '<fleurterm-action>{"type":"settings.update","patch":{"startup":{"openTerminalOnStartup":true},"appearance":{"themeMode":"light"}}}</fleurterm-action>',
      )
      .mockResolvedValueOnce('Startup and appearance settings were updated.');

    await runner.send('launch a terminal on startup and use light mode', snapshot());

    expect(runAppAction).toHaveBeenCalledWith({
      type: 'settings.update',
      patch: {
        appearance: { themeMode: 'light' },
        startup: { openTerminalOnStartup: true },
      },
    });
    expect(conversation.messages.value[1]?.appActions).toEqual([]);
  });

  it('applies legacy non-sensitive AI setting actions immediately in ask mode', async () => {
    const { runner, runAppAction, sendChat } = createRunner('ask');
    sendChat
      .mockResolvedValueOnce(
        '<fleurterm-action>{"type":"settings.updateAi","patch":{"model":"new-model","streamingEnabled":false}}</fleurterm-action>',
      )
      .mockResolvedValueOnce('The AI endpoint and token were updated.');

    await runner.send('set the AI model and disable streaming', snapshot());

    expect(runAppAction).toHaveBeenCalledWith({
      type: 'settings.updateAi',
      patch: {
        model: 'new-model',
        streamingEnabled: false,
      },
    });
    expect(conversation.messages.value[1]?.appActions).toEqual([]);
  });

  it('applies terminal setting actions immediately in ask mode', async () => {
    const { runner, runAppAction, sendChat } = createRunner('ask');
    sendChat
      .mockResolvedValueOnce(
        '<fleurterm-action>{"type":"settings.updateTerminal","patch":{"fontSize":16}}</fleurterm-action>',
      )
      .mockResolvedValueOnce('The terminal font size is now 16.');

    await runner.send('set the terminal font size to 16', snapshot());

    expect(runAppAction).toHaveBeenCalledWith({
      type: 'settings.updateTerminal',
      patch: { fontSize: 16 },
    });
  });

  it('does not leave an apply button after a terminal setting action runs automatically', async () => {
    const { runner, sendChat } = createRunner('ask');
    sendChat
      .mockResolvedValueOnce(
        '<fleurterm-action>{"type":"settings.updateTerminal","patch":{"cursorBlink":false}}</fleurterm-action>',
      )
      .mockResolvedValueOnce('Cursor blinking is disabled.');

    await runner.send('disable terminal cursor blinking', snapshot());

    expect(conversation.messages.value[1]?.appActions).toEqual([]);
  });

  it('opens a saved connection action automatically in ask mode', async () => {
    const { runner, runAppAction, sendChat } = createRunner('ask');
    sendChat
      .mockResolvedValueOnce(
        '<fleurterm-action>{"type":"connection.open","target":"10.7.121.72"}</fleurterm-action>',
      )
      .mockResolvedValueOnce('The SSH terminal is open.');

    await runner.send('open 10.7.121.72', snapshot());

    expect(runAppAction).toHaveBeenCalledWith({
      type: 'connection.open',
      target: '10.7.121.72',
    });
    expect(sendChat).toHaveBeenCalledTimes(2);
    expect(
      conversation.messages.value.some((message) => message.content.includes('<fleurterm-action>')),
    ).toBe(false);
  });

  it('does not create a new terminal after a saved connection fails to open', async () => {
    const { runner, runAppAction, sendChat } = createRunner('auto');
    sendChat.mockResolvedValueOnce(
      [
        '<fleurterm-action>{"type":"connection.open","target":"missing"}</fleurterm-action>',
        '<fleurterm-action>{"type":"terminal.openSsh","host":"missing","user":"root"}</fleurterm-action>',
      ].join('\n'),
    );
    runAppAction.mockResolvedValueOnce({
      callId: 'app-connection.open',
      outcome: 'failed',
      command: 'connection.open',
      output: '',
      truncated: false,
      errorMessage: 'Saved connection "missing" was not found.',
    });

    await runner.send('open missing', snapshot());

    expect(runAppAction).toHaveBeenCalledOnce();
    expect(runAppAction).toHaveBeenCalledWith({ type: 'connection.open', target: 'missing' });
    expect(conversation.messages.value.at(-1)?.content).toBe(
      'Saved connection "missing" was not found.',
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
    expect(conversation.messages.value).toHaveLength(1);
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

function createRunner(
  commandPolicy: AiCommandPolicy,
  savedConnections: Array<{
    id: string;
    name: string;
    method: string;
    host: string;
    user: string;
    port: number;
  }> = [],
) {
  const sendChat = vi.fn();
  const terminalRunner = { execute: vi.fn() };
  const runAppAction = vi.fn(async (action) => ({
    callId: `app-${action.type}`,
    outcome: 'completed' as const,
    command: action.type,
    output: 'submitted',
    truncated: false,
  }));
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
      terminalSettings: ref({ ...defaultTerminalSettings }),
      appearanceSettings: ref(structuredClone(defaultAppearanceSettings)),
      locale: ref<AppLocale>('en-US'),
      shortcutSettings: ref({}),
      startupSettings: ref({ ...defaultStartupSettings }),
    },
    terminalRunner,
    runAppAction,
    listSavedConnections: () => savedConnections,
  });
  return { runner, runAppAction, sendChat, terminalRunner };
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
