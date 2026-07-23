<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue';

import AIMarkdownInline from '@/components/AIMarkdownInline.vue';
import AiToolCard from '@/components/AiToolCard.vue';
import type { SessionSnapshot } from '@/domain/session';
import { locale } from '@/i18n/locale';
import { sendAiChat } from '@/services/aiClient';
import {
  createAiConversationRunner,
  type AiConversationRunner,
} from '@/services/aiConversationRunner';
import type { AiAppAction, AiToolResult } from '@/services/aiToolProtocol';
import {
  parseMarkdownBlocks,
  parseMarkdownInline,
  type MarkdownBlock,
  type MarkdownInlineSegment,
} from '@/services/markdownRenderer';
import { createTerminalToolRunner } from '@/services/terminalToolRunner';
import {
  type AiConversationMessage,
  type AiConversationStatus,
  useAiConversationStore,
} from '@/stores/aiConversationStore';
import { useAppSettingsStore } from '@/stores/appSettingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const props = defineProps<{
  snapshot: SessionSnapshot | null;
  width?: number;
  runAppAction?: (action: AiAppAction) => Promise<AiToolResult>;
}>();

const emit = defineEmits<{
  close: [];
  resize: [width: number];
}>();

const settings = useAppSettingsStore();
const conversation = useAiConversationStore();
const workspace = useWorkspaceStore();
const injectedRunner = inject<AiConversationRunner | null>('aiConversationRunner', null);
const terminalRunner = createTerminalToolRunner(workspace, conversation);
const runner =
  injectedRunner ??
  createAiConversationRunner({
    sendChat: sendAiChat,
    conversation,
    settings,
    terminalRunner,
    runAppAction: (action) => runApplicationAction(action),
  });
const threadElement = ref<HTMLElement | null>(null);
const resizeState = ref<{ startWidth: number; startX: number } | null>(null);
const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH = 720;

type TimelineItem =
  | { kind: 'message'; id: string; createdAt: number; message: AiConversationMessage }
  | {
      kind: 'tool';
      id: string;
      createdAt: number;
      toolCall: (typeof conversation.toolCalls.value)[number];
    };

const labels = computed(() => (locale.value === 'zh-CN' ? zhAiPanelLabels : enAiPanelLabels));
const configurationReady = computed(() => {
  const aiSettings = settings.aiSettings.value;
  if (aiSettings.provider === 'none') {
    return false;
  }
  if (!aiSettings.baseUrl.trim() || !aiSettings.model.trim()) {
    return false;
  }
  return aiSettings.provider === 'local' || Boolean(aiSettings.token.trim());
});
const turnActive = computed(() => conversation.turnActive.value);
const canSend = computed(() => conversation.draft.value.trim().length > 0 && !turnActive.value);
const sendButtonLabel = computed(() =>
  turnActive.value
    ? labels.value.stop
    : configurationReady.value
      ? labels.value.send
      : labels.value.checkSettings,
);
const turnStatusLabel = computed(() => labels.value.statuses[conversation.status.value]);
const pendingApprovalCall = computed(
  () => conversation.toolCalls.value.find((toolCall) => toolCall.status === 'proposed') ?? null,
);
const timeline = computed<TimelineItem[]>(() =>
  [
    ...conversation.messages.value.map((message) => ({
      kind: 'message' as const,
      id: message.id,
      createdAt: message.createdAt,
      message,
    })),
    ...conversation.toolCalls.value
      .filter((toolCall) => toolCall.status !== 'proposed')
      .map((toolCall) => ({
        kind: 'tool' as const,
        id: toolCall.id,
        createdAt: toolCall.createdAt,
        toolCall,
      })),
  ].sort((left, right) => left.createdAt - right.createdAt),
);

watch(
  () => [
    conversation.messages.value.length,
    conversation.messages.value.map((message) => message.content).join('\u0000'),
    conversation.toolCalls.value
      .map((toolCall) => `${toolCall.status}:${toolCall.output}`)
      .join('\u0000'),
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
  if (!content || turnActive.value) {
    return;
  }
  conversation.draft.value = '';
  await runner.send(content, props.snapshot);
}

async function retryLastFailedMessage(): Promise<void> {
  const failedMessage = conversation.lastFailedUserMessage.value;
  if (failedMessage === undefined || turnActive.value) {
    return;
  }
  conversation.removeMessage(failedMessage.id);
  await runner.send(failedMessage.content, props.snapshot);
}

function clearConversation(): void {
  if (turnActive.value) {
    runner.stop();
  }
  conversation.clearConversation();
}

function handlePrimaryAction(): void {
  if (turnActive.value) {
    runner.stop();
    return;
  }
  void sendDraft();
}

function handleComposerKeyDown(event: KeyboardEvent): void {
  if (
    event.key !== 'Enter' ||
    event.shiftKey ||
    event.isComposing ||
    event.keyCode === 229 ||
    turnActive.value
  ) {
    return;
  }
  event.preventDefault();
  void sendDraft();
}

function startResize(event: PointerEvent): void {
  event.preventDefault();
  resizeState.value = {
    startWidth: props.width ?? 380,
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

function scrollThreadToBottom(): void {
  const element = threadElement.value;
  if (element !== null) {
    element.scrollTop = element.scrollHeight;
  }
}

async function runApplicationAction(action: AiAppAction): Promise<AiToolResult> {
  if (props.runAppAction) {
    return props.runAppAction(action);
  }
  return {
    callId: `app-${action.type}`,
    outcome: 'failed',
    command: action.type,
    output: '',
    truncated: false,
    errorMessage: 'Application action runner is unavailable',
  };
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

function appActionLabel(action: AiAppAction): string {
  switch (action.type) {
    case 'terminal.write':
      return labels.value.run;
    case 'terminal.activate':
      return labels.value.openTerminal;
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

const enAiPanelLabels = {
  apply: 'Apply',
  approvalDock: 'Terminal command approval',
  ariaLabel: 'AI panel',
  assistantTitle: 'Assistant',
  checkSettings: 'Check settings',
  clear: 'New',
  closeAria: 'Close AI panel',
  composerAria: 'AI prompt',
  composerPlaceholder: 'Ask about the terminal session',
  openSettings: 'Open settings',
  openSsh: 'Open SSH',
  openTerminal: 'Open terminal',
  retry: 'Retry',
  run: 'Run',
  send: 'Send',
  stop: 'Stop',
  statuses: {
    idle: 'Ready',
    sending: 'Thinking',
    thinking: 'Thinking',
    streaming: 'Responding',
    awaitingApproval: 'Waiting for approval',
    runningTool: 'Starting terminal command',
    waitingTerminal: 'Waiting for terminal',
    blocked: 'Waiting for terminal input',
    continuing: 'Continuing',
    failed: 'Request failed',
    stopped: 'Stopped',
  } satisfies Record<AiConversationStatus, string>,
};

const zhAiPanelLabels = {
  apply: '应用',
  approvalDock: '终端命令审批',
  ariaLabel: 'AI 面板',
  assistantTitle: '助手',
  checkSettings: '检查设置',
  clear: '新会话',
  closeAria: '关闭 AI 面板',
  composerAria: 'AI 输入',
  composerPlaceholder: '询问当前终端会话',
  openSettings: '打开设置',
  openSsh: '打开 SSH',
  openTerminal: '打开终端',
  retry: '重试',
  run: '运行',
  send: '发送',
  stop: '停止',
  statuses: {
    idle: '就绪',
    sending: '思考中',
    thinking: '思考中',
    streaming: '正在回复',
    awaitingApproval: '等待批准',
    runningTool: '正在启动终端命令',
    waitingTerminal: '等待终端',
    blocked: '等待终端输入',
    continuing: '正在继续',
    failed: '请求失败',
    stopped: '已停止',
  } satisfies Record<AiConversationStatus, string>,
};
</script>

<template>
  <aside class="ai-panel" :aria-label="labels.ariaLabel">
    <div
      class="ai-panel-resize-handle"
      role="separator"
      aria-orientation="vertical"
      :aria-valuenow="width ?? 380"
      :aria-valuemin="MIN_PANEL_WIDTH"
      :aria-valuemax="MAX_PANEL_WIDTH"
      tabindex="0"
      @pointerdown="startResize"
    />

    <header class="ai-panel-header">
      <div class="ai-panel-title-group">
        <span class="ai-panel-eyebrow">AI</span>
        <div>
          <strong>{{ labels.assistantTitle }}</strong>
          <span class="ai-panel-model">{{ settings.aiSettings.value.model || '—' }}</span>
        </div>
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

    <div class="ai-panel-turn-status" :data-status="conversation.status.value" aria-live="polite">
      <span aria-hidden="true" />
      {{ turnStatusLabel }}
    </div>

    <div ref="threadElement" class="ai-panel-thread">
      <template v-for="item in timeline" :key="`${item.kind}-${item.id}`">
        <section
          v-if="item.kind === 'message'"
          class="ai-message"
          :class="[
            `ai-message-${item.message.role}`,
            { 'is-failed': item.message.status === 'failed' },
          ]"
        >
          <div class="ai-message-content">
            <span
              v-if="
                item.message.role === 'assistant' && item.message.content.length === 0 && turnActive
              "
              class="ai-message-cursor"
              aria-hidden="true"
            />
            <template
              v-for="(block, blockIndex) in renderMarkdown(item.message.content)"
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
                <li v-for="(listItem, listIndex) in block.items" :key="listIndex">
                  <AIMarkdownInline :segments="renderInline(listItem)" />
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
            </template>
          </div>

          <div v-if="item.message.appActions.length" class="ai-message-tools">
            <button
              v-for="appAction in item.message.appActions"
              :key="appAction.id"
              class="ai-terminal-run"
              type="button"
              @click="runApplicationAction(appAction.action)"
            >
              {{ appActionLabel(appAction.action) }}
            </button>
          </div>
        </section>

        <AiToolCard
          v-else
          :call="item.toolCall"
          :locale="locale"
          @approve="runner.approve"
          @deny="runner.deny"
          @continue-waiting="runner.continueWaiting"
          @interrupt="runner.interrupt"
          @use-partial-output="runner.usePartialOutput"
        />
      </template>

      <div v-if="conversation.errorMessage.value" class="ai-panel-error" role="alert">
        <span>{{ conversation.errorMessage.value }}</span>
        <button
          v-if="conversation.lastFailedUserMessage.value"
          type="button"
          @click="retryLastFailedMessage"
        >
          {{ labels.retry }}
        </button>
      </div>
    </div>

    <div class="ai-panel-input-region">
      <Transition name="ai-approval-dock">
        <div
          v-if="pendingApprovalCall"
          class="ai-approval-dock"
          role="region"
          :aria-label="labels.approvalDock"
        >
          <AiToolCard
            :call="pendingApprovalCall"
            :locale="locale"
            @approve="runner.approve"
            @deny="runner.deny"
            @continue-waiting="runner.continueWaiting"
            @interrupt="runner.interrupt"
            @use-partial-output="runner.usePartialOutput"
          />
        </div>
      </Transition>

      <footer class="ai-panel-composer">
        <div class="ai-panel-composer-shell">
          <textarea
            v-model="conversation.draft.value"
            rows="4"
            :placeholder="labels.composerPlaceholder"
            :aria-label="labels.composerAria"
            :disabled="turnActive"
            @keydown="handleComposerKeyDown"
          />
          <div class="ai-panel-composer-actions">
            <span>{{ turnStatusLabel }}</span>
            <button
              class="ai-panel-send"
              type="button"
              :disabled="!turnActive && (!canSend || !configurationReady)"
              @click="handlePrimaryAction"
            >
              {{ sendButtonLabel }}
            </button>
          </div>
        </div>
      </footer>
    </div>
  </aside>
</template>
