import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorkspace } from '@/domain/workspace';
import { setLocale } from '@/i18n/locale';
import { sendAiChat } from '@/services/aiClient';
import type { AiConversationRunner } from '@/services/aiConversationRunner';
import type { AiTerminalToolCall } from '@/services/aiToolProtocol';
import { useAiConversationStore } from '@/stores/aiConversationStore';
import {
  defaultAiSettings,
  defaultTerminalSettings,
  useAppSettingsStore,
} from '@/stores/appSettingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import AIPanel from './AIPanel.vue';

vi.mock('@/services/aiClient', () => ({
  sendAiChat: vi.fn(async () => 'answer'),
}));

describe('AIPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setLocale('en-US');
    useAiConversationStore().clearConversation();
    useAppSettingsStore().replaceRuntimeSettings({
      ai: {
        ...defaultAiSettings,
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-test',
        token: 'token-a',
      },
      terminal: defaultTerminalSettings,
    });
    vi.clearAllMocks();
  });

  it('sends a configured chat request from the side panel', async () => {
    const wrapper = mount(AIPanel, { props: { snapshot: null } });

    await wrapper.get('textarea').setValue('hello');
    await wrapper.get('.ai-panel-send').trigger('click');
    await flushPromises();

    const requestMessages = vi.mocked(sendAiChat).mock.calls[0]?.[1] ?? [];
    expect(vi.mocked(sendAiChat)).toHaveBeenCalledOnce();
    expect(requestMessages.filter((message) => message.content === 'hello')).toHaveLength(1);
    expect(wrapper.text()).toContain('answer');
  });

  it('does not send when Enter confirms an input method candidate', async () => {
    const wrapper = mount(AIPanel, { props: { snapshot: null } });
    const composer = wrapper.get('textarea');

    await composer.setValue('dock er');
    await composer.trigger('keydown', {
      key: 'Enter',
      isComposing: true,
      keyCode: 229,
    });
    await flushPromises();

    expect(vi.mocked(sendAiChat)).not.toHaveBeenCalled();
    expect((composer.element as HTMLTextAreaElement).value).toBe('dock er');
  });

  it('renders the model, turn status, and separate message roles', async () => {
    const wrapper = mount(AIPanel, { props: { snapshot: null } });

    await wrapper.get('textarea').setValue('hello');
    await wrapper.get('.ai-panel-send').trigger('click');
    await flushPromises();

    expect(wrapper.get('.ai-panel-model').text()).toContain('gpt-test');
    expect(wrapper.get('.ai-panel-turn-status').exists()).toBe(true);
    expect(wrapper.get('.ai-message-user').text()).toContain('hello');
    expect(wrapper.get('.ai-message-assistant').text()).toContain('answer');
  });

  it('renders assistant markdown, fenced code blocks, and tables', async () => {
    vi.mocked(sendAiChat).mockResolvedValueOnce(
      [
        '# Plan',
        '',
        '- Run `pwd`',
        '',
        '```ts',
        'const value = 1;',
        '```',
        '',
        '| Process | RSS |',
        '|---|---:|',
        '| shell | 20 MiB |',
      ].join('\n'),
    );
    const wrapper = mount(AIPanel, { props: { snapshot: null } });

    await wrapper.get('textarea').setValue('show plan');
    await wrapper.get('.ai-panel-send').trigger('click');
    await flushPromises();

    expect(wrapper.get('.ai-markdown-heading').text()).toBe('Plan');
    expect(wrapper.get('.ai-inline-code').text()).toBe('pwd');
    expect(wrapper.get('.ai-markdown-code-block code').text()).toBe('const value = 1;');
    expect(wrapper.get('.ai-markdown-table th').text()).toBe('Process');
  });

  it('localizes the AI panel controls in Chinese', () => {
    setLocale('zh-CN');
    const wrapper = mount(AIPanel, { props: { snapshot: null } });

    expect(wrapper.get('[aria-label="AI 面板"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('助手');
    expect(wrapper.get('textarea').attributes('placeholder')).toBe('询问当前终端会话');
    expect(wrapper.get('.ai-panel-send').text()).toBe('发送');
  });

  it('emits resize updates when dragging the left edge', async () => {
    const wrapper = mount(AIPanel, { props: { snapshot: null, width: 380 } });

    await wrapper.get('.ai-panel-resize-handle').trigger('pointerdown', { clientX: 500 });
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 440 }));
    window.dispatchEvent(new MouseEvent('pointerup'));

    expect(wrapper.emitted('resize')?.at(-1)).toEqual([440]);
    expect(document.body.classList.contains('ai-panel-resizing')).toBe(false);
  });

  it('updates the assistant message while streaming is enabled', async () => {
    vi.mocked(sendAiChat).mockImplementationOnce(async (_settings, _messages, options) => {
      if (typeof options !== 'function') {
        options.onDelta?.('hel');
        options.onDelta?.('lo');
      }
      return 'hello';
    });
    const wrapper = mount(AIPanel, { props: { snapshot: null } });

    await wrapper.get('textarea').setValue('stream please');
    await wrapper.get('.ai-panel-send').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('hello');
    expect(wrapper.findAll('.ai-message-assistant')).toHaveLength(1);
  });

  it('keeps pending approval in a fixed dock until the decision is made', async () => {
    const conversation = useAiConversationStore();
    conversation.appendToolCall(createToolCall());
    conversation.beginTurn('turn-1');
    conversation.setStatus('awaitingApproval');
    const runner = createRunnerStub();
    const wrapper = mount(AIPanel, {
      props: { snapshot: null },
      global: { provide: { aiConversationRunner: runner } },
    });

    expect(wrapper.get('.ai-panel-turn-status').text()).toContain('Waiting for approval');
    expect(wrapper.find('.ai-panel-thread .ai-tool-card').exists()).toBe(false);
    expect(wrapper.get('.ai-approval-dock .ai-tool-card').exists()).toBe(true);
    await wrapper.get('.ai-approval-dock [data-action="approve"]').trigger('click');

    expect(runner.approve).toHaveBeenCalledWith('call-1');
    conversation.updateToolCall('call-1', { status: 'approved' });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.ai-approval-dock').exists()).toBe(false);
    expect(wrapper.get('.ai-panel-thread .ai-tool-card').attributes('data-status')).toBe(
      'approved',
    );
  });

  it('hides the streaming cursor and approval dock when the turn is stopped', async () => {
    const conversation = useAiConversationStore();
    conversation.appendAssistantMessage('');
    conversation.appendToolCall(createToolCall());
    conversation.beginTurn('turn-1');
    conversation.setStatus('awaitingApproval');
    const runner = createRunnerStub();
    vi.mocked(runner.stop).mockImplementation(() => conversation.stopTurn());
    const wrapper = mount(AIPanel, {
      props: { snapshot: null },
      global: { provide: { aiConversationRunner: runner } },
    });

    expect(wrapper.find('.ai-message-cursor').exists()).toBe(true);
    expect(wrapper.find('.ai-approval-dock').exists()).toBe(true);
    await wrapper.get('.ai-panel-send').trigger('click');

    expect(wrapper.find('.ai-message-cursor').exists()).toBe(false);
    expect(wrapper.find('.ai-approval-dock').exists()).toBe(false);
  });

  it('runs a full-access terminal tool and continues with its output', async () => {
    const workspace = useWorkspaceStore();
    workspace.workspace = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    workspace.getTerminalOutputCursor = vi.fn(() => ({ sessionId: 'session-a', sequence: 4 }));
    let marker = '';
    workspace.writeToSession = vi.fn(async (_sessionId, input) => {
      marker = /__FLEURTERM_DONE_[A-Za-z0-9_]+/.exec(input)?.[0] ?? '';
    });
    workspace.waitForSessionTerminalOutput = vi.fn(async () => ({
      output: `Mode LastWriteTime Name\n-a--- app.ts\n${marker}:0`,
      reason: 'matched' as const,
      truncated: false,
    }));
    workspace.interruptSession = vi.fn(async () => undefined);
    useAppSettingsStore().updateAiSettings({ commandPolicy: 'fullAccess' });
    vi.mocked(sendAiChat)
      .mockResolvedValueOnce('<terminal-command>dir</terminal-command>')
      .mockResolvedValueOnce('Found `app.ts` in the current directory.');
    const wrapper = mount(AIPanel, {
      props: {
        snapshot: {
          sessionId: 'session-a',
          backendType: 'local',
          state: 'ready',
          shell: 'pwsh',
        },
      },
    });

    await wrapper.get('textarea').setValue('看看当前目录');
    await wrapper.get('.ai-panel-send').trigger('click');
    await flushPromises();

    expect(workspace.writeToSession).toHaveBeenCalledWith('session-a', expect.any(String));
    expect(vi.mocked(sendAiChat)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendAiChat).mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining('Mode LastWriteTime Name') }),
      ]),
    );
    expect(wrapper.get('.ai-panel-thread').text()).toContain('Found');
    expect(wrapper.get('.ai-tool-card').attributes('data-status')).toBe('completed');
  });

  it('renders terminal command tags as styled code blocks', async () => {
    useAppSettingsStore().updateAiSettings({ commandPolicy: 'suggest' });
    vi.mocked(sendAiChat).mockResolvedValueOnce(
      '<terminal-command>dir</terminal-command>Inspect the directory.',
    );
    const wrapper = mount(AIPanel, { props: { snapshot: null } });

    await wrapper.get('textarea').setValue('show command');
    await wrapper.get('.ai-panel-send').trigger('click');
    await flushPromises();

    expect(wrapper.get('.ai-markdown-code-block figcaption').text()).toBe('terminal');
    expect(wrapper.get('.ai-markdown-code-block code').text()).toBe('dir');
  });

  it('keeps conversation history across panel remounts', async () => {
    const wrapper = mount(AIPanel, { props: { snapshot: null } });
    await wrapper.get('textarea').setValue('first');
    await wrapper.get('.ai-panel-send').trigger('click');
    await flushPromises();
    wrapper.unmount();

    const reopened = mount(AIPanel, { props: { snapshot: null } });
    expect(reopened.text()).toContain('first');
    expect(reopened.text()).toContain('answer');
  });

  it('marks failed messages and retries the last failed prompt', async () => {
    vi.mocked(sendAiChat)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce('recovered');
    const wrapper = mount(AIPanel, { props: { snapshot: null } });

    await wrapper.get('textarea').setValue('try me');
    await wrapper.get('.ai-panel-send').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('network down');

    await wrapper.get('.ai-panel-error button').trigger('click');
    await flushPromises();

    expect(vi.mocked(sendAiChat)).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('recovered');
  });
});

function createToolCall(): AiTerminalToolCall {
  return {
    id: 'call-1',
    type: 'terminal.command',
    command: 'pwd',
    targetSessionId: 'session-1',
    risk: 'safe',
    status: 'proposed',
    output: '',
    errorMessage: null,
    truncated: false,
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
  };
}

function createRunnerStub(): AiConversationRunner {
  return {
    send: vi.fn(async () => undefined),
    stop: vi.fn(),
    approve: vi.fn(),
    deny: vi.fn(),
    continueWaiting: vi.fn(),
    interrupt: vi.fn(),
    usePartialOutput: vi.fn(),
  };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve));
}

function ids(...values: string[]) {
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) {
      throw new Error('test ID generator exhausted');
    }
    index += 1;
    return value;
  };
}
