import { beforeEach, describe, expect, it } from 'vitest';

import type { AiTerminalToolCall } from '@/services/aiToolProtocol';

import { useAiConversationStore } from './aiConversationStore';

describe('AI conversation store', () => {
  const store = useAiConversationStore();

  beforeEach(() => {
    store.clearConversation();
  });

  it('keeps awaiting approval as an active turn and resolves the stored decision', async () => {
    store.beginTurn('turn-1');
    store.setStatus('awaitingApproval');
    const decision = store.waitForToolDecision('call-1');

    expect(store.turnActive.value).toBe(true);
    store.resolveToolDecision('call-1', 'approved');

    await expect(decision).resolves.toBe('approved');
  });

  it('cancels pending decisions when the active turn stops', async () => {
    store.beginTurn('turn-1');
    store.appendToolCall(createToolCall());
    const decision = store.waitForToolDecision('call-1');

    store.stopTurn();

    await expect(decision).resolves.toBe('cancelled');
    expect(store.toolCalls.value[0]).toEqual(
      expect.objectContaining({
        status: 'cancelled',
        completedAt: expect.any(Number),
      }),
    );
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
