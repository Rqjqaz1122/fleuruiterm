import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorkspace } from '@/domain/workspace';
import { setLocale } from '@/i18n/locale';
import { sendAiChat } from '@/services/aiClient';
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

  it('renders only user and assistant message content in the conversation stream', async () => {
    const wrapper = mount(AIPanel, { props: { snapshot: null } });

    await wrapper.get('textarea').setValue('hello');
    await wrapper.get('.ai-panel-send').trigger('click');
    await flushPromises();

    const threadText = wrapper.get('.ai-panel-thread').text();
    expect(threadText).toContain('hello');
    expect(threadText).toContain('answer');
    expect(threadText).not.toContain('Provider');
    expect(threadText).not.toContain('Model');
    expect(threadText).not.toContain('Context');
    expect(threadText).not.toContain('You');
    expect(threadText).not.toContain('FleurTerm AI');
  });

  it('renders assistant markdown and fenced code blocks', async () => {
    vi.mocked(sendAiChat).mockResolvedValueOnce(
      [
        '# Plan',
        '',
        '- Run `pwd`',
        '- **Check** [docs](https://example.com)',
        '',
        '```ts',
        'const value = 1;',
        '```',
      ].join('\n'),
    );
    const wrapper = mount(AIPanel, { props: { snapshot: null } });

    await wrapper.get('textarea').setValue('show plan');
    await wrapper.get('.ai-panel-send').trigger('click');
    await flushPromises();

    expect(wrapper.get('.ai-markdown-heading').text()).toBe('Plan');
    expect(wrapper.get('.ai-markdown-list').text()).toContain('Run');
    expect(wrapper.get('.ai-inline-code').text()).toBe('pwd');
    expect(wrapper.get('.ai-inline-strong').text()).toBe('Check');
    expect(wrapper.get('.ai-inline-link').attributes('href')).toBe('https://example.com');
    expect(wrapper.get('.ai-markdown-code-block figcaption').text()).toBe('ts');
    expect(wrapper.get('.ai-markdown-code-block code').text()).toBe('const value = 1;');
  });

  it('renders assistant markdown tables', async () => {
    vi.mocked(sendAiChat).mockResolvedValueOnce(
      [
        '| Process | Memory | RSS |',
        '|---|---:|---:|',
        '| java -jar /app/fleurui-admin.jar | 13.2% | about 1.0 GiB |',
        '| mysqld | 4.2% | about 336 MiB |',
      ].join('\n'),
    );
    const wrapper = mount(AIPanel, { props: { snapshot: null } });

    await wrapper.get('textarea').setValue('show memory table');
    await wrapper.get('.ai-panel-send').trigger('click');
    await flushPromises();

    expect(wrapper.get('.ai-markdown-table th').text()).toBe('Process');
    expect(wrapper.findAll('.ai-markdown-table tbody tr')).toHaveLength(2);
    expect(wrapper.findAll('.ai-markdown-table .is-right').length).toBeGreaterThan(0);
    expect(wrapper.get('.ai-panel-thread').text()).not.toContain('|---|');
  });

  it('localizes the AI panel controls in Chinese', () => {
    setLocale('zh-CN');
    const wrapper = mount(AIPanel, { props: { snapshot: null } });

    expect(wrapper.get('[aria-label="AI 面板"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('助手');
    expect(wrapper.text()).toContain('新会话');
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
    useAppSettingsStore().updateAiSettings({ streamingEnabled: true });
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
    expect(wrapper.find('.ai-message-pending').exists()).toBe(false);
    expect(wrapper.findAll('.ai-message-assistant')).toHaveLength(1);
  });

  it('lets full access mode run terminal commands and continue with command output', async () => {
    const workspaceStore = useWorkspaceStore();
    workspaceStore.workspace = createWorkspace('session-a', ids('tab-1', 'pane-1'));
    workspaceStore.getFocusedTerminalOutput = vi.fn(() => 'PS D:\\Project>');
    workspaceStore.getFocusedTerminalOutputCursor = vi.fn(() => ({
      sessionId: 'session-a',
      sequence: 4,
    }));
    workspaceStore.writeToFocusedSession = vi.fn(async () => undefined);
    workspaceStore.waitForFocusedTerminalOutput = vi.fn(async () => 'Mode LastWriteTime Name\n-a--- app.ts');
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

    expect(workspaceStore.writeToFocusedSession).toHaveBeenCalledWith('dir\r');
    expect(workspaceStore.waitForFocusedTerminalOutput).toHaveBeenCalledWith(
      { sessionId: 'session-a', sequence: 4 },
      { maxBytes: 12 * 1024 },
    );
    expect(vi.mocked(sendAiChat)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendAiChat).mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining('Mode LastWriteTime Name'),
        }),
      ]),
    );
    expect(wrapper.get('.ai-panel-thread').text()).toContain('Found');
  });

  it('offers a terminal command run action when command policy asks first', async () => {
    vi.mocked(sendAiChat).mockResolvedValueOnce(
      'Use this:\n<terminal-command>pwd</terminal-command>',
    );
    const wrapper = mount(AIPanel, { props: { snapshot: null } });

    await wrapper.get('textarea').setValue('show cwd');
    await wrapper.get('.ai-panel-send').trigger('click');
    await flushPromises();
    await wrapper.get('.ai-terminal-run').trigger('click');

    expect(wrapper.emitted('runTerminalCommand')).toEqual([['pwd']]);
  });

  it('renders terminal command tags as styled code blocks when prose follows immediately', async () => {
    vi.mocked(sendAiChat).mockResolvedValueOnce(
      '<terminal-command>dir</terminal-command>已请求在当前本地终端执行 `dir` 命令。',
    );
    const wrapper = mount(AIPanel, { props: { snapshot: null } });

    await wrapper.get('textarea').setValue('执行一下dir命令');
    await wrapper.get('.ai-panel-send').trigger('click');
    await flushPromises();

    expect(wrapper.get('.ai-markdown-code-block figcaption').text()).toBe('terminal');
    expect(wrapper.get('.ai-markdown-code-block code').text()).toBe('dir');
    expect(wrapper.get('.ai-panel-thread').text()).not.toContain('```terminal');
    expect(wrapper.get('.ai-panel-thread').text()).toContain('已请求在当前本地终端执行');
  });

  it('automatically emits terminal commands when command policy is auto', async () => {
    useAppSettingsStore().updateAiSettings({ commandPolicy: 'auto' });
    vi.mocked(sendAiChat).mockResolvedValueOnce(
      'Checking now.\n<terminal-command>ls</terminal-command>',
    );
    const wrapper = mount(AIPanel, { props: { snapshot: null } });

    await wrapper.get('textarea').setValue('list files');
    await wrapper.get('.ai-panel-send').trigger('click');
    await flushPromises();

    expect(wrapper.emitted('runTerminalCommand')).toEqual([['ls']]);
    expect(wrapper.find('.ai-terminal-run').exists()).toBe(false);
  });

  it('offers application action controls when command policy asks first', async () => {
    vi.mocked(sendAiChat).mockResolvedValueOnce(
      'Done.\n<fleurterm-action>{"type":"settings.updateTerminal","patch":{"fontSize":16}}</fleurterm-action>',
    );
    const wrapper = mount(AIPanel, { props: { snapshot: null } });

    await wrapper.get('textarea').setValue('make font larger');
    await wrapper.get('.ai-panel-send').trigger('click');
    await flushPromises();
    await wrapper.get('.ai-terminal-run').trigger('click');

    expect(wrapper.emitted('runAppAction')).toEqual([
      [{ type: 'settings.updateTerminal', patch: { fontSize: 16 } }],
    ]);
    expect(wrapper.get('.ai-panel-thread').text()).not.toContain('fleurterm-action');
  });

  it('automatically emits application actions when command policy is auto', async () => {
    useAppSettingsStore().updateAiSettings({ commandPolicy: 'auto' });
    vi.mocked(sendAiChat).mockResolvedValueOnce(
      'Opening it.\n<fleurterm-action>{"type":"terminal.openSsh","host":"example.com","user":"root","port":2222}</fleurterm-action>',
    );
    const wrapper = mount(AIPanel, { props: { snapshot: null } });

    await wrapper.get('textarea').setValue('open ssh');
    await wrapper.get('.ai-panel-send').trigger('click');
    await flushPromises();

    expect(wrapper.emitted('runAppAction')).toEqual([
      [{ type: 'terminal.openSsh', host: 'example.com', user: 'root', port: 2222 }],
    ]);
  });

  it('keeps conversation history across panel remounts and sends multi-turn context', async () => {
    const wrapper = mount(AIPanel, { props: { snapshot: null } });

    await wrapper.get('textarea').setValue('first');
    await wrapper.get('.ai-panel-send').trigger('click');
    await flushPromises();
    wrapper.unmount();

    const reopened = mount(AIPanel, { props: { snapshot: null } });
    expect(reopened.text()).toContain('first');
    expect(reopened.text()).toContain('answer');

    await reopened.get('textarea').setValue('second');
    await reopened.get('.ai-panel-send').trigger('click');
    await flushPromises();

    const secondRequestMessages = vi.mocked(sendAiChat).mock.calls[1]?.[1] ?? [];
    expect(secondRequestMessages.map((message) => message.content)).toEqual(
      expect.arrayContaining(['first', 'answer', 'second']),
    );
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
    expect(wrapper.get('.ai-message-user').classes()).toContain('is-failed');

    await wrapper.get('.ai-panel-error button').trigger('click');
    await flushPromises();

    expect(vi.mocked(sendAiChat)).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('recovered');
  });
});

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
