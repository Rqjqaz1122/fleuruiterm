# FleurTerm AI Terminal Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Codex-style AI tool loop that stays active through approval, terminal execution, blocking, and result continuation, while replacing the current AI panel with a clear conversation and tool-card interface.

**Architecture:** Introduce provider-neutral tool-call types, a conservative command-risk classifier, a target-session terminal runner, and a single conversation runner. Keep the current tag protocol as an adapter, move orchestration out of `AIPanel.vue`, persist active turn/tool state in Pinia, and render each terminal action through a focused `AiToolCard` component.

**Tech Stack:** Vue 3 Composition API, Pinia 3, TypeScript 5.9, Vitest, Tauri 2, existing PTY/session IPC, CSS design tokens.

---

## File Map

**Create**

- `src/services/aiToolProtocol.ts` — provider-neutral tool calls/results and tag-protocol adapter.
- `src/services/aiToolProtocol.spec.ts` — parsing and result-format tests.
- `src/services/aiCommandRisk.ts` — conservative terminal command risk classification.
- `src/services/aiCommandRisk.spec.ts` — safe, risky, and unknown command tests.
- `src/services/terminalToolRunner.ts` — target-session command wrapping, completion markers, blocking, continuation, and interrupt.
- `src/services/terminalToolRunner.spec.ts` — command lifecycle tests with a fake workspace port.
- `src/services/aiConversationRunner.ts` — the only multi-step model/tool orchestration loop.
- `src/services/aiConversationRunner.spec.ts` — approval, denial, automatic execution, blocking, stopping, and step-limit tests.
- `src/components/AiToolCard.vue` — terminal tool status, approval controls, output summary, and blocked actions.
- `src/components/AiToolCard.spec.ts` — visual states, actions, localization, and accessibility tests.

**Modify**

- `src/stores/aiConversationStore.ts` — richer turn status, tool calls, pending decisions, and active-turn persistence.
- `src/stores/workspaceStore.ts` — session-specific write/cursor/wait/interrupt APIs and structured wait outcome.
- `src/stores/workspaceStore.spec.ts` — target-session and timeout/marker regression coverage.
- `src/components/AIPanel.vue` — become a presentation/controller shell around the conversation runner.
- `src/components/AIPanel.spec.ts` — new timeline and tool-state behavior; retain Markdown and resize regressions.
- `src/services/aiClient.ts` — accept standardized assistant/tool-result messages without owning orchestration.
- `src/services/aiClient.spec.ts` — request serialization regression tests.
- `src/services/aiTerminalCommands.ts` — compatibility exports delegating to `aiToolProtocol`.
- `src/services/aiTerminalCommands.spec.ts` — compatibility behavior remains stable.
- `src/App.vue` — retain application-action handling; remove terminal-command event path once the runner uses the workspace port.
- `src/App.spec.ts` — update AI panel stub expectations.
- `src/styles/global.css` — AI panel timeline, composer, tool cards, statuses, and reduced-motion behavior.

### Task 1: Provider-neutral AI tool protocol

**Files:**

- Create: `src/services/aiToolProtocol.ts`
- Create: `src/services/aiToolProtocol.spec.ts`
- Modify: `src/services/aiTerminalCommands.ts`
- Test: `src/services/aiTerminalCommands.spec.ts`

- [ ] **Step 1: Write failing protocol tests**

````ts
import { describe, expect, it } from 'vitest';

import { formatToolResultMessage, parseAssistantToolResponse } from './aiToolProtocol';

describe('AI tool protocol', () => {
  it('creates a stable terminal tool call and removes the raw tag from visible text', () => {
    const response = parseAssistantToolResponse(
      'Checking.\n<terminal-command>pwd</terminal-command>',
    );

    expect(response.displayContent).toContain('```terminal\npwd\n```');
    expect(response.toolCalls).toEqual([
      expect.objectContaining({ type: 'terminal.command', command: 'pwd', status: 'proposed' }),
    ]);
  });

  it('formats a result with the call id, outcome, command, and output', () => {
    expect(
      formatToolResultMessage({
        callId: 'call-1',
        outcome: 'completed',
        command: 'pwd',
        output: '/Users/fleurui',
        truncated: false,
      }),
    ).toContain('Tool call call-1 completed');
  });
});
````

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
pnpm test src/services/aiToolProtocol.spec.ts
```

Expected: FAIL because `aiToolProtocol.ts` does not exist.

- [ ] **Step 3: Implement the tool types and tag adapter**

```ts
export type AiToolCallStatus =
  'proposed' | 'approved' | 'denied' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled';

export type AiCommandRisk = 'safe' | 'risky' | 'unknown';

export interface AiTerminalToolCall {
  id: string;
  type: 'terminal.command';
  command: string;
  targetSessionId: string | null;
  risk: AiCommandRisk;
  status: AiToolCallStatus;
  output: string;
  errorMessage: string | null;
  truncated: boolean;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface AiToolResult {
  callId: string;
  outcome: 'completed' | 'partial' | 'denied' | 'failed' | 'cancelled';
  command: string;
  output: string;
  truncated: boolean;
  errorMessage?: string;
}

export interface ParsedAssistantToolResponse {
  displayContent: string;
  toolCalls: AiTerminalToolCall[];
  appActions: ParsedAiAppAction[];
}
```

Use the existing terminal tag, shell-fence, app-action parsing, normalization, and stable hash behavior. `formatToolResultMessage` must emit a bounded, labeled system message rather than anonymous output text.

- [ ] **Step 4: Delegate compatibility exports**

Keep `parseAiAssistantContent` available from `aiTerminalCommands.ts`, but implement it by mapping `parseAssistantToolResponse()` back to `terminalCommands` and `appActions`. Existing callers and tests remain valid during migration.

- [ ] **Step 5: Run protocol and compatibility tests**

```bash
pnpm test src/services/aiToolProtocol.spec.ts src/services/aiTerminalCommands.spec.ts
```

Expected: PASS.

### Task 2: Conservative command-risk classifier

**Files:**

- Create: `src/services/aiCommandRisk.ts`
- Create: `src/services/aiCommandRisk.spec.ts`

- [ ] **Step 1: Write failing classifier tests**

```ts
import { describe, expect, it } from 'vitest';

import { classifyTerminalCommand } from './aiCommandRisk';

describe('classifyTerminalCommand', () => {
  it.each(['pwd', 'ls -la', 'git status', 'cat package.json', 'Get-ChildItem'])(
    '%s is safe',
    (command) => {
      expect(classifyTerminalCommand(command)).toBe('safe');
    },
  );

  it.each(['rm -rf dist', 'npm install', 'git push', 'sudo reboot', 'Invoke-WebRequest x'])(
    '%s is risky',
    (command) => {
      expect(classifyTerminalCommand(command)).toBe('risky');
    },
  );

  it('treats compound or unrecognized commands as unknown', () => {
    expect(classifyTerminalCommand('custom-tool --apply')).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm test src/services/aiCommandRisk.spec.ts
```

Expected: FAIL because the classifier does not exist.

- [ ] **Step 3: Implement explicit safe and risky rules**

```ts
const SAFE_COMMANDS = new Set([
  'pwd',
  'ls',
  'dir',
  'cat',
  'head',
  'tail',
  'find',
  'rg',
  'grep',
  'git status',
  'git diff',
  'git log',
  'Get-ChildItem',
  'Get-Content',
]);

const RISKY_PATTERN =
  /(?:^|\s)(?:rm|rmdir|del|erase|mv|cp|chmod|chown|sudo|npm\s+(?:install|publish)|pnpm\s+(?:add|publish)|git\s+(?:push|commit|reset|checkout)|curl|wget|Invoke-WebRequest|ssh|scp)(?:\s|$)/i;

export function classifyTerminalCommand(command: string): AiCommandRisk {
  const normalized = command.trim();
  if (!normalized || /[;&|>`]/.test(normalized)) {
    return RISKY_PATTERN.test(normalized) ? 'risky' : 'unknown';
  }
  if (RISKY_PATTERN.test(normalized)) {
    return 'risky';
  }
  const safe = [...SAFE_COMMANDS].some(
    (candidate) => normalized === candidate || normalized.startsWith(`${candidate} `),
  );
  return safe ? 'safe' : 'unknown';
}
```

Keep the allowlist deliberately small. Redirections, pipes, command chaining, substitutions, network actions, package changes, Git mutations, privilege changes, and unknown executables must never be auto-approved.

- [ ] **Step 4: Run classifier tests**

```bash
pnpm test src/services/aiCommandRisk.spec.ts
```

Expected: PASS.

### Task 3: Conversation state and deferred user decisions

**Files:**

- Modify: `src/stores/aiConversationStore.ts`
- Create: `src/stores/aiConversationStore.spec.ts`

- [ ] **Step 1: Write failing state-store tests**

```ts
it('keeps awaiting approval as an active turn and resolves the stored decision', async () => {
  const store = useAiConversationStore();
  store.beginTurn('turn-1');
  store.setStatus('awaitingApproval');
  const decision = store.waitForToolDecision('call-1');

  expect(store.turnActive.value).toBe(true);
  store.resolveToolDecision('call-1', 'approved');
  await expect(decision).resolves.toBe('approved');
});

it('cancels pending decisions when the active turn stops', async () => {
  const store = useAiConversationStore();
  store.beginTurn('turn-1');
  const decision = store.waitForToolDecision('call-1');
  store.stopTurn();
  await expect(decision).resolves.toBe('cancelled');
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm test src/stores/aiConversationStore.spec.ts
```

Expected: FAIL because the richer state API is missing.

- [ ] **Step 3: Add turn and tool state**

```ts
export type AiConversationStatus =
  | 'idle'
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

const toolCalls = ref<AiTerminalToolCall[]>([]);
const activeTurnId = ref<string | null>(null);
const turnActive = computed(() => !['idle', 'failed', 'stopped'].includes(status.value));
```

Maintain a module-local `Map<string, (decision: AiToolDecision) => void>` for pending decisions. `clearConversation`, `stopTurn`, and failed-turn cleanup must resolve every pending decision as `cancelled` before clearing the map.

- [ ] **Step 4: Add immutable tool updates**

Expose `appendToolCall`, `updateToolCall`, `waitForToolDecision`, `resolveToolDecision`, `beginTurn`, `finishTurn`, and `stopTurn`. Tool calls remain in the store after completion so closing and reopening the panel preserves the timeline.

- [ ] **Step 5: Run store tests**

```bash
pnpm test src/stores/aiConversationStore.spec.ts
```

Expected: PASS.

### Task 4: Target-session terminal workspace port

**Files:**

- Modify: `src/stores/workspaceStore.ts`
- Modify: `src/stores/workspaceStore.spec.ts`

- [ ] **Step 1: Write failing target-session tests**

```ts
it('writes and interrupts the requested session even after focus changes', async () => {
  const store = useWorkspaceStore();
  await store.writeToSession('session-1', 'pwd\r');
  await store.interruptSession('session-1');

  expect(client.write).toHaveBeenCalledWith('session-1', expect.any(Uint8Array));
  expect(client.interrupt).toHaveBeenCalledWith('session-1');
});

it('reports whether output matched a completion marker or timed out', async () => {
  const result = await store.waitForSessionTerminalOutput(
    { sessionId: 'session-1', sequence: 1 },
    { until: (output) => output.includes('__DONE__'), timeoutMs: 20 },
  );
  expect(result.reason).toBe('timeout');
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm test src/stores/workspaceStore.spec.ts
```

Expected: FAIL because target-session APIs and `interrupt` are missing from the test port.

- [ ] **Step 3: Extend the workspace session client and result types**

```ts
export interface TerminalOutputWaitResult {
  output: string;
  reason: 'matched' | 'idle' | 'timeout' | 'sessionClosed';
  truncated: boolean;
}

export interface WaitForTerminalOutputOptions {
  idleMs?: number;
  maxBytes?: number;
  timeoutMs?: number;
  settleOnIdle?: boolean;
  until?: (output: string) => boolean;
}
```

Add `interrupt(sessionId)` to `WorkspaceSessionClient`. Add public `writeToSession`, `interruptSession`, `getTerminalOutputCursor(sessionId)`, and `waitForSessionTerminalOutput`. Existing focused-session methods delegate to these functions and keep returning strings for compatibility.

- [ ] **Step 4: Make wait cleanup deterministic**

The wait function must clear idle/timeout timers and unsubscribe exactly once. `removeSessionState()` must resolve active waits with `sessionClosed`, not leave them pending. `until(output)` is evaluated after every output chunk; when true, settle with `matched`.

- [ ] **Step 5: Run workspace tests**

```bash
pnpm test src/stores/workspaceStore.spec.ts
```

Expected: PASS.

### Task 5: Terminal tool runner and blocking controls

**Files:**

- Create: `src/services/terminalToolRunner.ts`
- Create: `src/services/terminalToolRunner.spec.ts`

- [ ] **Step 1: Write failing terminal-runner tests**

```ts
it('binds execution to the initial session and completes on the marker', async () => {
  workspace.waitForSessionTerminalOutput.mockResolvedValue({
    output: 'result\n__FLEURTERM_DONE_call_1:0',
    reason: 'matched',
    truncated: false,
  });

  const result = await runner.execute(call, { shell: 'zsh', signal });

  expect(workspace.writeToSession).toHaveBeenCalledWith(
    'session-1',
    expect.stringContaining('__FLEURTERM_DONE_call_1'),
  );
  expect(result).toMatchObject({ outcome: 'completed', output: 'result' });
});

it('stays blocked until the user selects an action', async () => {
  workspace.waitForSessionTerminalOutput.mockResolvedValueOnce({
    output: 'Password:',
    reason: 'timeout',
    truncated: false,
  });
  const resultPromise = runner.execute(call, { shell: 'zsh', signal });
  await flushPromises();
  decisions.resolve('call-1', 'usePartialOutput');
  await expect(resultPromise).resolves.toMatchObject({ outcome: 'partial', output: 'Password:' });
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm test src/services/terminalToolRunner.spec.ts
```

Expected: FAIL because the runner does not exist.

- [ ] **Step 3: Implement shell completion markers**

```ts
export function wrapTerminalCommand(
  command: string,
  shell: string,
  callId: string,
): WrappedCommand {
  const marker = `__FLEURTERM_DONE_${sanitizeCallId(callId)}`;
  const shellName = shell.toLowerCase();
  if (shellName.includes('powershell') || shellName.includes('pwsh')) {
    return { marker, input: `& { ${command} }; Write-Output "${marker}:$LASTEXITCODE"\r` };
  }
  if (shellName.includes('cmd')) {
    return { marker, input: `${command} & echo ${marker}:%errorlevel%\r` };
  }
  return {
    marker,
    input: `{ ${command}; }; __fleurterm_exit=$?; printf '\\n${marker}:%s\\n' "$__fleurterm_exit"\r`,
  };
}
```

Unknown shells use unwrapped input and `settleOnIdle: true`; known shells wait for the marker with `settleOnIdle: false`.

- [ ] **Step 4: Implement execute, blocked actions, and cleanup**

`execute()` captures `targetSessionId` and cursor before writing, updates the store through injected callbacks, strips the marker from output, and returns an `AiToolResult`. On timeout it updates the call to `blocked` and awaits one decision:

- `continueWaiting` starts another wait from the latest cursor;
- `interrupt` invokes `interruptSession(targetSessionId)` and returns `cancelled`;
- `usePartialOutput` returns `partial` with captured output;
- `cancelled` aborts without another model request.

AbortSignal cancellation must interrupt pending waits and remove listeners.

- [ ] **Step 5: Run terminal-runner tests**

```bash
pnpm test src/services/terminalToolRunner.spec.ts
```

Expected: PASS.

### Task 6: Single Codex-style conversation runner

**Files:**

- Create: `src/services/aiConversationRunner.ts`
- Create: `src/services/aiConversationRunner.spec.ts`
- Modify: `src/services/aiClient.ts`
- Modify: `src/services/aiClient.spec.ts`

- [ ] **Step 1: Write failing approval-loop tests**

```ts
it('keeps ask mode active through approval, execution, result return, and continuation', async () => {
  sendChat
    .mockResolvedValueOnce('<terminal-command>pwd</terminal-command>')
    .mockResolvedValueOnce('The directory is `/project`.');
  terminalRunner.execute.mockResolvedValue({
    callId: expect.any(String),
    outcome: 'completed',
    command: 'pwd',
    output: '/project',
    truncated: false,
  });

  const turn = runner.send('where am I?');
  await flushPromises();
  expect(store.status.value).toBe('awaitingApproval');
  store.resolveToolDecision(store.toolCalls.value[0]!.id, 'approved');
  await turn;

  expect(sendChat).toHaveBeenCalledTimes(2);
  expect(sendChat.mock.calls[1]?.[1]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ content: expect.stringContaining('/project') }),
    ]),
  );
  expect(store.status.value).toBe('idle');
});
```

Also add tests for denial continuation, `auto` safe execution, `auto` risky approval, `fullAccess`, blocked state, stop, and six-step limit.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm test src/services/aiConversationRunner.spec.ts
```

Expected: FAIL because the runner does not exist.

- [ ] **Step 3: Implement runner dependencies and API**

```ts
export interface AiConversationRunnerDependencies {
  sendChat: typeof sendAiChat;
  conversation: ReturnType<typeof useAiConversationStore>;
  settings: ReturnType<typeof useAppSettingsStore>;
  workspace: ReturnType<typeof useWorkspaceStore>;
  terminalRunner: TerminalToolRunner;
  runAppAction: (action: AiAppAction) => Promise<AiToolResult>;
}

export interface AiConversationRunner {
  send(content: string, snapshot: SessionSnapshot | null): Promise<void>;
  stop(): void;
  approve(callId: string): void;
  deny(callId: string): void;
  continueWaiting(callId: string): void;
  interrupt(callId: string): void;
  usePartialOutput(callId: string): void;
}
```

- [ ] **Step 4: Implement the single turn loop**

For each of at most six steps:

1. set `thinking` or `continuing`;
2. call `sendAiChat`, changing to `streaming` on first delta;
3. parse and store assistant content/tool calls;
4. for each tool, classify risk and decide approval from policy;
5. denied calls produce a denied result; approved calls use `terminalRunner.execute`;
6. append assistant raw response plus labeled tool results to request messages;
7. finish at `idle` only when no new executable tool remains.

`finally` must not overwrite `failed` or `stopped` with `idle`. App-action results use the same labeled result path.

- [ ] **Step 5: Extend AI client message roles without coupling orchestration**

Keep provider payloads compatible by serializing provider-neutral tool results as labeled `system` messages for the current tag adapter. Do not add provider-specific native tool calls in this task.

- [ ] **Step 6: Run runner and client tests**

```bash
pnpm test src/services/aiConversationRunner.spec.ts src/services/aiClient.spec.ts
```

Expected: PASS.

### Task 7: Tool status card

**Files:**

- Create: `src/components/AiToolCard.vue`
- Create: `src/components/AiToolCard.spec.ts`

- [ ] **Step 1: Write failing component tests**

```ts
it('shows approval controls for a proposed tool call', async () => {
  const wrapper = mount(AiToolCard, { props: { call: proposedCall, locale: 'en-US' } });
  expect(wrapper.text()).toContain('Approval required');
  await wrapper.get('[data-action="approve"]').trigger('click');
  expect(wrapper.emitted('approve')).toEqual([['call-1']]);
});

it('shows blocked recovery actions and expandable output', async () => {
  const wrapper = mount(AiToolCard, { props: { call: blockedCall, locale: 'zh-CN' } });
  expect(wrapper.text()).toContain('等待终端输入');
  expect(wrapper.get('[data-action="continue-waiting"]').exists()).toBe(true);
  expect(wrapper.get('[data-action="interrupt"]').exists()).toBe(true);
  expect(wrapper.get('[data-action="use-partial"]').exists()).toBe(true);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm test src/components/AiToolCard.spec.ts
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the card**

The component receives one `AiTerminalToolCall` and emits `approve`, `deny`, `continueWaiting`, `interrupt`, and `usePartialOutput` with the call ID. Render:

- localized status and risk;
- target session label;
- full command in a `<pre><code>` block;
- elapsed duration for running/completed calls;
- an output summary with a native disclosure button;
- only the actions valid for the current status.

Use `aria-live="polite"` for status text and explicit button labels.

- [ ] **Step 4: Run component tests**

```bash
pnpm test src/components/AiToolCard.spec.ts
```

Expected: PASS.

### Task 8: Refactor AIPanel into runner-driven presentation

**Files:**

- Modify: `src/components/AIPanel.vue`
- Modify: `src/components/AIPanel.spec.ts`
- Modify: `src/App.vue`
- Modify: `src/App.spec.ts`

- [ ] **Step 1: Replace orchestration tests with runner interaction tests**

Update `AIPanel.spec.ts` to inject/mock the runner and verify:

```ts
expect(wrapper.get('.ai-panel-turn-status').text()).toContain('Waiting for approval');
await wrapper.get('[data-action="approve"]').trigger('click');
expect(runner.approve).toHaveBeenCalledWith('call-1');
```

Retain tests for Markdown, tables, streaming content, localization, resizing, history, retry, and configuration readiness.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm test src/components/AIPanel.spec.ts src/App.spec.ts
```

Expected: FAIL because the panel still owns the old loop and emits terminal commands.

- [ ] **Step 3: Remove model/terminal orchestration from AIPanel**

Delete `runFullAccessConversation`, `runAiTurn`, `runTerminalCommandAndReadOutput`, and policy-specific terminal branching from the component. `sendDraft`, retry, stop, and tool buttons call the injected/composed conversation runner.

Render `AiToolCard` entries in chronological order with assistant messages. Use `conversation.turnActive` instead of `status === 'sending'` for composer disabling and the stop button.

- [ ] **Step 4: Simplify App integration**

Remove `runTerminalCommand` from `AIPanel` emits and `App.vue` listeners. Keep `runAppAction`, but expose it to the conversation runner as an async dependency returning a submitted/failed result. Update App stubs and tests accordingly.

- [ ] **Step 5: Run panel and app tests**

```bash
pnpm test src/components/AIPanel.spec.ts src/App.spec.ts
```

Expected: PASS.

### Task 9: AI panel visual system

**Files:**

- Modify: `src/styles/global.css`
- Test: `src/components/AIPanel.spec.ts`
- Test: `src/components/AiToolCard.spec.ts`

- [ ] **Step 1: Add structural style assertions before CSS changes**

Assert that the panel renders `.ai-panel-model`, `.ai-panel-turn-status`, `.ai-message-user`, `.ai-message-assistant`, `.ai-tool-card`, `.ai-tool-command`, `.ai-tool-output`, and `.ai-panel-composer-shell`.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm test src/components/AIPanel.spec.ts src/components/AiToolCard.spec.ts
```

Expected: FAIL until the new markup is present.

- [ ] **Step 3: Implement the dark timeline and composer styles**

Use existing tokens and these relationships:

```css
.ai-panel {
  background: var(--color-canvas);
  box-shadow: -20px 0 44px rgb(0 0 0 / 24%);
}

.ai-message-user {
  max-width: 88%;
  padding: 10px 12px;
  border-radius: 12px 12px 4px 12px;
  background: var(--color-surface-raised);
}

.ai-tool-card {
  border-radius: 10px;
  background: var(--color-surface-card-soft);
  box-shadow: inset 0 0 0 1px var(--color-border);
}

.ai-tool-card[data-status='proposed'] {
  --tool-accent: var(--color-accent);
}
.ai-tool-card[data-status='blocked'] {
  --tool-accent: var(--color-warning);
}
.ai-tool-card[data-status='failed'] {
  --tool-accent: var(--color-danger);
}

.ai-panel-composer-shell {
  border-radius: 12px;
  background: var(--color-surface-raised);
  box-shadow: inset 0 0 0 1px var(--color-border);
}
```

Assistant prose remains borderless. Tool output defaults to a bounded summary. Use a subtle pulse only for `running`/`waitingTerminal`; disable it under `prefers-reduced-motion`.

- [ ] **Step 4: Run component tests and Prettier**

```bash
pnpm test src/components/AIPanel.spec.ts src/components/AiToolCard.spec.ts
pnpm exec prettier --check src/components/AIPanel.vue src/components/AiToolCard.vue src/styles/global.css
```

Expected: PASS.

### Task 10: Full regression and desktop build

**Files:**

- Verify all files modified by Tasks 1–9.

- [ ] **Step 1: Run all frontend tests**

```bash
pnpm test
```

Expected: all test files and tests pass.

- [ ] **Step 2: Run static validation**

```bash
pnpm typecheck
pnpm lint
pnpm exec prettier --check src/services/aiToolProtocol.ts src/services/aiCommandRisk.ts src/services/terminalToolRunner.ts src/services/aiConversationRunner.ts src/components/AiToolCard.vue src/components/AIPanel.vue src/styles/global.css
```

Expected: zero errors and zero warnings.

- [ ] **Step 3: Run production build**

```bash
pnpm build
```

Expected: Vite production build succeeds.

- [ ] **Step 4: Run Rust regressions**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all Rust tests pass; the two existing non-Windows credential dead-code warnings may remain.

- [ ] **Step 5: Build the Tauri desktop application**

```bash
pnpm tauri build --debug --no-bundle
```

Expected: debug application builds at `src-tauri/target/debug/fleurterm`.

- [ ] **Step 6: Inspect the final diff**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; unrelated existing user changes remain untouched.

### Task 11: Codex-style fixed approval dock

**Files:**

- Modify: `src/components/AIPanel.vue`
- Modify: `src/components/AIPanel.spec.ts`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Write a failing approval-placement test**

Add a component test that creates a `proposed` terminal call and verifies it is excluded from `.ai-panel-thread`, rendered inside `.ai-approval-dock` above the composer, and still delegates approval to the active conversation runner:

```ts
expect(wrapper.find('.ai-panel-thread .ai-tool-card').exists()).toBe(false);
expect(wrapper.get('.ai-approval-dock .ai-tool-card').exists()).toBe(true);
await wrapper.get('.ai-approval-dock [data-action="approve"]').trigger('click');
expect(runner.approve).toHaveBeenCalledWith('call-1');
```

Update the same call to `approved`, then verify the dock disappears and the tool card returns to the timeline.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm test src/components/AIPanel.spec.ts
```

Expected: FAIL because proposed tool calls are still rendered in `.ai-panel-thread` and `.ai-approval-dock` does not exist.

- [ ] **Step 3: Separate pending approval from the timeline**

Add a `pendingApprovalCall` computed value for the first `proposed` tool call. Filter `proposed` calls out of the timeline. Wrap the composer in `.ai-panel-input-region` and render the pending call through `AiToolCard` inside `.ai-approval-dock` immediately above the composer. Reuse the existing runner callbacks; do not duplicate decision logic.

- [ ] **Step 4: Add fixed approval-dock styling**

Keep `.ai-panel-thread` as the only scrolling region. Style `.ai-panel-input-region` as a non-scrolling footer and `.ai-approval-dock` as a distinct surface above the composer. Use a short opacity/translate transition and preserve `prefers-reduced-motion` behavior.

- [ ] **Step 5: Run targeted and full verification**

```bash
pnpm test src/components/AIPanel.spec.ts src/components/AiToolCard.spec.ts
pnpm typecheck
pnpm lint
pnpm exec prettier --check src/components/AIPanel.vue src/components/AIPanel.spec.ts src/styles/global.css
pnpm test
pnpm build
```

Expected: all commands pass with zero failures and zero lint errors.

## Execution Notes

- Use TDD for every behavior change: add one failing test, verify the expected failure, implement the minimum, and rerun targeted tests before broader validation.
- Do not rewrite the current working tree or discard unrelated icon, platform, settings, terminal, or Markdown changes.
- Do not create Git commits unless the user explicitly requests them; the workspace already contains unrelated uncommitted changes.
- Keep the current provider/tag transport working throughout the refactor. The application must remain buildable after each task.
