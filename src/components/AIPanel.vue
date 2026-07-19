<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

import AIMarkdownInline from '@/components/AIMarkdownInline.vue';
import type { SessionSnapshot } from '@/domain/session';
import { locale } from '@/i18n/locale';
import { sendAiChat, type AiChatMessage } from '@/services/aiClient';
import {
  parseAiAssistantContent,
  type AiAppAction,
  type ParsedAiAppAction,
} from '@/services/aiTerminalCommands';
import {
  parseMarkdownBlocks,
  parseMarkdownInline,
  type MarkdownBlock,
  type MarkdownInlineSegment,
} from '@/services/markdownRenderer';
import { useAiConversationStore } from '@/stores/aiConversationStore';
import { useAppSettingsStore } from '@/stores/appSettingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const props = withDefaults(defineProps<{
  snapshot: SessionSnapshot | null;
  width?: number;
}>(), {
  width: 380,
});

const emit = defineEmits<{
  close: [];
  resize: [width: number];
  runAppAction: [action: AiAppAction];
  runTerminalCommand: [command: string];
}>();

const { aiSettings } = useAppSettingsStore();
const conversation = useAiConversationStore();
const workspaceStore = useWorkspaceStore();
const threadElement = ref<HTMLElement | null>(null);
const streamingAssistantMessageId = ref<string | null>(null);
const resizeState = ref<{ startWidth: number; startX: number } | null>(null);
const MAX_FULL_ACCESS_STEPS = 6;
const TERMINAL_OUTPUT_CONTEXT_BYTES = 16 * 1024;
const TERMINAL_COMMAND_OUTPUT_BYTES = 12 * 1024;
const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH = 720;

const sending = computed(() => conversation.status.value === 'sending');
const configurationReady = computed(() => {
  if (aiSettings.value.provider === 'none') {
    return false;
  }
  if (!aiSettings.value.baseUrl.trim() || !aiSettings.value.model.trim()) {
    return false;
  }
  return aiSettings.value.provider === 'local' || Boolean(aiSettings.value.token.trim());
});
const canSend = computed(() => conversation.draft.value.trim().length > 0 && !sending.value);
const labels = computed(() => (locale.value === 'zh-CN' ? zhAiPanelLabels : enAiPanelLabels));
const sendButtonLabel = computed(() => {
  if (sending.value) {
    return labels.value.sending;
  }
  return configurationReady.value ? labels.value.send : labels.value.checkSettings;
});

watch(
  () => [
    conversation.messages.value.length,
    conversation.messages.value.map((message) => message.content).join('\u0000'),
    conversation.errorMessage.value,
    conversation.status.value,
  ],
  () => {
    void nextTick(scrollThreadToBottom);
  },
  { immediate: true },
);

onBeforeUnmount(stopResize);

async function sendDraft(): Promise<void> {
  const content = conversation.draft.value.trim();
  if (!content || sending.value) {
    return;
  }
  conversation.draft.value = '';
  await sendContent(content);
}

async function retryLastFailedMessage(): Promise<void> {
  const failedMessage = conversation.lastFailedUserMessage.value;
  if (failedMessage === undefined || sending.value) {
    return;
  }
  conversation.removeMessage(failedMessage.id);
  await sendContent(failedMessage.content);
}

function clearConversation(): void {
  if (sending.value) {
    abortCurrentRequest();
  }
  conversation.clearConversation();
}

function abortCurrentRequest(): void {
  conversation.activeAbortController.value?.abort();
}

function startResize(event: PointerEvent): void {
  event.preventDefault();
  resizeState.value = {
    startWidth: props.width,
    startX: event.clientX,
  };
  window.addEventListener('pointermove', handleResizeMove);
  window.addEventListener('pointerup', stopResize);
  document.body.classList.add('ai-panel-resizing');
}

function handleResizeMove(event: PointerEvent): void {
  const state = resizeState.value;
  if (state === null) {
    return;
  }
  const viewportMaximum = Math.max(MIN_PANEL_WIDTH, window.innerWidth - 360);
  const maximumWidth = Math.min(MAX_PANEL_WIDTH, viewportMaximum);
  emit(
    'resize',
    clamp(state.startWidth + state.startX - event.clientX, MIN_PANEL_WIDTH, maximumWidth),
  );
}

function stopResize(): void {
  resizeState.value = null;
  window.removeEventListener('pointermove', handleResizeMove);
  window.removeEventListener('pointerup', stopResize);
  document.body.classList.remove('ai-panel-resizing');
}

function handleComposerKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey) {
    return;
  }
  event.preventDefault();
  void sendDraft();
}

async function sendContent(content: string): Promise<void> {
  conversation.setErrorMessage(null);
  const requestMessages = buildRequestMessages(content);
  const userMessage = conversation.appendUserMessage(content);
  const abortController = new AbortController();
  const fullAccessEnabled = aiSettings.value.commandPolicy === 'fullAccess';
  const streamingAssistantMessage = aiSettings.value.streamingEnabled || fullAccessEnabled
    ? conversation.appendAssistantMessage('')
    : null;
  streamingAssistantMessageId.value = streamingAssistantMessage?.id ?? null;
  conversation.setActiveAbortController(abortController);
  conversation.setStatus('sending');
  try {
    if (fullAccessEnabled) {
      await runFullAccessConversation(requestMessages, streamingAssistantMessage);
    } else {
      const answer = await runAiTurn(requestMessages, streamingAssistantMessage, '');
      const parsedAnswer = parseAiAssistantContent(answer);
      if (streamingAssistantMessage === null) {
        conversation.appendAssistantMessage(
          parsedAnswer.displayContent || answer,
          parsedAnswer.terminalCommands,
          parsedAnswer.appActions,
        );
      } else {
        conversation.updateMessage(streamingAssistantMessage.id, {
          content: parsedAnswer.displayContent || answer,
          terminalCommands: parsedAnswer.terminalCommands,
          appActions: parsedAnswer.appActions,
        });
      }
      if (aiSettings.value.commandPolicy === 'auto') {
        parsedAnswer.terminalCommands.forEach((command) => runTerminalCommand(command.command));
        parsedAnswer.appActions.forEach((action) => runAppAction(action.action));
      }
    }
  } catch (error) {
    if (streamingAssistantMessage !== null) {
      conversation.removeMessage(streamingAssistantMessage.id);
    }
    conversation.failMessage(userMessage.id);
    conversation.setErrorMessage(resolveRequestErrorMessage(error));
  } finally {
    if (streamingAssistantMessageId.value === streamingAssistantMessage?.id) {
      streamingAssistantMessageId.value = null;
    }
    if (conversation.activeAbortController.value === abortController) {
      conversation.setActiveAbortController(null);
    }
    conversation.setStatus('idle');
  }
}

async function runFullAccessConversation(
  requestMessages: AiChatMessage[],
  assistantMessage: ReturnType<typeof conversation.appendAssistantMessage> | null,
): Promise<void> {
  if (assistantMessage === null) {
    return;
  }

  let visibleContent = '';
  for (let step = 0; step < MAX_FULL_ACCESS_STEPS; step += 1) {
    const answer = await runAiTurn(requestMessages, assistantMessage, visibleContent);
    const parsedAnswer = parseAiAssistantContent(answer);
    const displayContent = parsedAnswer.displayContent || answer;
    visibleContent = appendAssistantSection(visibleContent, displayContent);
    conversation.updateMessage(assistantMessage.id, {
      content: visibleContent,
      terminalCommands: parsedAnswer.terminalCommands,
      appActions: parsedAnswer.appActions,
    });

    parsedAnswer.appActions.forEach((action) => runAppAction(action.action));
    if (parsedAnswer.terminalCommands.length === 0) {
      return;
    }

    if (step === MAX_FULL_ACCESS_STEPS - 1) {
      conversation.updateMessage(assistantMessage.id, {
        content: appendAssistantSection(
          visibleContent,
          labels.value.fullAccessStepLimit,
        ),
      });
      return;
    }

    const terminalResults: Array<{ command: string; output: string }> = [];
    for (const command of parsedAnswer.terminalCommands) {
      terminalResults.push({
        command: command.command,
        output: await runTerminalCommandAndReadOutput(command.command),
      });
    }
    requestMessages.push(
      { role: 'assistant', content: answer },
      {
        role: 'system',
        content: [
          'Terminal command results are available below. Analyze them and continue the task.',
          ...terminalResults.map(formatTerminalResult),
        ].join('\n\n'),
      },
    );
  }
}

async function runAiTurn(
  requestMessages: AiChatMessage[],
  assistantMessage: ReturnType<typeof conversation.appendAssistantMessage> | null,
  prefix: string,
): Promise<string> {
  let streamedAnswer = '';
  const answer = await sendAiChat(aiSettings.value, requestMessages, {
    onDelta:
      assistantMessage === null
        ? undefined
        : (delta) => {
            streamedAnswer += delta;
            conversation.updateMessage(assistantMessage.id, {
              content: appendAssistantSection(prefix, streamedAnswer),
            });
          },
    signal: conversation.activeAbortController.value?.signal,
  });
  return answer || streamedAnswer;
}

function buildRequestMessages(content: string): AiChatMessage[] {
  const requestMessages: AiChatMessage[] = [
    {
      role: 'system',
      content:
        'You are FleurTerm AI. You can operate the FleurTerm application through action tags. Use <terminal-command>...</terminal-command> for simple input to the active terminal. Use <fleurterm-action>{"type":"terminal.write","input":"pwd"}</fleurterm-action> to write to the active terminal, <fleurterm-action>{"type":"terminal.openLocal","shell":"pwsh","cwd":"D:\\\\Project","title":"Project"}</fleurterm-action> to open a local terminal, <fleurterm-action>{"type":"terminal.openSsh","host":"example.com","user":"root","port":22,"title":"SSH example"}</fleurterm-action> to open an SSH terminal, <fleurterm-action>{"type":"settings.updateTerminal","patch":{"fontSize":14,"scrollback":50000}}</fleurterm-action> to update terminal settings, <fleurterm-action>{"type":"settings.updateAi","patch":{"commandPolicy":"ask"}}</fleurterm-action> to update AI settings, <fleurterm-action>{"type":"settings.setLocale","locale":"zh-CN"}</fleurterm-action> to change language, and <fleurterm-action>{"type":"settings.open"}</fleurterm-action> to open settings. Do not claim an action has succeeded unless the app executes it or terminal output is provided.',
    },
  ];
  if (
    (aiSettings.value.contextEnabled || aiSettings.value.commandPolicy === 'fullAccess') &&
    props.snapshot !== null
  ) {
    const recentTerminalOutput =
      aiSettings.value.contextEnabled || aiSettings.value.commandPolicy === 'fullAccess'
        ? workspaceStore.getFocusedTerminalOutput(TERMINAL_OUTPUT_CONTEXT_BYTES)
        : '';
    requestMessages.push({
      role: 'system',
      content: [
        `Active terminal state: ${props.snapshot.state}`,
        `Shell: ${props.snapshot.shell}`,
        `Command policy: ${aiSettings.value.commandPolicy}`,
        'If command policy is suggest, explain commands but do not request terminal execution unless explicitly asked.',
        'If command policy is ask, requested commands will require user confirmation.',
        'If command policy is auto, requested commands may be written to the terminal automatically.',
        'If command policy is fullAccess, terminal commands will be executed automatically and command output will be returned to you for the next step.',
        recentTerminalOutput ? `Recent terminal output:\n${recentTerminalOutput}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }
  requestMessages.push(
    ...conversation.messages.value
      .filter((message) => message.status === 'sent')
      .map((message) => ({
        role: message.role,
        content: message.content,
      })),
    { role: 'user', content },
  );
  return requestMessages;
}

function resolveRequestErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return labels.value.requestStopped;
  }
  return error instanceof Error ? error.message : labels.value.requestFailed;
}

function scrollThreadToBottom(): void {
  const element = threadElement.value;
  if (element === null) {
    return;
  }
  element.scrollTop = element.scrollHeight;
}

function runTerminalCommand(command: string): void {
  emit('runTerminalCommand', command);
}

async function runTerminalCommandAndReadOutput(command: string): Promise<string> {
  const cursor = workspaceStore.getFocusedTerminalOutputCursor();
  if (cursor === null) {
    throw new Error('No active terminal session');
  }
  const input = command.endsWith('\r') || command.endsWith('\n') ? command : `${command}\r`;
  await workspaceStore.writeToFocusedSession(input);
  return workspaceStore.waitForFocusedTerminalOutput(cursor, {
    maxBytes: TERMINAL_COMMAND_OUTPUT_BYTES,
  });
}

function runAppAction(action: AiAppAction): void {
  emit('runAppAction', action);
}

function appActionLabel(action: ParsedAiAppAction): string {
  switch (action.action.type) {
    case 'terminal.write':
      return labels.value.run;
    case 'terminal.openLocal':
      return labels.value.openTerminal;
    case 'terminal.openSsh':
      return labels.value.openSsh;
    case 'settings.updateTerminal':
    case 'settings.updateAi':
    case 'settings.setLocale':
      return labels.value.apply;
    case 'settings.open':
      return labels.value.openSettings;
  }
}

function appendAssistantSection(currentContent: string, nextContent: string): string {
  const normalizedNextContent = nextContent.trim();
  if (!normalizedNextContent) {
    return currentContent;
  }
  return currentContent.trim()
    ? `${currentContent.trim()}\n\n${normalizedNextContent}`
    : normalizedNextContent;
}

function formatTerminalResult(result: { command: string; output: string }): string {
  return [
    `Command: ${result.command}`,
    'Output:',
    result.output.trim() || labels.value.noOutputBeforeTimeout,
  ].join('\n');
}

function renderMarkdown(content: string): MarkdownBlock[] {
  return parseMarkdownBlocks(content);
}

function renderInline(content: string): MarkdownInlineSegment[] {
  return parseMarkdownInline(content);
}

function markdownBlockKey(block: MarkdownBlock, index: number): string {
  return `${block.type}-${index}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(Math.round(value), minimum), maximum);
}

const enAiPanelLabels = {
  apply: 'Apply',
  ariaLabel: 'AI panel',
  assistantTitle: 'Assistant',
  checkSettings: 'Check settings',
  clear: 'New',
  closeAria: 'Close AI panel',
  composerPlaceholder: 'Ask about the terminal session',
  composerAria: 'AI prompt',
  fullAccessStepLimit: 'Full access step limit reached. Review the terminal output before continuing.',
  noOutputBeforeTimeout: '(no output before timeout)',
  openSettings: 'Open settings',
  openSsh: 'Open SSH',
  openTerminal: 'Open terminal',
  requestFailed: 'AI request failed.',
  requestStopped: 'AI request stopped.',
  retry: 'Retry',
  run: 'Run',
  send: 'Send',
  sending: 'Sending...',
  stop: 'Stop',
  thinking: 'Thinking...',
};

const zhAiPanelLabels: typeof enAiPanelLabels = {
  apply: '应用',
  ariaLabel: 'AI 面板',
  assistantTitle: '助手',
  checkSettings: '检查设置',
  clear: '新会话',
  closeAria: '关闭 AI 面板',
  composerPlaceholder: '询问当前终端会话',
  composerAria: 'AI 输入',
  fullAccessStepLimit: '已达到完全访问步骤上限。继续前请检查终端输出。',
  noOutputBeforeTimeout: '（超时前没有输出）',
  openSettings: '打开设置',
  openSsh: '打开 SSH',
  openTerminal: '打开终端',
  requestFailed: 'AI 请求失败。',
  requestStopped: 'AI 请求已停止。',
  retry: '重试',
  run: '运行',
  send: '发送',
  sending: '发送中...',
  stop: '停止',
  thinking: '思考中...',
};
</script>

<template>
  <aside class="ai-panel" :aria-label="labels.ariaLabel">
    <div
      class="ai-panel-resize-handle"
      role="separator"
      aria-orientation="vertical"
      :aria-valuenow="width"
      :aria-valuemin="MIN_PANEL_WIDTH"
      :aria-valuemax="MAX_PANEL_WIDTH"
      tabindex="0"
      @pointerdown="startResize"
    />
    <header class="ai-panel-header">
      <div>
        <span class="ai-panel-eyebrow">AI</span>
        <strong>{{ labels.assistantTitle }}</strong>
      </div>
      <div class="ai-panel-header-actions">
        <button
          class="ai-panel-action"
          type="button"
          :disabled="!conversation.hasConversationHistory.value && !conversation.draft.value"
          @click="clearConversation"
        >
          {{ labels.clear }}
        </button>
        <button
          class="ai-panel-close"
          type="button"
          :aria-label="labels.closeAria"
          @click="emit('close')"
        >
          <span />
        </button>
      </div>
    </header>

    <div ref="threadElement" class="ai-panel-thread">
      <section
        v-for="message in conversation.messages.value"
        :key="message.id"
        class="ai-message"
        :class="[`ai-message-${message.role}`, { 'is-failed': message.status === 'failed' }]"
      >
        <div class="ai-message-content">
          <span
            v-if="message.role === 'assistant' && message.content.length === 0"
            class="ai-message-cursor"
            aria-hidden="true"
          />
          <template
            v-for="(block, blockIndex) in renderMarkdown(message.content)"
            :key="markdownBlockKey(block, blockIndex)"
          >
            <component
              :is="`h${block.level}`"
              v-if="block.type === 'heading'"
              class="ai-markdown-heading"
            >
              <AIMarkdownInline :segments="renderInline(block.content)" />
            </component>
            <p v-else-if="block.type === 'paragraph'">
              <AIMarkdownInline :segments="renderInline(block.content)" />
            </p>
            <blockquote v-else-if="block.type === 'blockquote'" class="ai-markdown-quote">
              <AIMarkdownInline :segments="renderInline(block.content)" />
            </blockquote>
            <component
              :is="block.ordered ? 'ol' : 'ul'"
              v-else-if="block.type === 'list'"
              class="ai-markdown-list"
            >
              <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
                <AIMarkdownInline :segments="renderInline(item)" />
              </li>
            </component>
            <figure v-else-if="block.type === 'code'" class="ai-markdown-code-block">
              <figcaption v-if="block.language">{{ block.language }}</figcaption>
              <pre><code>{{ block.content }}</code></pre>
            </figure>
            <div v-else-if="block.type === 'table'" class="ai-markdown-table-wrap">
              <table class="ai-markdown-table">
                <thead>
                  <tr>
                    <th
                      v-for="(header, headerIndex) in block.headers"
                      :key="headerIndex"
                      :class="`is-${block.alignments[headerIndex] ?? 'left'}`"
                    >
                      <AIMarkdownInline :segments="renderInline(header)" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, rowIndex) in block.rows" :key="rowIndex">
                    <td
                      v-for="(cell, cellIndex) in row"
                      :key="cellIndex"
                      :class="`is-${block.alignments[cellIndex] ?? 'left'}`"
                    >
                      <AIMarkdownInline :segments="renderInline(cell)" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <hr v-else class="ai-markdown-rule" />
          </template>
        </div>
        <button
          v-if="message.status === 'failed'"
          class="ai-message-retry"
          type="button"
          :disabled="sending"
          @click="retryLastFailedMessage"
        >
          {{ labels.retry }}
        </button>
        <div
          v-if="
            message.role === 'assistant' &&
            aiSettings.commandPolicy === 'ask' &&
            (message.terminalCommands.length > 0 || message.appActions.length > 0)
          "
          class="ai-terminal-actions"
        >
          <button
            v-for="command in message.terminalCommands"
            :key="command.id"
            class="ai-terminal-run"
            type="button"
            @click="runTerminalCommand(command.command)"
          >
            {{ labels.run }}
          </button>
          <button
            v-for="action in message.appActions"
            :key="action.id"
            class="ai-terminal-run"
            type="button"
            @click="runAppAction(action.action)"
          >
            {{ appActionLabel(action) }}
          </button>
        </div>
      </section>
      <section
        v-if="sending && streamingAssistantMessageId === null"
        class="ai-message ai-message-assistant ai-message-pending"
      >
        <p>{{ labels.thinking }}</p>
      </section>
      <div v-if="conversation.errorMessage.value" class="ai-panel-error" role="alert">
        <span>{{ conversation.errorMessage.value }}</span>
        <button
          v-if="conversation.lastFailedUserMessage.value"
          type="button"
          :disabled="sending"
          @click="retryLastFailedMessage"
        >
          {{ labels.retry }}
        </button>
      </div>
    </div>

    <footer class="ai-panel-composer">
      <textarea
        v-model="conversation.draft.value"
        rows="4"
        :placeholder="labels.composerPlaceholder"
        :aria-label="labels.composerAria"
        @keydown="handleComposerKeyDown"
      />
      <div class="ai-panel-composer-actions">
        <button
          v-if="sending"
          class="ai-panel-send ai-panel-stop"
          type="button"
          @click="abortCurrentRequest"
        >
          {{ labels.stop }}
        </button>
        <button
          class="ai-panel-send"
          type="button"
          :disabled="!canSend"
          @click="sendDraft"
        >
          {{ sendButtonLabel }}
        </button>
      </div>
    </footer>
  </aside>
</template>
