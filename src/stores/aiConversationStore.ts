import { computed, ref } from 'vue';

import type { AiTerminalToolCall } from '@/services/aiToolProtocol';
import type { ParsedAiAppAction, ParsedAiTerminalCommand } from '@/services/aiTerminalCommands';

export type AiConversationRole = 'assistant' | 'user';
export type AiConversationStatus =
  | 'idle'
  | 'sending'
  | 'thinking'
  | 'streaming'
  | 'awaitingApproval'
  | 'runningTool'
  | 'waitingTerminal'
  | 'blocked'
  | 'continuing'
  | 'failed'
  | 'stopped';

export type AiToolDecision =
  'approved' | 'denied' | 'continueWaiting' | 'interrupt' | 'usePartialOutput' | 'cancelled';

export interface AiConversationMessage {
  id: string;
  role: AiConversationRole;
  content: string;
  createdAt: number;
  status: 'sent' | 'failed';
  terminalCommands: ParsedAiTerminalCommand[];
  appActions: ParsedAiAppAction[];
}

const messages = ref<AiConversationMessage[]>([]);
const draft = ref('');
const status = ref<AiConversationStatus>('idle');
const errorMessage = ref<string | null>(null);
const activeAbortController = ref<AbortController | null>(null);
const activeTurnId = ref<string | null>(null);
const toolCalls = ref<AiTerminalToolCall[]>([]);
const pendingToolDecisionResolvers = new Map<string, (decision: AiToolDecision) => void>();
const hasConversationHistory = computed(() => messages.value.length > 0);
const turnActive = computed(() => !['idle', 'failed', 'stopped'].includes(status.value));
const lastFailedUserMessage = computed(() =>
  [...messages.value]
    .reverse()
    .find((message) => message.role === 'user' && message.status === 'failed'),
);

export function useAiConversationStore() {
  return {
    activeAbortController,
    activeTurnId,
    draft,
    errorMessage,
    hasConversationHistory,
    lastFailedUserMessage,
    messages,
    status,
    toolCalls,
    turnActive,
    appendAssistantMessage,
    appendToolCall,
    appendUserMessage,
    beginTurn,
    clearConversation,
    failMessage,
    finishTurn,
    removeMessage,
    resolveToolDecision,
    setActiveAbortController,
    setErrorMessage,
    setStatus,
    stopTurn,
    updateToolCall,
    updateMessage,
    waitForToolDecision,
  };
}

function appendUserMessage(content: string): AiConversationMessage {
  const message = createMessage('user', content, [], []);
  messages.value = [...messages.value, message];
  return message;
}

function appendAssistantMessage(
  content: string,
  terminalCommands: ParsedAiTerminalCommand[] = [],
  appActions: ParsedAiAppAction[] = [],
): AiConversationMessage {
  const message = createMessage('assistant', content, terminalCommands, appActions);
  messages.value = [...messages.value, message];
  return message;
}

function failMessage(messageId: string): void {
  messages.value = messages.value.map((message) =>
    message.id === messageId ? { ...message, status: 'failed' } : message,
  );
}

function removeMessage(messageId: string): void {
  messages.value = messages.value.filter((message) => message.id !== messageId);
}

function updateMessage(
  messageId: string,
  patch: Partial<
    Pick<AiConversationMessage, 'appActions' | 'content' | 'status' | 'terminalCommands'>
  >,
): void {
  messages.value = messages.value.map((message) =>
    message.id === messageId ? { ...message, ...patch } : message,
  );
}

function clearConversation(): void {
  cancelPendingToolDecisions();
  messages.value = [];
  toolCalls.value = [];
  activeTurnId.value = null;
  activeAbortController.value?.abort();
  activeAbortController.value = null;
  status.value = 'idle';
  errorMessage.value = null;
  draft.value = '';
}

function appendToolCall(toolCall: AiTerminalToolCall): void {
  toolCalls.value = [...toolCalls.value, toolCall];
}

function updateToolCall(toolCallId: string, patch: Partial<AiTerminalToolCall>): void {
  toolCalls.value = toolCalls.value.map((toolCall) =>
    toolCall.id === toolCallId ? { ...toolCall, ...patch } : toolCall,
  );
}

function beginTurn(turnId: string): void {
  cancelPendingToolDecisions();
  activeTurnId.value = turnId;
  errorMessage.value = null;
  status.value = 'thinking';
}

function finishTurn(): void {
  cancelPendingToolDecisions();
  activeTurnId.value = null;
  activeAbortController.value = null;
  status.value = 'idle';
}

function stopTurn(): void {
  activeAbortController.value?.abort();
  activeAbortController.value = null;
  const completedAt = Date.now();
  toolCalls.value = toolCalls.value.map((toolCall) =>
    toolCall.status === 'proposed' ? { ...toolCall, status: 'cancelled', completedAt } : toolCall,
  );
  cancelPendingToolDecisions();
  activeTurnId.value = null;
  status.value = 'stopped';
}

function waitForToolDecision(toolCallId: string): Promise<AiToolDecision> {
  resolveToolDecision(toolCallId, 'cancelled');
  return new Promise((resolve) => {
    pendingToolDecisionResolvers.set(toolCallId, resolve);
  });
}

function resolveToolDecision(toolCallId: string, decision: AiToolDecision): void {
  const resolveDecision = pendingToolDecisionResolvers.get(toolCallId);
  if (!resolveDecision) {
    return;
  }
  pendingToolDecisionResolvers.delete(toolCallId);
  resolveDecision(decision);
}

function cancelPendingToolDecisions(): void {
  for (const resolveDecision of pendingToolDecisionResolvers.values()) {
    resolveDecision('cancelled');
  }
  pendingToolDecisionResolvers.clear();
}

function setStatus(nextStatus: AiConversationStatus): void {
  status.value = nextStatus;
}

function setErrorMessage(nextErrorMessage: string | null): void {
  errorMessage.value = nextErrorMessage;
}

function setActiveAbortController(nextController: AbortController | null): void {
  activeAbortController.value = nextController;
}

function createMessage(
  role: AiConversationRole,
  content: string,
  terminalCommands: ParsedAiTerminalCommand[],
  appActions: ParsedAiAppAction[],
): AiConversationMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    createdAt: Date.now(),
    status: 'sent',
    terminalCommands,
    appActions,
  };
}
