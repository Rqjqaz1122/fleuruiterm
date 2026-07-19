import { computed, ref } from 'vue';

import type { ParsedAiAppAction, ParsedAiTerminalCommand } from '@/services/aiTerminalCommands';

export type AiConversationRole = 'assistant' | 'user';
export type AiConversationStatus = 'idle' | 'sending';

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
const hasConversationHistory = computed(() => messages.value.length > 0);
const lastFailedUserMessage = computed(() =>
  [...messages.value].reverse().find((message) => message.role === 'user' && message.status === 'failed'),
);

export function useAiConversationStore() {
  return {
    activeAbortController,
    draft,
    errorMessage,
    hasConversationHistory,
    lastFailedUserMessage,
    messages,
    status,
    appendAssistantMessage,
    appendUserMessage,
    clearConversation,
    failMessage,
    removeMessage,
    setActiveAbortController,
    setErrorMessage,
    setStatus,
    updateMessage,
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
  messages.value = [];
  errorMessage.value = null;
  draft.value = '';
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
