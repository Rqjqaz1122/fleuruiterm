# FleurTerm Tabby-Style UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild FleurTerm's welcome page, window chrome, terminal workspace, and static settings page with the approved opaque Tabby Alpha-inspired visual system while preserving all existing local-terminal behavior.

**Architecture:** Keep terminal lifecycle and workspace state in the existing Pinia store, and add only local shell-view state to `App.vue`. Split the presentation into focused `StartPage`, `SettingsView`, and `AppTitleBar` components; keep nonfunctional connection and setting controls entirely in the front end with no fake data, persistence, or Tauri commands.

**Tech Stack:** Vue 3 Composition API, TypeScript 5.9, Pinia 3, Vitest, Vue Test Utils, CSS custom properties, xterm.js 5.5, Tauri 2.

---

## File map

- Create `src/components/StartPage.vue`: FleurTerm-branded welcome screen and four Tabby-style entries.
- Create `src/components/StartPage.spec.ts`: welcome-screen structure and emitted-action tests.
- Create `src/components/SettingsView.vue`: static settings layout, section navigation, and back action.
- Create `src/components/SettingsView.spec.ts`: settings navigation, static controls, and back-action tests.
- Create `src/components/AppTitleBar.vue`: overlay title bar with macOS control spacing, drag region, and settings action.
- Modify `src/App.vue`: own the `workspace/settings` view state and compose the new shell.
- Modify `src/App.spec.ts`: cover welcome, settings, return, terminal activation, and existing terminal behavior.
- Delete `src/components/AppHeader.vue`: the large legacy brand header is replaced by `AppTitleBar.vue`.
- Delete `src/components/EmptyWorkspace.vue`: the legacy empty card is replaced by `StartPage.vue`.
- Modify `src/components/TerminalTabs.vue`: apply compact Tabby-style markup hooks without changing tab semantics.
- Modify `src/components/TerminalTabs.spec.ts`: preserve keyboard navigation and verify compact tab actions.
- Modify `src/components/TerminalPane.vue`: align xterm theme colors with the approved opaque palette.
- Modify `src/components/StatusBar.vue`: expose stable status-bar structure for the compact shell.
- Modify `src/styles/tokens.css`: replace purple tokens with the approved charcoal and cyan token set.
- Modify `src/styles/global.css`: implement the title bar, tabs, start page, settings page, terminal panes, status bar, focus, narrow-window, and reduced-motion styles.
- Modify `src-tauri/tauri.conf.json`: enable the macOS overlay title bar while retaining opaque HTML surfaces.

## Preconditions

- [ ] **Step 1: Select the required Node runtime**

Run:

```bash
nvm use 22
```

Expected: the shell reports Node `v22.23.1` or another installed Node 22 release.

- [ ] **Step 2: Verify the existing baseline**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
```

Expected: all existing tests, TypeScript checks, and ESLint checks pass before UI changes.

### Task 1: Build the FleurTerm start page

**Files:**

- Create: `src/components/StartPage.vue`
- Create: `src/components/StartPage.spec.ts`

- [ ] **Step 1: Write the failing start-page tests**

Create `src/components/StartPage.spec.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import StartPage from './StartPage.vue';

describe('StartPage', () => {
  it('shows the approved FleurTerm start actions without development labels', () => {
    const wrapper = mount(StartPage, { props: { pending: false } });

    expect(wrapper.get('h1').text()).toBe('FleurTerm');
    expect(wrapper.text()).toContain('Profiles & connections');
    expect(wrapper.text()).toContain('New terminal');
    expect(wrapper.text()).toContain('Recent connections');
    expect(wrapper.text()).toContain('Settings');
    expect(wrapper.text()).not.toContain('Coming soon');
  });

  it('emits only the implemented start-page actions', async () => {
    const wrapper = mount(StartPage, { props: { pending: false } });

    await wrapper.get('[data-testid="start-new-terminal"]').trigger('click');
    await wrapper.get('[data-testid="start-settings"]').trigger('click');

    expect(wrapper.emitted('createTerminal')).toEqual([[]]);
    expect(wrapper.emitted('openSettings')).toEqual([[]]);
    expect(wrapper.get('[data-testid="profiles-entry"]').attributes('aria-disabled')).toBe('true');
    expect(wrapper.get('[data-testid="recent-entry"]').attributes('aria-disabled')).toBe('true');
  });

  it('disables terminal creation while a terminal action is pending', () => {
    const wrapper = mount(StartPage, { props: { pending: true } });

    expect(wrapper.get('[data-testid="start-new-terminal"]').attributes()).toHaveProperty(
      'disabled',
    );
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the missing-component failure**

Run:

```bash
pnpm test -- src/components/StartPage.spec.ts
```

Expected: FAIL because `StartPage.vue` does not exist.

- [ ] **Step 3: Implement the focused start-page component**

Create `src/components/StartPage.vue` with:

```vue
<script setup lang="ts">
defineProps<{ pending: boolean }>();

defineEmits<{
  createTerminal: [];
  openSettings: [];
}>();
</script>

<template>
  <section class="start-page" aria-labelledby="start-page-title">
    <div class="start-page-content">
      <div class="start-brand-mark" aria-hidden="true">›_</div>
      <h1 id="start-page-title">FleurTerm</h1>
      <p class="start-brand-caption">Terminal workspace by FleurUI</p>

      <div class="start-action-list" aria-label="Get started">
        <div
          class="start-action start-action-static"
          data-testid="profiles-entry"
          aria-disabled="true"
        >
          <span class="start-action-icon" aria-hidden="true">⌘</span>
          <span>
            <strong>Profiles &amp; connections</strong>
            <small>Configure shells and remote hosts</small>
          </span>
        </div>
        <button
          class="start-action"
          data-testid="start-new-terminal"
          type="button"
          :disabled="pending"
          @click="$emit('createTerminal')"
        >
          <span class="start-action-icon" aria-hidden="true">›_</span>
          <span>
            <strong>{{ pending ? 'Opening…' : 'New terminal' }}</strong>
            <small>Open the default local shell</small>
          </span>
        </button>
        <div
          class="start-action start-action-static"
          data-testid="recent-entry"
          aria-disabled="true"
        >
          <span class="start-action-icon" aria-hidden="true">◷</span>
          <span>
            <strong>Recent connections</strong>
            <small>Reopen a previous session</small>
          </span>
        </div>
        <button
          class="start-action"
          data-testid="start-settings"
          type="button"
          @click="$emit('openSettings')"
        >
          <span class="start-action-icon" aria-hidden="true">⚙</span>
          <span>
            <strong>Settings</strong>
            <small>Appearance, terminal and shortcuts</small>
          </span>
        </button>
      </div>
    </div>
  </section>
</template>
```

The two static rows use `aria-disabled="true"` and are not buttons, so they provide the requested visual preview without implying a working click target.

- [ ] **Step 4: Run and format the focused component**

Run:

```bash
pnpm test -- src/components/StartPage.spec.ts
pnpm exec prettier --write src/components/StartPage.vue src/components/StartPage.spec.ts
pnpm test -- src/components/StartPage.spec.ts
```

Expected: 3 tests pass after formatting.

- [ ] **Step 5: Commit the start page**

```bash
git add src/components/StartPage.vue src/components/StartPage.spec.ts
git commit -m "feat: add Tabby-style start page"
```

### Task 2: Build the static settings view

**Files:**

- Create: `src/components/SettingsView.vue`
- Create: `src/components/SettingsView.spec.ts`

- [ ] **Step 1: Write the failing settings-view tests**

Create `src/components/SettingsView.spec.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SettingsView from './SettingsView.vue';

describe('SettingsView', () => {
  it('shows all approved settings sections', () => {
    const wrapper = mount(SettingsView);

    for (const label of [
      'General',
      'Appearance',
      'Terminal',
      'Profiles & connections',
      'Hotkeys',
      'AI',
    ]) {
      expect(wrapper.get('[aria-label="Settings sections"]').text()).toContain(label);
    }
  });

  it('switches the presentation panel without persisting settings', async () => {
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-section="appearance"]').trigger('click');

    expect(wrapper.get('[data-testid="settings-panel"]').text()).toContain('Window opacity');
    expect(wrapper.get('[data-testid="opacity-value"]').text()).toBe('100%');
    expect(wrapper.get('input[type="range"]').attributes()).toHaveProperty('disabled');
  });

  it('emits close from the back action', async () => {
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-testid="close-settings"]').trigger('click');

    expect(wrapper.emitted('close')).toEqual([[]]);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the missing-component failure**

Run:

```bash
pnpm test -- src/components/SettingsView.spec.ts
```

Expected: FAIL because `SettingsView.vue` does not exist.

- [ ] **Step 3: Implement typed section navigation and static controls**

Create `src/components/SettingsView.vue`. Use a finite union instead of free-form section strings, keep the selected section local to the component, and render representative read-only controls for every approved category:

```vue
<script setup lang="ts">
import { ref } from 'vue';

type SettingsSectionId = 'general' | 'appearance' | 'terminal' | 'profiles' | 'hotkeys' | 'ai';

interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  symbol: string;
}

defineEmits<{ close: [] }>();

const settingsSections: readonly SettingsSection[] = [
  { id: 'general', label: 'General', symbol: '◆' },
  { id: 'appearance', label: 'Appearance', symbol: '◐' },
  { id: 'terminal', label: 'Terminal', symbol: '›_' },
  { id: 'profiles', label: 'Profiles & connections', symbol: '⌘' },
  { id: 'hotkeys', label: 'Hotkeys', symbol: '⌨' },
  { id: 'ai', label: 'AI', symbol: '✦' },
];

const selectedSectionId = ref<SettingsSectionId>('general');
</script>

<template>
  <section class="settings-view" aria-label="Settings">
    <aside class="settings-sidebar">
      <button
        class="settings-back"
        data-testid="close-settings"
        type="button"
        @click="$emit('close')"
      >
        <span aria-hidden="true">‹</span>
        Settings
      </button>
      <nav class="settings-navigation" aria-label="Settings sections">
        <button
          v-for="section in settingsSections"
          :key="section.id"
          class="settings-navigation-item"
          :class="{ active: selectedSectionId === section.id }"
          :data-section="section.id"
          type="button"
          :aria-current="selectedSectionId === section.id ? 'page' : undefined"
          @click="selectedSectionId = section.id"
        >
          <span class="settings-navigation-icon" aria-hidden="true">{{ section.symbol }}</span>
          {{ section.label }}
        </button>
      </nav>
    </aside>

    <div class="settings-content" data-testid="settings-panel">
      <template v-if="selectedSectionId === 'general'">
        <header class="settings-heading">
          <h1>General</h1>
          <p>Application startup and window behaviour.</p>
        </header>
        <div class="settings-group">
          <label class="setting-row">
            <span
              ><strong>Open a terminal on startup</strong
              ><small>Use the default profile.</small></span
            >
            <input type="checkbox" checked disabled />
          </label>
          <label class="setting-row">
            <span><strong>Close to tray</strong><small>Keep FleurTerm running.</small></span>
            <input type="checkbox" disabled />
          </label>
        </div>
      </template>

      <template v-else-if="selectedSectionId === 'appearance'">
        <header class="settings-heading">
          <h1>Appearance</h1>
          <p>Theme, type and window presentation.</p>
        </header>
        <div class="settings-group">
          <label class="setting-row">
            <span><strong>Theme</strong><small>Application colour scheme.</small></span>
            <select disabled>
              <option>FleurTerm Dark</option>
            </select>
          </label>
          <label class="setting-row">
            <span><strong>Interface font</strong><small>Used outside the terminal.</small></span>
            <select disabled>
              <option>System UI</option>
            </select>
          </label>
          <label class="setting-row setting-row-stack">
            <span><strong>Window opacity</strong><small>Opaque by default.</small></span>
            <span class="setting-range">
              <input type="range" min="40" max="100" value="100" disabled />
              <output data-testid="opacity-value">100%</output>
            </span>
          </label>
        </div>
      </template>

      <template v-else-if="selectedSectionId === 'terminal'">
        <header class="settings-heading">
          <h1>Terminal</h1>
          <p>Shell rendering and scrollback.</p>
        </header>
        <div class="settings-group">
          <label class="setting-row"
            ><span><strong>Font family</strong><small>Terminal monospace font.</small></span
            ><input value="JetBrains Mono" disabled
          /></label>
          <label class="setting-row"
            ><span><strong>Font size</strong><small>Measured in pixels.</small></span
            ><input type="number" value="13" disabled
          /></label>
          <label class="setting-row"
            ><span><strong>Cursor blink</strong><small>Animate the terminal cursor.</small></span
            ><input type="checkbox" checked disabled
          /></label>
        </div>
      </template>

      <template v-else-if="selectedSectionId === 'profiles'">
        <header class="settings-heading">
          <h1>Profiles &amp; connections</h1>
          <p>Shell profiles and remote hosts.</p>
        </header>
        <div class="settings-group">
          <div class="setting-row">
            <span><strong>Local shell</strong><small>Default system login shell.</small></span
            ><button type="button" disabled>Default</button>
          </div>
        </div>
      </template>

      <template v-else-if="selectedSectionId === 'hotkeys'">
        <header class="settings-heading">
          <h1>Hotkeys</h1>
          <p>Keyboard shortcuts for terminal actions.</p>
        </header>
        <div class="settings-group">
          <div class="setting-row">
            <span><strong>New terminal</strong><small>Create a local terminal tab.</small></span
            ><kbd>⌘ T</kbd>
          </div>
          <div class="setting-row">
            <span><strong>Close tab</strong><small>Close the active terminal tab.</small></span
            ><kbd>⌘ W</kbd>
          </div>
        </div>
      </template>

      <template v-else>
        <header class="settings-heading">
          <h1>AI</h1>
          <p>Assistant presentation and context controls.</p>
        </header>
        <div class="settings-group">
          <label class="setting-row"
            ><span
              ><strong>AI assistant</strong
              ><small>Show assistant controls in terminal sessions.</small></span
            ><input type="checkbox" disabled
          /></label>
        </div>
      </template>
    </div>
  </section>
</template>
```

- [ ] **Step 4: Run and format the focused component**

Run:

```bash
pnpm test -- src/components/SettingsView.spec.ts
pnpm exec prettier --write src/components/SettingsView.vue src/components/SettingsView.spec.ts
pnpm test -- src/components/SettingsView.spec.ts
```

Expected: 3 tests pass after formatting.

- [ ] **Step 5: Commit the settings view**

```bash
git add src/components/SettingsView.vue src/components/SettingsView.spec.ts
git commit -m "feat: add static settings presentation"
```

### Task 3: Replace the legacy header and connect shell navigation

**Files:**

- Create: `src/components/AppTitleBar.vue`
- Modify: `src/App.vue`
- Modify: `src/App.spec.ts`
- Delete: `src/components/AppHeader.vue`
- Delete: `src/components/EmptyWorkspace.vue`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Extend the app-shell tests before integration**

Update `src/App.spec.ts` to import and mount the new views through `App.vue`. Keep all current regression cases and add these cases:

```ts
it('opens and closes the settings view from the start page', async () => {
  const wrapper = mount(App);

  await wrapper.get('[data-testid="start-settings"]').trigger('click');
  expect(wrapper.get('[aria-label="Settings"]').exists()).toBe(true);

  await wrapper.get('[data-testid="close-settings"]').trigger('click');
  expect(wrapper.get('[aria-label="FleurTerm start page"]').exists()).toBe(true);
});

it('returns to the terminal workspace when a tab is activated from settings', async () => {
  const store = useWorkspaceStore();
  store.workspace = createWorkspace('session-a', ids('tab-1', 'pane-1'));
  const wrapper = mount(App, {
    global: { stubs: { TerminalPane: true } },
  });
  await wrapper.get('[data-testid="titlebar-settings"]').trigger('click');

  await wrapper.get('[role="tab"]').trigger('click');

  expect(wrapper.get('[aria-label="Terminal workspace"]').isVisible()).toBe(true);
  expect(store.workspace.activeTabId).toBe('tab-1');
});
```

In the existing `opens a local terminal from the empty workspace`, `shows a visible error without removing the workspace action`, and `offers to retry the terminal action after shell startup fails` cases, replace the legacy selector exactly as follows:

```ts
// Before
'[data-testid="new-terminal"]';

// After
'[data-testid="start-new-terminal"]';
```

Keep the existing unavailable-capabilities assertions because the welcome page still must not claim that AI is active.

- [ ] **Step 2: Run the app test and confirm integration failures**

Run:

```bash
pnpm test -- src/App.spec.ts
```

Expected: FAIL because `App.vue` does not expose the new start and settings navigation.

- [ ] **Step 3: Create the compact overlay title bar**

Create `src/components/AppTitleBar.vue`:

```vue
<script setup lang="ts">
defineProps<{ settingsActive: boolean }>();
defineEmits<{ openSettings: [] }>();
</script>

<template>
  <header class="app-title-bar" data-tauri-drag-region>
    <span class="title-bar-control-space" aria-hidden="true" data-tauri-drag-region />
    <span class="title-bar-name" data-tauri-drag-region>FleurTerm</span>
    <button
      class="icon-button title-bar-settings"
      :class="{ active: settingsActive }"
      data-testid="titlebar-settings"
      type="button"
      aria-label="Open settings"
      :aria-pressed="settingsActive"
      @click="$emit('openSettings')"
    >
      <span aria-hidden="true">⚙</span>
    </button>
  </header>
</template>
```

- [ ] **Step 4: Integrate explicit shell-view state in `App.vue`**

Replace `AppHeader` and `EmptyWorkspace` imports with `AppTitleBar`, `StartPage`, and `SettingsView`. Add a finite view state and named navigation methods:

```ts
type AppView = 'workspace' | 'settings';

const currentView = ref<AppView>('workspace');

async function openTerminal(): Promise<void> {
  await runAction(async () => {
    await store.openTab();
    currentView.value = 'workspace';
  });
}

function openSettings(): void {
  currentView.value = 'settings';
}

function closeSettings(): void {
  currentView.value = 'workspace';
}

function activateTerminalTab(tabId: string): void {
  store.activateTab(tabId);
  currentView.value = 'workspace';
}
```

Remove the old one-line `openTerminal` implementation because the replacement above returns to the workspace only after `store.openTab()` succeeds. Keep `runAction`, retry behavior, every mounted terminal panel, and store error publication unchanged.

Use this shell composition:

```vue
<main class="app-shell">
  <AppTitleBar
    :settings-active="currentView === 'settings'"
    @open-settings="openSettings"
  />
  <TerminalTabs
    v-if="workspace.tabs.length > 0"
    :tabs="workspace.tabs"
    :active-tab-id="workspace.activeTabId"
    @activate="activateTerminalTab"
    @close="closeTab"
    @new-terminal="openTerminal"
  />

  <div v-if="errorMessage" class="app-error" role="alert">
    <span>{{ errorMessage }}</span>
    <button
      v-if="retryAction"
      class="error-retry"
      data-testid="retry-action"
      type="button"
      :disabled="actionPending"
      @click="retryLastAction"
    >
      Retry
    </button>
  </div>

  <SettingsView v-if="currentView === 'settings'" @close="closeSettings" />
  <section
    v-show="currentView === 'workspace'"
    class="workspace"
    aria-label="Terminal workspace"
  >
    <div
      v-for="tab in workspace.tabs"
      :id="`terminal-panel-${tab.id}`"
      :key="tab.id"
      class="workspace-tab-panel"
      :class="{ active: tab.id === workspace.activeTabId }"
      role="tabpanel"
      :aria-hidden="tab.id !== workspace.activeTabId"
      :aria-labelledby="`terminal-tab-${tab.id}`"
      :inert="tab.id !== workspace.activeTabId"
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

  <StatusBar :snapshot="activeSnapshot" />
</main>
```

Using `v-show` keeps terminal components mounted while settings is displayed, so live terminal output continues to be consumed.

- [ ] **Step 5: Configure the macOS title-bar overlay**

Add the following fields to the existing main window object in `src-tauri/tauri.conf.json`:

```json
"titleBarStyle": "Overlay",
"hiddenTitle": true,
"trafficLightPosition": {
  "x": 14,
  "y": 16
}
```

Keep `decorations` at its default `true`. The title bar overlays opaque HTML; this does not enable transparent window content.

- [ ] **Step 6: Remove the superseded components**

Delete:

```text
src/components/AppHeader.vue
src/components/EmptyWorkspace.vue
```

Run `rg "AppHeader|EmptyWorkspace" src` and expect no matches.

- [ ] **Step 7: Run shell-navigation regression tests**

Run:

```bash
pnpm test -- src/App.spec.ts src/components/StartPage.spec.ts src/components/SettingsView.spec.ts
pnpm typecheck
```

Expected: all focused tests pass and `vue-tsc` reports no errors.

- [ ] **Step 8: Commit shell integration**

```bash
git add src/App.vue src/App.spec.ts src/components/AppTitleBar.vue src-tauri/tauri.conf.json
git add -u src/components/AppHeader.vue src/components/EmptyWorkspace.vue
git commit -m "feat: add compact application shell navigation"
```

### Task 4: Apply the approved opaque visual system

**Files:**

- Modify: `src/styles/tokens.css`
- Modify: `src/styles/global.css`
- Modify: `src/components/TerminalTabs.vue`
- Modify: `src/components/TerminalTabs.spec.ts`
- Modify: `src/components/StatusBar.vue`

- [ ] **Step 1: Add a compact-tab structural regression test**

Add to `src/components/TerminalTabs.spec.ts`:

```ts
it('keeps new and close actions accessible in the compact tab strip', () => {
  const wrapper = mount(TerminalTabs, { props: { tabs, activeTabId: 'tab-1' } });

  expect(wrapper.get('[aria-label="New terminal"]').classes()).toContain('add-tab');
  expect(wrapper.get('[aria-label="Close Local Terminal 1"]').classes()).toContain('tab-close');
  expect(wrapper.get('.tab-item.active').exists()).toBe(true);
});
```

- [ ] **Step 2: Run the focused tabs test**

Run:

```bash
pnpm test -- src/components/TerminalTabs.spec.ts
```

Expected: PASS with the current semantic markup. This test locks behavior before the visual rewrite.

- [ ] **Step 3: Replace `tokens.css` with the approved palette**

Use this complete token set:

```css
:root {
  --color-canvas: #202222;
  --color-surface: #292b2b;
  --color-surface-raised: #303232;
  --color-surface-hover: #363838;
  --color-terminal: #181a1a;
  --color-border: rgb(255 255 255 / 10%);
  --color-border-strong: rgb(143 216 232 / 48%);
  --color-text: #d7d7d3;
  --color-text-muted: #999b97;
  --color-accent: #8fd8e8;
  --color-accent-strong: #68bfd3;
  --color-success: #7ac6a3;
  --color-warning: #d7b56d;
  --color-danger: #dc7c86;
  --radius-small: 4px;
  --radius-medium: 6px;
  --shadow-popover: 0 12px 30px rgb(0 0 0 / 32%);
  --transition-fast: 120ms ease;
  --font-ui: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
}
```

- [ ] **Step 4: Replace `global.css` with the complete shell stylesheet**

Use the following complete file so conditional rows remain stable, every application surface is opaque, and the start/settings layouts share the same compact visual vocabulary:

```css
@import './tokens.css';
@import '@xterm/xterm/css/xterm.css';

:root {
  color: var(--color-text);
  background: var(--color-canvas);
  font-family: var(--font-ui);
  font-synthesis: none;
  text-rendering: optimizeLegibility;
}

* {
  box-sizing: border-box;
}

html,
body,
#app {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
}

body {
  min-width: 720px;
  min-height: 480px;
}

button,
input,
select {
  color: inherit;
  font: inherit;
}

button:focus-visible,
input:focus-visible,
select:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -1px;
}

.app-shell {
  display: grid;
  grid-template-rows: 36px auto auto minmax(0, 1fr) 28px;
  width: 100%;
  height: 100%;
  color: var(--color-text);
  background: var(--color-canvas);
}

.app-title-bar {
  display: grid;
  grid-row: 1;
  grid-template-columns: 92px 1fr 92px;
  align-items: center;
  min-width: 0;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  user-select: none;
}

.title-bar-control-space {
  height: 100%;
}

.title-bar-name {
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 600;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title-bar-settings {
  justify-self: end;
  margin-right: 8px;
}

.title-bar-settings.active {
  color: var(--color-accent);
  background: var(--color-surface-hover);
}

.terminal-tabs {
  display: flex;
  grid-row: 2;
  align-items: stretch;
  min-height: 38px;
  padding: 0 8px;
  overflow: hidden;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.tab-list {
  display: flex;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.tab-list::-webkit-scrollbar {
  display: none;
}

.tab-item {
  position: relative;
  display: flex;
  min-width: 150px;
  max-width: 220px;
  border-right: 1px solid var(--color-border);
}

.tab-item.active {
  background: var(--color-canvas);
}

.tab-item.active::before {
  position: absolute;
  inset: 0 0 auto;
  height: 2px;
  background: var(--color-accent);
  content: '';
}

.tab-button {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 0 4px 0 11px;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.tab-label {
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-close {
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.tab-item:hover .tab-close,
.tab-item.active .tab-close,
.tab-close:focus-visible {
  opacity: 1;
}

.icon-button {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  place-content: center;
  border: 0;
  border-radius: var(--radius-small);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast);
}

.icon-button:hover {
  color: var(--color-text);
  background: var(--color-surface-hover);
}

.add-tab {
  align-self: center;
  margin-left: 4px;
}

.status-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--color-success);
}

.status-dot.failed,
.status-dot.closed {
  background: var(--color-danger);
}

.app-error {
  display: flex;
  grid-row: 3;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0;
  padding: 7px 14px;
  border-bottom: 1px solid rgb(220 124 134 / 48%);
  color: #f3d4d7;
  background: #563237;
  font-size: 12px;
}

.error-retry {
  padding: 2px 9px;
  border: 1px solid rgb(255 255 255 / 18%);
  border-radius: var(--radius-small);
  background: #71434a;
  cursor: pointer;
}

.error-retry:disabled {
  cursor: wait;
  opacity: 0.65;
}

.workspace {
  position: relative;
  grid-row: 4;
  min-width: 0;
  min-height: 0;
  background: var(--color-canvas);
}

.workspace-tab-panel {
  position: absolute;
  inset: 0;
  visibility: hidden;
  pointer-events: none;
}

.workspace-tab-panel.active {
  visibility: visible;
  pointer-events: auto;
}

.workspace-tab-panel > * {
  height: 100%;
}

.start-page {
  display: grid;
  width: 100%;
  height: 100%;
  padding: 32px;
  place-items: center;
  overflow-y: auto;
  background: var(--color-canvas);
}

.start-page-content {
  display: flex;
  width: min(340px, 100%);
  flex-direction: column;
  align-items: center;
}

.start-brand-mark {
  display: grid;
  width: 56px;
  height: 56px;
  margin-bottom: 14px;
  place-content: center;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-medium);
  color: var(--color-accent);
  background: var(--color-surface);
  font: 600 20px var(--font-mono);
}

.start-page h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.start-brand-caption {
  margin: 6px 0 24px;
  color: var(--color-text-muted);
  font-size: 12px;
}

.start-action-list {
  display: grid;
  width: 100%;
  gap: 4px;
}

.start-action {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  min-height: 54px;
  padding: 7px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-medium);
  color: var(--color-text);
  background: var(--color-surface);
  text-align: left;
  text-decoration: none;
  transition:
    border-color var(--transition-fast),
    background-color var(--transition-fast);
}

button.start-action {
  cursor: pointer;
}

button.start-action:hover {
  border-color: var(--color-border);
  background: var(--color-surface-raised);
}

button.start-action:disabled {
  cursor: wait;
}

.start-action-static {
  cursor: default;
}

.start-action-icon {
  color: var(--color-accent);
  font: 600 14px var(--font-mono);
  text-align: center;
}

.start-action strong,
.start-action small,
.setting-row strong,
.setting-row small {
  display: block;
}

.start-action strong {
  font-size: 13px;
  font-weight: 500;
}

.start-action small {
  margin-top: 2px;
  color: var(--color-text-muted);
  font-size: 11px;
}

.settings-view {
  display: grid;
  grid-row: 4;
  grid-template-columns: 224px minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  background: var(--color-canvas);
}

.settings-sidebar {
  min-width: 0;
  padding: 12px 8px;
  border-right: 1px solid var(--color-border);
  background: var(--color-surface);
}

.settings-back,
.settings-navigation-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 9px;
  border: 0;
  border-radius: var(--radius-small);
  color: var(--color-text-muted);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.settings-back {
  min-height: 34px;
  padding: 0 10px;
  color: var(--color-text);
  font-size: 13px;
  font-weight: 600;
}

.settings-navigation {
  display: grid;
  gap: 2px;
  margin-top: 14px;
}

.settings-navigation-item {
  min-height: 34px;
  padding: 0 10px;
  font-size: 12px;
}

.settings-back:hover,
.settings-navigation-item:hover,
.settings-navigation-item.active {
  color: var(--color-text);
  background: var(--color-surface-hover);
}

.settings-navigation-item.active {
  box-shadow: inset 2px 0 var(--color-accent);
}

.settings-navigation-icon {
  width: 20px;
  color: var(--color-accent);
  font-family: var(--font-mono);
  text-align: center;
}

.settings-content {
  min-width: 0;
  min-height: 0;
  padding: 30px clamp(28px, 5vw, 72px) 48px;
  overflow-y: auto;
  background: var(--color-canvas);
}

.settings-heading,
.settings-group {
  width: min(760px, 100%);
  margin-right: auto;
  margin-left: auto;
}

.settings-heading h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}

.settings-heading p {
  margin: 7px 0 22px;
  color: var(--color-text-muted);
  font-size: 12px;
}

.settings-group {
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  background: var(--color-surface);
}

.setting-row {
  display: flex;
  min-height: 62px;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 12px 15px;
  border-bottom: 1px solid var(--color-border);
}

.setting-row:last-child {
  border-bottom: 0;
}

.setting-row-stack {
  align-items: flex-start;
  flex-direction: column;
  gap: 12px;
}

.setting-row strong {
  font-size: 13px;
  font-weight: 500;
}

.setting-row small {
  margin-top: 3px;
  color: var(--color-text-muted);
  font-size: 11px;
}

.setting-row input:not([type='checkbox']):not([type='range']),
.setting-row select,
.setting-row button,
.setting-row kbd {
  min-width: 132px;
  padding: 6px 9px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text);
  background: var(--color-terminal);
  font-size: 12px;
}

.setting-row input:disabled,
.setting-row select:disabled,
.setting-row button:disabled {
  cursor: default;
  opacity: 1;
}

.setting-row input[type='checkbox'] {
  width: 16px;
  height: 16px;
  accent-color: var(--color-accent);
}

.setting-range {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
}

.setting-range input {
  flex: 1;
  accent-color: var(--color-accent);
}

.setting-range output {
  width: 42px;
  color: var(--color-text-muted);
  font-size: 12px;
  text-align: right;
}

.split-node {
  display: flex;
  width: 100%;
  height: 100%;
  gap: 2px;
  background: var(--color-border);
}

.split-horizontal {
  flex-direction: column;
}

.split-vertical {
  flex-direction: row;
}

.split-node > * {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
}

.terminal-pane {
  display: grid;
  grid-template-rows: 30px auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid transparent;
  background: var(--color-terminal);
}

.terminal-pane.focused {
  border-color: var(--color-border-strong);
}

.pane-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 5px 0 10px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-muted);
  background: var(--color-surface);
  font-size: 11px;
}

.pane-actions,
.status-item {
  display: flex;
  align-items: center;
}

.terminal-surface {
  min-width: 0;
  min-height: 0;
  padding: 7px 6px;
  background: var(--color-terminal);
}

.terminal-surface .xterm {
  height: 100%;
}

.terminal-surface .xterm-viewport {
  background: var(--color-terminal) !important;
  scrollbar-color: rgb(255 255 255 / 25%) rgb(0 0 0 / 13%);
}

.terminal-surface .xterm-viewport::-webkit-scrollbar {
  width: 10px;
}

.terminal-surface .xterm-viewport::-webkit-scrollbar-track {
  background: rgb(0 0 0 / 13%);
}

.terminal-surface .xterm-viewport::-webkit-scrollbar-thumb {
  border: 2px solid var(--color-terminal);
  border-radius: 6px;
  background: rgb(255 255 255 / 25%);
}

.pane-error {
  margin: 0;
  padding: 6px 10px;
  color: #f3d4d7;
  background: #563237;
  font-size: 12px;
}

.status-bar {
  display: flex;
  grid-row: 5;
  align-items: center;
  gap: 16px;
  padding: 0 12px;
  border-top: 1px solid var(--color-border);
  color: var(--color-text-muted);
  background: var(--color-surface);
  font-size: 11px;
}

.status-item {
  gap: 7px;
  text-transform: capitalize;
}

.status-spacer {
  flex: 1;
}

@media (max-width: 820px) {
  .settings-view {
    grid-template-columns: 184px minmax(0, 1fr);
  }

  .settings-content {
    padding-right: 28px;
    padding-left: 28px;
  }

  .start-page {
    padding-right: 20px;
    padding-left: 20px;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
```

Do not add `opacity` to application surfaces, `backdrop-filter`, purple values, gradients, or shadows outside popovers.

- [ ] **Step 5: Keep tabs and status markup semantic while adding styling hooks**

In `TerminalTabs.vue`, preserve the current `role="tablist"`, roving tab stop, `aria-controls`, keyboard handler, and accessible button labels. Replace the two children inside `.tab-button` with:

```vue
<span class="status-dot" aria-hidden="true" />
<span class="tab-label">{{ tab.title }}</span>
```

In `StatusBar.vue`, retain the snapshot fallback and use this complete footer markup:

```vue
<footer class="status-bar" aria-label="Terminal status">
  <span class="status-item">
    <span class="status-dot" :class="snapshot?.state ?? 'closed'" aria-hidden="true" />
    {{ snapshot?.state ?? 'No session' }}
  </span>
  <span>{{ snapshot?.shell ?? 'Local shell' }}</span>
  <span class="status-spacer" />
</footer>
```

Do not introduce connection or AI state.

- [ ] **Step 6: Format and verify the visual-system edit**

Run:

```bash
pnpm exec prettier --write src/styles/tokens.css src/styles/global.css src/components/TerminalTabs.vue src/components/TerminalTabs.spec.ts src/components/StatusBar.vue
pnpm test -- src/components/TerminalTabs.spec.ts src/App.spec.ts
pnpm typecheck
pnpm lint
```

Expected: tests, type checking, and linting pass with no warnings.

- [ ] **Step 7: Commit the visual system**

```bash
git add src/styles/tokens.css src/styles/global.css src/components/TerminalTabs.vue src/components/TerminalTabs.spec.ts src/components/StatusBar.vue
git commit -m "style: apply opaque Tabby-inspired shell"
```

### Task 5: Align the terminal renderer with the shell palette

**Files:**

- Modify: `src/components/TerminalPane.vue`

- [ ] **Step 1: Preserve terminal behavior before theme changes**

Run:

```bash
pnpm test -- src/terminal/terminalAdapter.spec.ts src/stores/workspaceStore.spec.ts
```

Expected: existing adapter and workspace-store tests pass.

- [ ] **Step 2: Replace the xterm theme values**

In `TerminalPane.vue`, keep the dynamic imports, adapter lifecycle, resize observer, output subscription, and toolbar events unchanged. Replace only the terminal font and theme block:

```ts
fontFamily: 'JetBrains Mono, SFMono-Regular, Consolas, monospace',
fontSize: 13,
scrollback: 10_000,
theme: {
  background: '#181a1a',
  foreground: '#d7d7d3',
  cursor: '#8fd8e8',
  cursorAccent: '#181a1a',
  selectionBackground: '#8fd8e840',
  black: '#202222',
  brightBlack: '#666a67',
  white: '#d7d7d3',
  brightWhite: '#f1f2ee',
},
```

This duplicates the CSS palette deliberately because xterm receives runtime string values and cannot consume CSS custom properties directly in its theme object.

- [ ] **Step 3: Run terminal regression and static checks**

Run:

```bash
pnpm test -- src/terminal/terminalAdapter.spec.ts src/stores/workspaceStore.spec.ts src/App.spec.ts
pnpm typecheck
pnpm lint
```

Expected: all selected tests and static checks pass.

- [ ] **Step 4: Commit the renderer theme**

```bash
git add src/components/TerminalPane.vue
git commit -m "style: align terminal renderer theme"
```

### Task 6: Full verification and desktop visual acceptance

**Files:**

- Modify only if verification finds a requirement mismatch; keep any correction scoped to the responsible file above.

- [ ] **Step 1: Run the complete frontend quality gate**

Run:

```bash
pnpm format:check
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: Prettier reports all files formatted; all Vitest tests pass; typecheck, ESLint, and Vite production build complete successfully.

- [ ] **Step 2: Validate the Tauri configuration and debug build**

Run:

```bash
pnpm tauri build --debug --no-bundle
```

Expected: Tauri validates `titleBarStyle`, `hiddenTitle`, and `trafficLightPosition`, then produces the debug FleurTerm executable without errors.

- [ ] **Step 3: Perform the welcome-page desktop visual check**

Run the Tauri development app and verify:

- the window background, title bar, tabs, welcome page, and status bar are visibly opaque;
- macOS traffic lights align inside the 36px title region without overlapping FleurTerm content;
- the welcome panel is approximately 340px wide and centered;
- the four requested welcome entries are present with no development-status label;
- purple gradients, glow, and large card radii are absent.

- [ ] **Step 4: Perform the settings-page desktop visual check**

Open Settings and verify:

- six categories appear in the left navigation;
- section switching updates the right panel;
- Appearance shows 100% window opacity;
- controls look complete but cannot alter or persist configuration;
- closing Settings returns to the previous workspace surface.

- [ ] **Step 5: Perform terminal and split-pane regression checks**

Create two tabs, create horizontal and vertical splits, and verify:

- all terminal input and output still works;
- inactive terminal tabs remain mounted;
- the active tab uses the cyan indicator;
- pane gaps are 1–3px and the focused pane uses a restrained indicator;
- closing a pane and closing a tab still update the status bar correctly.

- [ ] **Step 6: Inspect the final diff and commit verification corrections**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only intentional files are modified. If desktop verification required corrections, stage only those files and commit them with:

```bash
git commit -m "fix: refine Tabby-style desktop layout"
```

If no corrections were required, do not create an empty commit.

- [ ] **Step 7: Request independent code review**

Use the `requesting-code-review` skill to review the final diff against `docs/superpowers/specs/2026-07-17-tabby-style-ui-design.md`. Resolve any correctness, accessibility, regression, or scope findings, then rerun the complete frontend quality gate and Tauri debug build before reporting completion.
