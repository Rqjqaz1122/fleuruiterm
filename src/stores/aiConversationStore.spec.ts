import { beforeEach, describe, expect, it } from 'vitest';

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
    const decision = store.waitForToolDecision('call-1');

    store.stopTurn();

    await expect(decision).resolves.toBe('cancelled');
  });
});
