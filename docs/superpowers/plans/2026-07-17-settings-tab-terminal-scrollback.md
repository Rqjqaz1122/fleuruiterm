# Settings Tab and Terminal Scrollback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a singleton, closable settings tab and make terminal sizing, scrollback, input scrolling, and history-position behavior match Tabby.

**Architecture:** Keep terminal sessions and terminal tabs in the existing Pinia workspace store, then derive a small discriminated application-tab model in the Vue application shell for the settings singleton. Extend `TerminalAdapter` with an injected animation-frame scheduler and the minimal xterm scrolling surface so sizing and viewport behavior remain independently testable.

**Tech Stack:** Vue 3, TypeScript 5.9, Pinia 3, xterm.js 5.5, Vitest 3, Vue Test Utils, Vite 7, Tauri 2, pnpm 11.9.

---

## File map

- Create `src/domain/appTab.ts`: define the application-level terminal/settings tab union and mapping functions.
- Modify `src/components/TerminalTabs.vue`: render and navigate the mixed application-tab list.
- Modify `src/components/TerminalTabs.spec.ts`: cover mixed-tab semantics, icons, ARIA links, navigation, and close events.
- Modify `src/App.vue`: own settings-tab lifecycle and coordinate it with the workspace store.
- Modify `src/App.spec.ts`: cover settings singleton, switching, closing, fallback, and terminal lifecycle synchronization.
- Modify `src/terminal/terminalAdapter.ts`: add deferred fit, cancellation, input scroll-to-bottom, viewport preservation, and resize deduplication.
- Modify `src/terminal/terminalAdapter.spec.ts`: verify scheduling, disposal, scrolling, output position, resize position, and existing bridge behavior.
- Modify `src/components/TerminalPane.vue`: configure Tabby’s 25,000-line buffer and inject browser frame scheduling.
- Modify `src/components/SettingsView.vue`: remove the obsolete back action and display static Tabby scroll settings.
- Modify `src/components/SettingsView.spec.ts`: verify the static scroll settings and removal of the page-level close action.
- Modify `src/styles/global.css`: make the tab strip available for settings-only state and make the terminal surface flex into all remaining pane height.

### Task 1: Introduce mixed application tabs

**Files:**

- Create: `src/domain/appTab.ts`
- Modify: `src/components/TerminalTabs.vue`
- Test: `src/components/TerminalTabs.spec.ts`

- [ ] **Step 1: Write failing mixed-tab component tests**

Replace the fixture with application tabs and add assertions for the settings icon, panel mapping, navigation, and close event:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { AppTab } from '@/domain/appTab';

import TerminalTabs from './TerminalTabs.vue';

const tabs: AppTab[] = [
  {
    id: 'tab-1',
    kind: 'terminal',
    title: 'Local Terminal 1',
    panelId: 'terminal-panel-tab-1',
  },
  {
    id: 'app-settings',
    kind: 'settings',
    title: 'Settings',
    panelId: 'settings-panel',
  },
];

describe('TerminalTabs', () => {
  it('uses a roving tab stop and links every app tab to its panel', () => {
    const wrapper = mount(TerminalTabs, { props: { tabs, activeTabId: 'tab-1' } });
    const tabButtons = wrapper.findAll('[role="tab"]');

    expect(tabButtons[0]?.attributes()).toMatchObject({
      id: 'app-tab-tab-1',
      tabindex: '0',
      'aria-controls': 'terminal-panel-tab-1',
    });
    expect(tabButtons[1]?.attributes()).toMatchObject({
      id: 'app-tab-app-settings',
      tabindex: '-1',
      'aria-controls': 'settings-panel',
    });
  });

  it('navigates across terminal and settings tabs with arrow keys', async () => {
    const wrapper = mount(TerminalTabs, { props: { tabs, activeTabId: 'tab-1' } });

    await wrapper.findAll('[role="tab"]')[0]?.trigger('keydown', { key: 'ArrowRight' });

    expect(wrapper.emitted('activate')).toEqual([['app-settings']]);
  });

  it('renders terminal status and a settings icon without a settings status dot', () => {
    const wrapper = mount(TerminalTabs, { props: { tabs, activeTabId: 'app-settings' } });

    expect(wrapper.find('[data-tab-id="tab-1"] .status-dot').exists()).toBe(true);
    expect(wrapper.find('[data-tab-id="app-settings"] .status-dot').exists()).toBe(false);
    expect(wrapper.get('[data-tab-id="app-settings"] .settings-tab-icon').text()).toBe('⚙');
  });

  it('emits close for either app-tab kind', async () => {
    const wrapper = mount(TerminalTabs, { props: { tabs, activeTabId: 'app-settings' } });

    await wrapper.get('[aria-label="Close Settings"]').trigger('click');

    expect(wrapper.emitted('close')).toEqual([['app-settings']]);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
pnpm vitest run src/components/TerminalTabs.spec.ts
```

Expected: FAIL because `@/domain/appTab` does not exist and `TerminalTabs` still expects `TerminalTab[]`.

- [ ] **Step 3: Add the application-tab domain model**

Create `src/domain/appTab.ts`:

```ts
import type { TerminalTab } from '@/domain/workspace';

export const SETTINGS_TAB_ID = 'app-settings';
export const SETTINGS_PANEL_ID = 'settings-panel';

export interface TerminalAppTab {
  id: string;
  kind: 'terminal';
  title: string;
  panelId: string;
}

export interface SettingsAppTab {
  id: typeof SETTINGS_TAB_ID;
  kind: 'settings';
  title: 'Settings';
  panelId: typeof SETTINGS_PANEL_ID;
}

export type AppTab = TerminalAppTab | SettingsAppTab;

export function toTerminalAppTab(tab: TerminalTab): TerminalAppTab {
  return {
    id: tab.id,
    kind: 'terminal',
    title: tab.title,
    panelId: `terminal-panel-${tab.id}`,
  };
}

export function createSettingsAppTab(): SettingsAppTab {
  return {
    id: SETTINGS_TAB_ID,
    kind: 'settings',
    title: 'Settings',
    panelId: SETTINGS_PANEL_ID,
  };
}
```

- [ ] **Step 4: Update the tab strip to consume `AppTab[]`**

Change the component’s type import and props:

```ts
import type { AppTab } from '@/domain/appTab';

const props = defineProps<{
  tabs: AppTab[];
  activeTabId: string | null;
}>();
```

Use application IDs for focus and each tab’s own panel ID:

```ts
document.getElementById(`app-tab-${targetTab.id}`)?.focus();
```

```vue
<div
  v-for="tab in tabs"
  :key="tab.id"
  class="tab-item"
  :class="{ active: tab.id === activeTabId }"
  :data-tab-id="tab.id"
>
  <button
    :id="`app-tab-${tab.id}`"
    class="tab-button"
    role="tab"
    type="button"
    :tabindex="tab.id === activeTabId ? 0 : -1"
    :aria-selected="tab.id === activeTabId"
    :aria-controls="tab.panelId"
    @click="$emit('activate', tab.id)"
    @keydown="handleTabKey($event, tab.id)"
  >
    <span v-if="tab.kind === 'terminal'" class="status-dot" aria-hidden="true" />
    <span v-else class="settings-tab-icon" aria-hidden="true">⚙</span>
    <span class="tab-label">{{ tab.title }}</span>
  </button>
  <button
    class="icon-button tab-close"
    type="button"
    :aria-label="`Close ${tab.title}`"
    @click.stop="$emit('close', tab.id)"
  >
    ×
  </button>
</div>
```

- [ ] **Step 5: Run the focused test and confirm it passes**

Run:

```bash
pnpm vitest run src/components/TerminalTabs.spec.ts
```

Expected: all `TerminalTabs` tests PASS.

- [ ] **Step 6: Commit the mixed-tab component**

```bash
git add src/domain/appTab.ts src/components/TerminalTabs.vue src/components/TerminalTabs.spec.ts
git commit -m "feat: support mixed application tabs"
```

### Task 2: Implement the singleton settings-tab lifecycle

**Files:**

- Modify: `src/App.vue`
- Test: `src/App.spec.ts`

- [ ] **Step 1: Replace overlay-page tests with failing settings-tab lifecycle tests**

Keep the existing terminal, split, error, retry, and mounted-background tests. Replace the old settings overlay and focus tests with:

```ts
it('opens settings as a singleton application tab', async () => {
  const wrapper = mount(App);

  await wrapper.get('[data-testid="start-settings"]').trigger('click');
  await wrapper.get('[data-testid="titlebar-settings"]').trigger('click');

  expect(wrapper.findAll('[data-tab-id="app-settings"]')).toHaveLength(1);
  expect(wrapper.get('[data-tab-id="app-settings"] [role="tab"]').attributes('aria-selected')).toBe(
    'true',
  );
  expect(wrapper.get('#settings-panel').exists()).toBe(true);
});

it('switches between settings and an existing terminal tab', async () => {
  const store = useWorkspaceStore();
  store.workspace = createWorkspace('session-a', ids('tab-1', 'pane-1'));
  const wrapper = mount(App, { global: { stubs: { TerminalPane: true } } });

  await wrapper.get('[data-testid="titlebar-settings"]').trigger('click');
  await wrapper.get('[data-tab-id="tab-1"] [role="tab"]').trigger('click');

  expect(store.workspace.activeTabId).toBe('tab-1');
  expect(wrapper.get('#terminal-panel-tab-1').attributes('aria-hidden')).toBe('false');
  expect(wrapper.get('#settings-panel').attributes('aria-hidden')).toBe('true');
});

it('closes settings and returns to the most recently active terminal', async () => {
  const store = useWorkspaceStore();
  store.workspace = createWorkspace('session-a', ids('tab-1', 'pane-1'));
  const wrapper = mount(App, { global: { stubs: { TerminalPane: true } } });

  await wrapper.get('[data-testid="titlebar-settings"]').trigger('click');
  await wrapper.get('[aria-label="Close Settings"]').trigger('click');

  expect(wrapper.find('[data-tab-id="app-settings"]').exists()).toBe(false);
  expect(wrapper.get('#terminal-panel-tab-1').attributes('aria-hidden')).toBe('false');
});

it('closes settings to the start page when no terminal exists', async () => {
  const wrapper = mount(App);

  await wrapper.get('[data-testid="start-settings"]').trigger('click');
  await wrapper.get('[aria-label="Close Settings"]').trigger('click');

  expect(wrapper.get('[aria-label="FleurTerm start page"]').exists()).toBe(true);
});
```

- [ ] **Step 2: Run the app-shell tests and confirm they fail**

Run:

```bash
pnpm vitest run src/App.spec.ts
```

Expected: FAIL because settings is not part of the tab strip and still closes through an internal back action.

- [ ] **Step 3: Derive application tabs and track the active application tab**

Replace `AppView`/`currentView` with these imports and state:

```ts
import { computed, ref } from 'vue';

import {
  createSettingsAppTab,
  SETTINGS_TAB_ID,
  toTerminalAppTab,
  type AppTab,
} from '@/domain/appTab';

const settingsTabOpen = ref(false);
const activeAppTabId = ref<string | null>(workspace.value.activeTabId);
const lastActiveTerminalTabId = ref<string | null>(workspace.value.activeTabId);

const appTabs = computed<AppTab[]>(() => {
  const terminalTabs = workspace.value.tabs.map(toTerminalAppTab);
  return settingsTabOpen.value ? [...terminalTabs, createSettingsAppTab()] : terminalTabs;
});

const settingsActive = computed(() => activeAppTabId.value === SETTINGS_TAB_ID);
```

- [ ] **Step 4: Add explicit open, activate, and close routing**

Use these functions in `App.vue`:

```ts
function openSettings(): void {
  settingsTabOpen.value = true;
  activeAppTabId.value = SETTINGS_TAB_ID;
}

function activateAppTab(tabId: string): void {
  if (tabId === SETTINGS_TAB_ID) {
    openSettings();
    return;
  }
  store.activateTab(tabId);
  activeAppTabId.value = tabId;
  lastActiveTerminalTabId.value = tabId;
}

async function closeAppTab(tabId: string): Promise<void> {
  if (tabId === SETTINGS_TAB_ID) {
    closeSettingsTab();
    return;
  }
  await runAction(() => store.closeTab(tabId));
  const closedTabStillExists = workspace.value.tabs.some((tab) => tab.id === tabId);
  if (activeAppTabId.value === tabId && !closedTabStillExists) {
    activeAppTabId.value = store.workspace.activeTabId;
    lastActiveTerminalTabId.value = store.workspace.activeTabId;
  }
}

function closeSettingsTab(): void {
  settingsTabOpen.value = false;
  const fallbackTabId = lastActiveTerminalTabId.value;
  const fallbackExists = workspace.value.tabs.some((tab) => tab.id === fallbackTabId);
  const nextTabId = fallbackExists ? fallbackTabId : workspace.value.activeTabId;
  activeAppTabId.value = nextTabId;
  if (nextTabId !== null) {
    store.activateTab(nextTabId);
    lastActiveTerminalTabId.value = nextTabId;
  }
}
```

After a successful `openTab`, synchronize the new active terminal:

```ts
async function openTerminal(): Promise<void> {
  await runAction(async () => {
    await store.openTab();
    activeAppTabId.value = store.workspace.activeTabId;
    lastActiveTerminalTabId.value = store.workspace.activeTabId;
  });
}
```

- [ ] **Step 5: Render the unified tab strip and persistent panels**

Pass `appTabs` and application events to the tab strip whenever at least one application tab exists:

```vue
<TerminalTabs
  v-if="appTabs.length > 0"
  :tabs="appTabs"
  :active-tab-id="activeAppTabId"
  @activate="activateAppTab"
  @close="closeAppTab"
  @new-terminal="openTerminal"
/>
```

Render settings as a tab panel and keep the workspace mounted but inert while settings is active:

```vue
<div class="app-content">
  <section
    v-if="settingsTabOpen"
    id="settings-panel"
    class="settings-tab-panel"
    role="tabpanel"
    :aria-hidden="!settingsActive"
    aria-labelledby="app-tab-app-settings"
    :inert="!settingsActive"
  >
    <SettingsView />
  </section>
  <section
    class="workspace"
    :class="{ 'settings-covered': settingsActive }"
    aria-label="Terminal workspace"
    :aria-hidden="settingsActive"
    :inert="settingsActive"
  >
    <div
      v-for="tab in workspace.tabs"
      :id="`terminal-panel-${tab.id}`"
      :key="tab.id"
      class="workspace-tab-panel"
      :class="{ active: tab.id === activeAppTabId && !settingsActive }"
      role="tabpanel"
      :aria-hidden="tab.id !== activeAppTabId || settingsActive"
      :aria-labelledby="`app-tab-${tab.id}`"
      :inert="tab.id !== activeAppTabId || settingsActive"
    >
      <WorkspacePane
        :node="tab.root"
        :focused-pane-id="workspace.focusedPaneId"
        @split="splitTerminal"
        @close="closePane"
        @focus="store.focusPane"
      />
    </div>
    <StartPage
      v-if="workspace.tabs.length === 0"
      :pending="actionPending"
      aria-label="FleurTerm start page"
      @create-terminal="openTerminal"
      @open-settings="openSettings"
    />
  </section>
</div>
```

Change each terminal panel’s active state and label link to use application state:

```vue
:class="{ active: tab.id === activeAppTabId && !settingsActive }" :aria-hidden="tab.id !==
activeAppTabId || settingsActive" :aria-labelledby="`app-tab-${tab.id}`"
```

- [ ] **Step 6: Run app and tab tests**

Run:

```bash
pnpm vitest run src/App.spec.ts src/components/TerminalTabs.spec.ts
```

Expected: all app-shell and tab-strip tests PASS.

- [ ] **Step 7: Commit the application-shell lifecycle**

```bash
git add src/App.vue src/App.spec.ts
git commit -m "feat: open settings as a singleton tab"
```

### Task 3: Implement deferred fitting and Tabby-style viewport behavior

**Files:**

- Modify: `src/terminal/terminalAdapter.ts`
- Test: `src/terminal/terminalAdapter.spec.ts`

- [ ] **Step 1: Extend the fake terminal and add failing behavior tests**

Add these members to `FakeTerminal`:

```ts
readonly buffer = {
  active: {
    baseY: 0,
    viewportY: 0,
  },
};
scrollToBottom = vi.fn(() => {
  this.buffer.active.viewportY = this.buffer.active.baseY;
});
scrollToLine = vi.fn((line: number) => {
  this.buffer.active.viewportY = line;
});
```

Add an injected frame scheduler helper:

```ts
function createFrameScheduler() {
  let nextFrameId = 1;
  const callbacks = new Map<number, () => void>();
  return {
    requestFrame: vi.fn((callback: () => void) => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      callbacks.set(frameId, callback);
      return frameId;
    }),
    cancelFrame: vi.fn((frameId: number) => callbacks.delete(frameId)),
    runNextFrame() {
      const nextEntry = callbacks.entries().next().value as [number, () => void] | undefined;
      if (nextEntry === undefined) {
        return;
      }
      callbacks.delete(nextEntry[0]);
      nextEntry[1]();
    },
    pendingCount() {
      return callbacks.size;
    },
  };
}
```

Add tests:

```ts
it('fits again after two animation frames', async () => {
  const terminal = new FakeTerminal();
  const fitAddon = createFitAddon();
  const frames = createFrameScheduler();
  const adapter = createAdapter(
    terminal,
    createSessionClient(),
    vi.fn(),
    createResizeObserver(),
    1,
    {
      fitAddon,
      frames,
    },
  );

  adapter.open(document.createElement('div'));
  expect(fitAddon.fit).toHaveBeenCalledTimes(1);
  frames.runNextFrame();
  expect(fitAddon.fit).toHaveBeenCalledTimes(1);
  frames.runNextFrame();
  await Promise.resolve();
  expect(fitAddon.fit).toHaveBeenCalledTimes(2);
});

it('cancels a pending post-render fit on dispose', () => {
  const terminal = new FakeTerminal();
  const frames = createFrameScheduler();
  const adapter = createAdapter(
    terminal,
    createSessionClient(),
    vi.fn(),
    createResizeObserver(),
    1,
    {
      frames,
    },
  );

  adapter.open(document.createElement('div'));
  frames.runNextFrame();
  expect(frames.pendingCount()).toBe(1);
  adapter.dispose();
  expect(frames.pendingCount()).toBe(0);
  expect(frames.cancelFrame).toHaveBeenCalledOnce();
});

it('scrolls to the bottom before forwarding user input', async () => {
  const terminal = new FakeTerminal();
  terminal.buffer.active.baseY = 80;
  terminal.buffer.active.viewportY = 10;
  const sessionClient = createSessionClient();
  const adapter = createAdapter(terminal, sessionClient);
  adapter.open(document.createElement('div'));

  terminal.emitData('pwd\n');
  await Promise.resolve();

  expect(terminal.scrollToBottom).toHaveBeenCalledOnce();
  expect(sessionClient.write).toHaveBeenCalledOnce();
  expect(terminal.scrollToBottom.mock.invocationCallOrder[0]).toBeLessThan(
    sessionClient.write.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
  );
});

it('keeps the viewport position when output arrives while reading history', async () => {
  const terminal = new FakeTerminal();
  terminal.buffer.active.baseY = 100;
  terminal.buffer.active.viewportY = 40;
  const adapter = createAdapter(terminal, createSessionClient());
  adapter.open(document.createElement('div'));

  const consumption = adapter.acceptChunk({
    sessionId: 'session-a',
    sequence: 1,
    payload: [97],
  });
  terminal.buffer.active.baseY = 101;
  terminal.buffer.active.viewportY = 41;
  terminal.completeWrite();
  await consumption;

  expect(terminal.scrollToLine).toHaveBeenCalledWith(40);
});

it('stays pinned to the bottom after output and resize', async () => {
  const terminal = new FakeTerminal();
  terminal.buffer.active.baseY = 100;
  terminal.buffer.active.viewportY = 100;
  const observer = createResizeObserver();
  const adapter = createAdapter(terminal, createSessionClient(), vi.fn(), observer);
  adapter.open(document.createElement('div'));

  const consumption = adapter.acceptChunk({
    sessionId: 'session-a',
    sequence: 1,
    payload: [97],
  });
  terminal.buffer.active.baseY = 101;
  terminal.completeWrite();
  await consumption;
  observer.trigger();

  expect(terminal.scrollToBottom).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run adapter tests and confirm they fail**

Run:

```bash
pnpm vitest run src/terminal/terminalAdapter.spec.ts
```

Expected: FAIL because the adapter ports do not expose scrolling and no frame scheduler exists.

- [ ] **Step 3: Extend adapter ports and options**

Add these interfaces and members:

```ts
export interface TerminalBufferPort {
  readonly baseY: number;
  readonly viewportY: number;
}

export interface TerminalPort extends DisposablePort {
  readonly cols: number;
  readonly rows: number;
  readonly buffer: { readonly active: TerminalBufferPort };
  open(element: HTMLElement): void;
  write(data: Uint8Array, callback?: () => void): void;
  loadAddon(addon: FitAddonPort): void;
  onData(handler: (input: string) => void): DisposablePort;
  scrollToBottom(): void;
  scrollToLine(line: number): void;
}

export interface AnimationFrameScheduler {
  requestFrame(callback: () => void): number;
  cancelFrame(frameId: number): void;
}

export interface TerminalAdapterOptions {
  sessionId: string;
  initialSequence?: number;
  sessionClient: TerminalSessionClient;
  createTerminal: () => TerminalPort;
  createFitAddon: () => FitAddonPort;
  createResizeObserver: (callback: () => void) => ResizeObserverPort;
  frameScheduler: AnimationFrameScheduler;
  onError: (error: TerminalAdapterError) => void;
}

interface TerminalScrollState {
  pinnedToBottom: boolean;
  viewportY: number;
}
```

Add adapter state:

```ts
private pendingInitialFitFrameId: number | null = null;
private lastNotifiedColumns: number | null = null;
private lastNotifiedRows: number | null = null;
```

Update the test factory so every existing adapter test receives a deterministic scheduler:

```ts
interface AdapterFixtureOptions {
  fitAddon?: FitAddonPort;
  frames?: ReturnType<typeof createFrameScheduler>;
}

function createAdapter(
  terminal: FakeTerminal,
  sessionClient: ReturnType<typeof createSessionClient>,
  onError = vi.fn(),
  observer = createResizeObserver(),
  initialSequence = 1,
  fixtureOptions: AdapterFixtureOptions = {},
) {
  const fitAddon = fixtureOptions.fitAddon ?? createFitAddon();
  const frames = fixtureOptions.frames ?? createFrameScheduler();
  return new TerminalAdapter({
    sessionId: 'session-a',
    initialSequence,
    sessionClient,
    createTerminal: () => terminal,
    createFitAddon: () => fitAddon,
    createResizeObserver: (callback) => {
      observer.setCallback(callback);
      return observer;
    },
    frameScheduler: frames,
    onError,
  });
}
```

- [ ] **Step 4: Schedule the post-render fit and scroll on input**

Update `open`:

```ts
open(element: HTMLElement): void {
  this.terminal.loadAddon(this.fitAddon);
  this.terminal.open(element);
  this.inputSubscription = this.terminal.onData((input) => {
    this.terminal.scrollToBottom();
    void this.options.sessionClient
      .write(this.options.sessionId, new TextEncoder().encode(input))
      .catch((error: unknown) => this.reportClientError(error));
  });
  this.resizeObserver.observe(element);
  this.fitAndNotify();
  this.schedulePostRenderFit();
}

private schedulePostRenderFit(): void {
  this.pendingInitialFitFrameId = this.options.frameScheduler.requestFrame(() => {
    if (this.disposed) {
      return;
    }
    this.pendingInitialFitFrameId = this.options.frameScheduler.requestFrame(() => {
      this.pendingInitialFitFrameId = null;
      if (!this.disposed) {
        this.fitAndNotify();
      }
    });
  });
}
```

- [ ] **Step 5: Preserve viewport state around writes and fits**

Capture and restore scroll state:

```ts
private captureScrollState(): TerminalScrollState {
  const activeBuffer = this.terminal.buffer.active;
  return {
    pinnedToBottom: activeBuffer.viewportY === activeBuffer.baseY,
    viewportY: activeBuffer.viewportY,
  };
}

private restoreScrollState(scrollState: TerminalScrollState): void {
  if (scrollState.pinnedToBottom) {
    this.terminal.scrollToBottom();
    return;
  }
  const maximumViewportY = this.terminal.buffer.active.baseY;
  this.terminal.scrollToLine(Math.min(scrollState.viewportY, maximumViewportY));
}
```

Wrap output completion:

```ts
const scrollState = this.captureScrollState();
this.terminal.write(new Uint8Array(chunk.payload), () => {
  if (!this.disposed) {
    this.restoreScrollState(scrollState);
  }
  complete();
});
```

Update fitting and suppress duplicate PTY sizes:

```ts
private fitAndNotify(): void {
  if (this.disposed) {
    return;
  }
  const scrollState = this.captureScrollState();
  this.fitAddon.fit();
  this.restoreScrollState(scrollState);
  if (this.terminal.cols <= 0 || this.terminal.rows <= 0) {
    return;
  }
  if (
    this.terminal.cols === this.lastNotifiedColumns &&
    this.terminal.rows === this.lastNotifiedRows
  ) {
    return;
  }
  this.lastNotifiedColumns = this.terminal.cols;
  this.lastNotifiedRows = this.terminal.rows;
  void this.options.sessionClient
    .resize(this.options.sessionId, this.terminal.cols, this.terminal.rows)
    .catch((error: unknown) => this.reportClientError(error));
}
```

- [ ] **Step 6: Cancel the scheduled fit during disposal**

Insert before disposing xterm:

```ts
if (this.pendingInitialFitFrameId !== null) {
  this.options.frameScheduler.cancelFrame(this.pendingInitialFitFrameId);
  this.pendingInitialFitFrameId = null;
}
```

- [ ] **Step 7: Run adapter tests and confirm they pass**

Run:

```bash
pnpm vitest run src/terminal/terminalAdapter.spec.ts
```

Expected: all adapter tests PASS, including existing ordered-output and disposal cases.

- [ ] **Step 8: Commit terminal behavior**

```bash
git add src/terminal/terminalAdapter.ts src/terminal/terminalAdapter.spec.ts
git commit -m "fix: match Tabby terminal scrolling behavior"
```

### Task 4: Fill terminal height and expose static Tabby settings

**Files:**

- Modify: `src/components/TerminalPane.vue`
- Modify: `src/components/SettingsView.vue`
- Modify: `src/components/SettingsView.spec.ts`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Write failing settings presentation tests**

Replace the old back-action test with:

```ts
it('shows Tabby scrollback defaults as read-only terminal settings', async () => {
  const wrapper = mount(SettingsView);

  await wrapper.get('[data-section="terminal"]').trigger('click');

  const settingsPanel = wrapper.get('[data-testid="settings-panel"]');
  expect(settingsPanel.text()).toContain('Scrollback');
  expect(settingsPanel.get('[data-testid="scrollback-lines"]').attributes('value')).toBe('25000');
  expect(settingsPanel.text()).toContain('Scroll on input');
  expect(settingsPanel.get('[data-testid="scroll-on-input"]').attributes()).toHaveProperty(
    'checked',
  );
  expect(wrapper.find('[data-testid="close-settings"]').exists()).toBe(false);
});
```

- [ ] **Step 2: Run the settings test and confirm it fails**

Run:

```bash
pnpm vitest run src/components/SettingsView.spec.ts
```

Expected: FAIL because the scroll settings are absent and the obsolete back button remains.

- [ ] **Step 3: Configure xterm and inject browser frame scheduling**

Define and use the Tabby scrollback constant in `TerminalPane.vue`:

```ts
const TABBY_DEFAULT_SCROLLBACK_LINES = 25_000;
```

```ts
scrollback: TABBY_DEFAULT_SCROLLBACK_LINES,
```

Pass the scheduler to `TerminalAdapter`:

```ts
frameScheduler: {
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
},
```

- [ ] **Step 4: Replace the settings back action with static terminal controls**

Remove `defineEmits`, the `.settings-back` button, and its now-unused styling. Add these rows to the terminal settings group:

```vue
<label class="setting-row">
  <span>
    <strong>Scrollback</strong>
    <small>Number of lines kept in the buffer.</small>
  </span>
  <input data-testid="scrollback-lines" type="number" value="25000" disabled />
</label>
<label class="setting-row">
  <span>
    <strong>Scroll on input</strong>
    <small>Scroll to the bottom when typing.</small>
  </span>
  <input data-testid="scroll-on-input" type="checkbox" checked disabled />
</label>
```

- [ ] **Step 5: Make the terminal surface consume all remaining height**

Replace the fragile three-row grid with a column flex layout:

```css
.terminal-pane {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid transparent;
  background: var(--color-terminal);
}

.pane-toolbar,
.pane-error {
  flex: 0 0 auto;
}

.terminal-surface {
  min-width: 0;
  min-height: 0;
  flex: 1 1 0;
  padding: 7px 6px;
  background: var(--color-terminal);
}
```

Add a settings panel container that follows the same visibility model as terminal panels:

```css
.settings-tab-panel {
  position: absolute;
  inset: 0;
  min-width: 0;
  min-height: 0;
  visibility: hidden;
  pointer-events: none;
}

.settings-tab-panel[aria-hidden='false'] {
  visibility: visible;
  pointer-events: auto;
}
```

- [ ] **Step 6: Run affected component tests**

Run:

```bash
pnpm vitest run src/components/SettingsView.spec.ts src/App.spec.ts src/components/TerminalTabs.spec.ts src/terminal/terminalAdapter.spec.ts
```

Expected: all affected tests PASS.

- [ ] **Step 7: Commit the terminal pane and settings presentation**

```bash
git add src/components/TerminalPane.vue src/components/SettingsView.vue src/components/SettingsView.spec.ts src/styles/global.css
git commit -m "fix: fill terminal pane and show scroll defaults"
```

### Task 5: Run full regression and build verification

**Files:**

- Verify only; modify files only if a command exposes a defect in the preceding tasks.

- [ ] **Step 1: Format changed files**

Run:

```bash
pnpm prettier --write src/domain/appTab.ts src/App.vue src/App.spec.ts src/components/TerminalTabs.vue src/components/TerminalTabs.spec.ts src/terminal/terminalAdapter.ts src/terminal/terminalAdapter.spec.ts src/components/TerminalPane.vue src/components/SettingsView.vue src/components/SettingsView.spec.ts src/styles/global.css
```

Expected: Prettier exits with status 0.

- [ ] **Step 2: Run the full automated test suite**

Run:

```bash
pnpm test
```

Expected: all Vitest suites PASS.

- [ ] **Step 3: Run formatting, type, and lint checks**

Run:

```bash
pnpm format:check
pnpm typecheck
pnpm lint
```

Expected: all three commands exit with status 0 and ESLint reports no warnings.

- [ ] **Step 4: Build the web application**

Run:

```bash
pnpm build
```

Expected: Vue type checking and Vite production build complete successfully.

- [ ] **Step 5: Build the Tauri debug application**

Run:

```bash
pnpm tauri build --debug
```

Expected: the Rust/Tauri debug build completes successfully and produces the debug application bundle.

- [ ] **Step 6: Review the final diff for scope and dead code**

Run:

```bash
git diff --check
git status --short
git diff --stat fb62ba1..HEAD
```

Expected: no whitespace errors, no unexpected files, and changes remain limited to the application tabs, terminal adapter, settings display, and terminal layout.

- [ ] **Step 7: Hand off desktop visual verification to the user**

Report the automated verification results and the exact development start command. Do not claim desktop interaction has been manually verified; the user will validate long output, scroll position, input-at-bottom, resizing, and the singleton settings tab.
