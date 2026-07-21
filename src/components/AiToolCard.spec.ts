import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { AiTerminalToolCall } from '@/services/aiToolProtocol';

import AiToolCard from './AiToolCard.vue';

describe('AiToolCard', () => {
  it('shows approval controls for a proposed tool call', async () => {
    const wrapper = mount(AiToolCard, {
      props: { call: createCall(), locale: 'en-US' },
    });

    expect(wrapper.text()).toContain('Approval required');
    expect(wrapper.get('.ai-tool-disclosure').attributes('open')).toBeDefined();
    await wrapper.get('[data-action="approve"]').trigger('click');
    await wrapper.get('[data-action="deny"]').trigger('click');

    expect(wrapper.emitted('approve')).toEqual([['call-1']]);
    expect(wrapper.emitted('deny')).toEqual([['call-1']]);
  });

  it('shows blocked recovery actions and expandable output', () => {
    const wrapper = mount(AiToolCard, {
      props: {
        call: createCall({ status: 'blocked', output: 'Password:' }),
        locale: 'zh-CN',
      },
    });

    expect(wrapper.text()).toContain('等待终端输入');
    expect(wrapper.get('.ai-tool-disclosure').attributes('open')).toBeDefined();
    expect(wrapper.get('[data-action="continue-waiting"]').exists()).toBe(true);
    expect(wrapper.get('[data-action="interrupt"]').exists()).toBe(true);
    expect(wrapper.get('[data-action="use-partial"]').exists()).toBe(true);
    expect(wrapper.get('.ai-tool-output').text()).toContain('Password:');
  });

  it('announces status changes and shows the bound terminal session', () => {
    const wrapper = mount(AiToolCard, {
      props: {
        call: createCall({ status: 'running', startedAt: Date.now() - 1_000 }),
        locale: 'en-US',
      },
    });

    expect(wrapper.get('[aria-live="polite"]').text()).toContain('Running');
    expect(wrapper.text()).toContain('session-1');
    expect(wrapper.get('.ai-tool-command').text()).toBe('pwd');
  });

  it('collapses a completed tool into a complete command summary', () => {
    const wrapper = mount(AiToolCard, {
      props: {
        call: createCall({
          status: 'completed',
          output: '/Users/fleurui/project',
          startedAt: Date.now() - 1_000,
          completedAt: Date.now(),
        }),
        locale: 'en-US',
      },
    });

    const disclosure = wrapper.get('details.ai-tool-disclosure');
    expect(disclosure.attributes('open')).toBeUndefined();
    expect(disclosure.get('summary').text()).toContain('Completed');
    expect(disclosure.get('summary').text()).toContain('pwd');
    expect(disclosure.get('.ai-tool-card-body').text()).toContain('session-1');
    expect(disclosure.get('.ai-tool-card-body').text()).toContain('/Users/fleurui/project');
  });
});

function createCall(patch: Partial<AiTerminalToolCall> = {}): AiTerminalToolCall {
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
    ...patch,
  };
}
