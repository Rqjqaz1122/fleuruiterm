import type { Ref } from 'vue';

import type { SessionSnapshot } from '@/domain/session';
import type { AppLocale } from '@/i18n/locale';
import type {
  AiSettings,
  AppearanceSettings,
  StartupSettings,
  TerminalSettings,
} from '@/stores/appSettingsStore';
import type { ShortcutSettings } from '@/services/appShortcuts';
import { type AiToolDecision, useAiConversationStore } from '@/stores/aiConversationStore';

import { classifyTerminalCommand } from './aiCommandRisk';
import { sendAiChat, type AiChatMessage } from './aiClient';
import { permitsTerminalExecution } from './aiTerminalExecutionPolicy';
import {
  formatToolResultMessage,
  parseAssistantToolResponse,
  stripAssistantToolMarkup,
  type AiAppAction,
  type AiTerminalToolCall,
  type AiToolResult,
  type ParsedAiAppAction,
} from './aiToolProtocol';
import type { TerminalToolRunner } from './terminalToolRunner';
import type { SavedConnectionSummary } from './connectionProfiles';

const MAX_EXECUTED_TOOL_CALLS = 6;
const MAX_MODEL_STEPS = 12;
const SYSTEM_PROMPT = [
  'You are FleurTerm AI.',
  'Use <terminal-command>...</terminal-command> when terminal interaction is required.',
  'Only request terminal execution when the current user request asks for an action or requires fresh terminal state to complete the task.',
  'When the user asks what command was executed or asks to explain a command, answer from conversation history without requesting terminal execution.',
  'When describing an executed command, report the original Command field from the labeled tool result, never an internal shell wrapper or echoed completion marker.',
  'Markdown code fences are display-only and never execute commands.',
  'Use <fleurterm-action>{"type":"terminal.activate","target":"tab title or id"}</fleurterm-action> to switch to an existing terminal tab.',
  'Use <fleurterm-action>{"type":"connection.open","target":"saved connection id, name, host, or user@host"}</fleurterm-action> when the user asks to open a saved connection. Emit the action instead of merely saying that the connection was requested.',
  'Use terminal.openLocal or terminal.openSsh only when the user explicitly asks to create a new terminal, never as a fallback when terminal.activate or connection.open reports that a target was not found.',
  'Use <fleurterm-action>{"type":"settings.update","patch":{"terminal":{"fontSize":16}}}</fleurterm-action> whenever the user asks to change application settings. Include only requested fields. Supported groups: locale (en-US or zh-CN); startup.openTerminalOnStartup; appearance.themeMode (system, dark, light), appearance.palettes.dark/light.terminalForeground/terminalMuted (six-digit hex colors), appearance.transparency.enabled/opacity (0-100)/blur (0-32); terminal.fontFamily/fontSize (10-24)/lineHeight (1-1.8)/scrollback (1000-100000)/scrollOnInput/cursorBlink; ai.provider/model/tokenHeaderName/tokenPrefix/streamingEnabled/contextEnabled/includeWorkingDirectory/commandPolicy/reasoningEffort (xhigh, high, medium, low); and shortcuts keyed by application command. ai.baseUrl and ai.token are read-only and must never be included in an action. This action applies immediately.',
  'Use <fleurterm-action>{"type":"settings.open"}</fleurterm-action> to open settings.',
  'After a terminal command is denied, do not request the same command again in the current turn. Explain the denial or choose a materially different safe action.',
  'Do not claim an action succeeded until a labeled tool result confirms it.',
].join(' ');
const STEP_LIMIT_MESSAGE =
  'The terminal tool step limit has been reached. Review the current output before starting another request.';
const REPEATED_DENIED_MESSAGE =
  'The same terminal command was not requested again because it was denied in this turn.';

type ConversationStore = ReturnType<typeof useAiConversationStore>;

export interface AiConversationRunnerDependencies {
  sendChat: typeof sendAiChat;
  conversation: ConversationStore;
  settings: {
    aiSettings: Ref<AiSettings>;
    appearanceSettings: Ref<AppearanceSettings>;
    locale: Ref<AppLocale>;
    shortcutSettings: Ref<ShortcutSettings>;
    startupSettings: Ref<StartupSettings>;
    terminalSettings: Ref<TerminalSettings>;
  };
  terminalRunner: TerminalToolRunner;
  runAppAction: (action: AiAppAction) => Promise<AiToolResult>;
  listSavedConnections?: () => SavedConnectionSummary[];
}

export interface AiConversationRunner {
  send(content: string, snapshot: SessionSnapshot | null): Promise<void>;
  stop(): void;
  approve(callId: string): void;
  deny(callId: string): void;
  continueWaiting(callId: string): void;
  interrupt(callId: string): void;
  usePartialOutput(callId: string): void;
}

export function createAiConversationRunner(
  dependencies: AiConversationRunnerDependencies,
): AiConversationRunner {
  return {
    send: (content, snapshot) => runConversationTurn(dependencies, content, snapshot),
    stop: () => dependencies.conversation.stopTurn(),
    approve: (callId) => resolveDecision(dependencies.conversation, callId, 'approved'),
    deny: (callId) => resolveDecision(dependencies.conversation, callId, 'denied'),
    continueWaiting: (callId) =>
      resolveDecision(dependencies.conversation, callId, 'continueWaiting'),
    interrupt: (callId) => resolveDecision(dependencies.conversation, callId, 'interrupt'),
    usePartialOutput: (callId) =>
      resolveDecision(dependencies.conversation, callId, 'usePartialOutput'),
  };
}

async function runConversationTurn(
  dependencies: AiConversationRunnerDependencies,
  content: string,
  snapshot: SessionSnapshot | null,
): Promise<void> {
  const prompt = content.trim();
  if (!prompt || dependencies.conversation.turnActive.value) {
    return;
  }

  const turnId = `turn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const abortController = new AbortController();
  const userMessage = dependencies.conversation.appendUserMessage(prompt);
  const requestMessages = buildRequestMessages(
    dependencies.conversation,
    dependencies.settings.aiSettings.value,
    dependencies.settings.appearanceSettings.value,
    dependencies.settings.locale.value,
    dependencies.settings.shortcutSettings.value,
    dependencies.settings.startupSettings.value,
    dependencies.settings.terminalSettings.value,
    snapshot,
    dependencies.listSavedConnections?.() ?? [],
  );
  dependencies.conversation.beginTurn(turnId);
  dependencies.conversation.setActiveAbortController(abortController);
  let executedToolCallCount = 0;
  let pendingAssistantMessageId: string | null = null;
  const deniedCommandSignatures = new Set<string>();
  const terminalCommandVisibility =
    permitsTerminalExecution(prompt) &&
    dependencies.settings.aiSettings.value.commandPolicy !== 'suggest'
      ? 'hidden'
      : 'code';

  try {
    for (let modelStep = 0; modelStep < MAX_MODEL_STEPS; modelStep += 1) {
      dependencies.conversation.setStatus(modelStep === 0 ? 'thinking' : 'continuing');
      const assistantMessage = dependencies.conversation.appendAssistantMessage('');
      pendingAssistantMessageId = assistantMessage.id;
      let streamedContent = '';
      const rawResponse = await dependencies.sendChat(
        dependencies.settings.aiSettings.value,
        requestMessages,
        {
          signal: abortController.signal,
          onDelta: (delta) => {
            if (!streamedContent) {
              dependencies.conversation.setStatus('streaming');
            }
            streamedContent += delta;
            dependencies.conversation.updateMessage(assistantMessage.id, {
              content:
                terminalCommandVisibility === 'hidden'
                  ? stripAssistantToolMarkup(streamedContent)
                  : streamedContent,
            });
          },
        },
      );
      const responseContent = rawResponse || streamedContent;
      const parsedResponse = parseAssistantToolResponse(responseContent, {
        terminalCommandVisibility,
      });
      const requestedToolCalls = permitsTerminalExecution(prompt) ? parsedResponse.toolCalls : [];
      const toolCalls = requestedToolCalls.map((toolCall, index) =>
        prepareToolCall(toolCall, turnId, modelStep, index, snapshot),
      );
      dependencies.conversation.updateMessage(assistantMessage.id, {
        content: visibleAssistantContent(responseContent, parsedResponse),
        terminalCommands: toolCalls.map(({ id, command }) => ({ id, command })),
        appActions: interactiveAppActions(parsedResponse.appActions),
      });
      pendingAssistantMessageId = null;
      requestMessages.push({ role: 'assistant', content: responseContent });

      const appActionResults = await runAutomaticAppActions(
        dependencies,
        parsedResponse.appActions.map(({ action }) => action),
      );
      appendToolResults(requestMessages, appActionResults);
      const missingTerminalResult = appActionResults.find(
        (result) =>
          (result.command === 'terminal.activate' || result.command === 'connection.open') &&
          result.outcome === 'failed',
      );
      if (missingTerminalResult !== undefined) {
        dependencies.conversation.appendAssistantMessage(
          missingTerminalResult.errorMessage || 'The requested terminal was not found.',
        );
        return;
      }

      if (dependencies.settings.aiSettings.value.commandPolicy === 'suggest') {
        return;
      }

      if (toolCalls.length === 0 && appActionResults.length === 0) {
        return;
      }

      const terminalResults: AiToolResult[] = [];
      let repeatedDeniedCommand = false;
      for (const toolCall of toolCalls) {
        const commandSignature = terminalCommandSignature(toolCall.command);
        if (deniedCommandSignatures.has(commandSignature)) {
          repeatedDeniedCommand = true;
          continue;
        }
        if (executedToolCallCount >= MAX_EXECUTED_TOOL_CALLS) {
          dependencies.conversation.appendAssistantMessage(STEP_LIMIT_MESSAGE);
          return;
        }
        dependencies.conversation.appendToolCall(toolCall);
        const approved = await approveTerminalToolCall(dependencies, toolCall);
        if (approved === 'cancelled') {
          return;
        }
        if (approved === 'denied') {
          deniedCommandSignatures.add(commandSignature);
          terminalResults.push(deniedResult(toolCall));
          continue;
        }

        executedToolCallCount += 1;
        dependencies.conversation.setStatus('runningTool');
        const result = await dependencies.terminalRunner.execute(toolCall, {
          shell: snapshot?.shell ?? '',
          signal: abortController.signal,
          onPhase: (phase) => {
            if (dependencies.conversation.status.value === 'stopped') {
              return;
            }
            dependencies.conversation.setStatus(phase);
          },
        });
        if (abortController.signal.aborted) {
          return;
        }
        terminalResults.push(result);
      }
      appendToolResults(requestMessages, terminalResults);
      if (repeatedDeniedCommand) {
        dependencies.conversation.appendAssistantMessage(REPEATED_DENIED_MESSAGE);
        return;
      }
    }

    dependencies.conversation.appendAssistantMessage(STEP_LIMIT_MESSAGE);
  } catch (error) {
    if (abortController.signal.aborted) {
      removeEmptyAssistantMessage(dependencies.conversation, pendingAssistantMessageId);
      return;
    }
    dependencies.conversation.failMessage(userMessage.id);
    dependencies.conversation.setErrorMessage(
      error instanceof Error ? error.message : 'AI request failed.',
    );
    dependencies.conversation.setStatus('failed');
  } finally {
    if (dependencies.conversation.activeAbortController.value === abortController) {
      dependencies.conversation.setActiveAbortController(null);
    }
    const finalStatus = dependencies.conversation.status.value;
    if (finalStatus !== 'failed' && finalStatus !== 'stopped') {
      dependencies.conversation.finishTurn();
    }
  }
}

function buildRequestMessages(
  conversation: ConversationStore,
  aiSettings: AiSettings,
  appearanceSettings: AppearanceSettings,
  locale: AppLocale,
  shortcutSettings: ShortcutSettings,
  startupSettings: StartupSettings,
  terminalSettings: TerminalSettings,
  snapshot: SessionSnapshot | null,
  savedConnections: SavedConnectionSummary[],
): AiChatMessage[] {
  const messages: AiChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  const nonSecretAiSettings = { ...aiSettings, token: undefined };
  messages.push({
    role: 'system',
    content: `Current application settings: ${JSON.stringify({
      locale,
      startup: startupSettings,
      appearance: appearanceSettings,
      terminal: terminalSettings,
      ai: nonSecretAiSettings,
      shortcuts: shortcutSettings,
    })}`,
  });
  if (savedConnections.length > 0) {
    messages.push({
      role: 'system',
      content: `Available saved connections: ${JSON.stringify(savedConnections)}`,
    });
  }
  if (snapshot !== null) {
    messages.push({
      role: 'system',
      content: [
        `Active terminal state: ${snapshot.state}`,
        `Shell: ${snapshot.shell}`,
        `Command policy: ${aiSettings.commandPolicy}`,
      ].join('\n'),
    });
  }
  messages.push(
    ...conversation.messages.value
      .filter((message) => message.status === 'sent')
      .map((message) => ({ role: message.role, content: message.content })),
  );
  return messages;
}

function prepareToolCall(
  toolCall: AiTerminalToolCall,
  turnId: string,
  modelStep: number,
  toolIndex: number,
  snapshot: SessionSnapshot | null,
): AiTerminalToolCall {
  return {
    ...toolCall,
    id: `${turnId}-${modelStep}-${toolIndex}-${toolCall.id}`,
    targetSessionId: snapshot?.sessionId ?? null,
    risk: classifyTerminalCommand(toolCall.command),
  };
}

async function approveTerminalToolCall(
  dependencies: AiConversationRunnerDependencies,
  toolCall: AiTerminalToolCall,
): Promise<'approved' | 'denied' | 'cancelled'> {
  const policy = dependencies.settings.aiSettings.value.commandPolicy;
  const requiresApproval = policy === 'ask' || (policy === 'auto' && toolCall.risk !== 'safe');
  if (!requiresApproval) {
    dependencies.conversation.updateToolCall(toolCall.id, { status: 'approved' });
    return 'approved';
  }

  dependencies.conversation.setStatus('awaitingApproval');
  const decision = await dependencies.conversation.waitForToolDecision(toolCall.id);
  if (decision === 'approved') {
    dependencies.conversation.updateToolCall(toolCall.id, { status: 'approved' });
    return 'approved';
  }
  if (decision === 'denied') {
    dependencies.conversation.updateToolCall(toolCall.id, {
      status: 'denied',
      completedAt: Date.now(),
    });
    return 'denied';
  }
  dependencies.conversation.updateToolCall(toolCall.id, {
    status: 'cancelled',
    completedAt: Date.now(),
  });
  return 'cancelled';
}

function deniedResult(toolCall: AiTerminalToolCall): AiToolResult {
  return {
    callId: toolCall.id,
    outcome: 'denied',
    command: toolCall.command,
    output: 'The user denied this terminal command.',
    truncated: false,
  };
}

function appendToolResults(messages: AiChatMessage[], results: AiToolResult[]): void {
  for (const result of results) {
    messages.push({ role: 'system', content: formatToolResultMessage(result) });
  }
}

async function runAutomaticAppActions(
  dependencies: AiConversationRunnerDependencies,
  actions: AiAppAction[],
): Promise<AiToolResult[]> {
  const policy = dependencies.settings.aiSettings.value.commandPolicy;
  const results: AiToolResult[] = [];
  for (const action of actions) {
    if (!canRunAppActionAutomatically(action, policy)) {
      continue;
    }
    const result = await dependencies.runAppAction(action);
    results.push(result);
    if (
      (action.type === 'terminal.activate' || action.type === 'connection.open') &&
      result.outcome === 'failed'
    ) {
      break;
    }
  }
  return results;
}

function canRunAppActionAutomatically(
  action: AiAppAction,
  policy: AiSettings['commandPolicy'],
): boolean {
  if (
    action.type === 'settings.updateTerminal' ||
    action.type === 'settings.updateAi' ||
    action.type === 'settings.update'
  ) {
    return true;
  }
  if (action.type === 'terminal.activate' || action.type === 'connection.open') {
    return true;
  }
  return policy === 'auto' || policy === 'fullAccess';
}

function interactiveAppActions(actions: ParsedAiAppAction[]): ParsedAiAppAction[] {
  return actions.filter(
    ({ action }) =>
      action.type !== 'settings.updateTerminal' &&
      action.type !== 'settings.updateAi' &&
      action.type !== 'settings.update',
  );
}

function terminalCommandSignature(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

function visibleAssistantContent(
  responseContent: string,
  parsedResponse: ReturnType<typeof parseAssistantToolResponse>,
): string {
  const containsToolMarkup =
    parsedResponse.toolCalls.length > 0 || parsedResponse.appActions.length > 0;
  return containsToolMarkup ? parsedResponse.displayContent : responseContent;
}

function removeEmptyAssistantMessage(
  conversation: ConversationStore,
  messageId: string | null,
): void {
  if (messageId === null) {
    return;
  }
  const message = conversation.messages.value.find((candidate) => candidate.id === messageId);
  if (message?.role === 'assistant' && message.content.length === 0) {
    conversation.removeMessage(messageId);
  }
}

function resolveDecision(
  conversation: ConversationStore,
  callId: string,
  decision: AiToolDecision,
): void {
  conversation.resolveToolDecision(callId, decision);
}
