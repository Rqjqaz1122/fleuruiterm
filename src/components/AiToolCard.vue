<script setup lang="ts">
import { computed } from 'vue';

import type { AiTerminalToolCall } from '@/services/aiToolProtocol';
import type { SupportedAppLocale } from '@/stores/appSettingsStore';

const props = defineProps<{
  call: AiTerminalToolCall;
  locale: SupportedAppLocale;
}>();

const emit = defineEmits<{
  approve: [callId: string];
  deny: [callId: string];
  continueWaiting: [callId: string];
  interrupt: [callId: string];
  usePartialOutput: [callId: string];
}>();

const labels = computed(() => (props.locale === 'zh-CN' ? zhLabels : enLabels));
const statusLabel = computed(() => labels.value.statuses[props.call.status]);
const riskLabel = computed(() => labels.value.risks[props.call.risk]);
const disclosureAlwaysOpen = computed(
  () => props.call.status === 'proposed' || props.call.status === 'blocked',
);
const durationLabel = computed(() => {
  if (props.call.startedAt === null) {
    return '';
  }
  const endTime = props.call.completedAt ?? Date.now();
  const durationSeconds = Math.max(0, Math.round((endTime - props.call.startedAt) / 1_000));
  return `${durationSeconds}s`;
});

function keepActionableDisclosureOpen(event: Event): void {
  if (!disclosureAlwaysOpen.value) {
    return;
  }
  const disclosure = event.currentTarget as HTMLDetailsElement;
  if (!disclosure.open) {
    disclosure.open = true;
  }
}
</script>

<template>
  <article class="ai-tool-card" :data-status="call.status">
    <details
      class="ai-tool-disclosure"
      :open="disclosureAlwaysOpen"
      @toggle="keepActionableDisclosureOpen"
    >
      <summary class="ai-tool-card-header">
        <span class="ai-tool-status-dot" aria-hidden="true" />
        <div class="ai-tool-heading">
          <strong aria-live="polite">{{ statusLabel }}</strong>
          <span class="ai-tool-summary-command">{{ call.command }}</span>
        </div>
        <span v-if="durationLabel" class="ai-tool-duration">{{ durationLabel }}</span>
        <span class="ai-tool-chevron" aria-hidden="true" />
      </summary>

      <div class="ai-tool-card-body">
        <div class="ai-tool-meta">
          <span>{{ labels.terminal }} · {{ call.targetSessionId ?? labels.noSession }}</span>
          <span>{{ labels.risk }}: {{ riskLabel }}</span>
          <span v-if="call.truncated">{{ labels.truncated }}</span>
        </div>

        <pre class="ai-tool-command"><code>{{ call.command }}</code></pre>

        <p v-if="call.errorMessage" class="ai-tool-error">{{ call.errorMessage }}</p>

        <div v-if="call.output" class="ai-tool-output-section">
          <span>{{ labels.output }}</span>
          <pre class="ai-tool-output"><code>{{ call.output }}</code></pre>
        </div>

        <div v-if="call.status === 'proposed'" class="ai-tool-actions">
          <button type="button" data-action="deny" @click="emit('deny', call.id)">
            {{ labels.deny }}
          </button>
          <button
            class="is-primary"
            type="button"
            data-action="approve"
            @click="emit('approve', call.id)"
          >
            {{ labels.approve }}
          </button>
        </div>

        <div v-else-if="call.status === 'blocked'" class="ai-tool-actions ai-tool-blocked-actions">
          <button
            type="button"
            data-action="continue-waiting"
            @click="emit('continueWaiting', call.id)"
          >
            {{ labels.continueWaiting }}
          </button>
          <button type="button" data-action="interrupt" @click="emit('interrupt', call.id)">
            {{ labels.interrupt }}
          </button>
          <button
            class="is-primary"
            type="button"
            data-action="use-partial"
            @click="emit('usePartialOutput', call.id)"
          >
            {{ labels.usePartialOutput }}
          </button>
        </div>
      </div>
    </details>
  </article>
</template>

<script lang="ts">
const enLabels = {
  approve: 'Approve',
  continueWaiting: 'Continue waiting',
  deny: 'Deny',
  interrupt: 'Interrupt',
  noSession: 'No session',
  output: 'Terminal output',
  risk: 'Risk',
  terminal: 'Terminal',
  truncated: 'Output truncated',
  usePartialOutput: 'Use current output',
  risks: {
    safe: 'Low',
    risky: 'High',
    unknown: 'Unknown',
  },
  statuses: {
    proposed: 'Approval required',
    approved: 'Approved',
    denied: 'Denied',
    running: 'Running',
    blocked: 'Waiting for terminal input',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
  },
} as const;

const zhLabels = {
  approve: '批准',
  continueWaiting: '继续等待',
  deny: '拒绝',
  interrupt: '中断',
  noSession: '无终端',
  output: '终端输出',
  risk: '风险',
  terminal: '终端',
  truncated: '输出已截断',
  usePartialOutput: '使用当前输出继续',
  risks: {
    safe: '低',
    risky: '高',
    unknown: '未知',
  },
  statuses: {
    proposed: '需要批准',
    approved: '已批准',
    denied: '已拒绝',
    running: '正在运行',
    blocked: '等待终端输入',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  },
};
</script>
