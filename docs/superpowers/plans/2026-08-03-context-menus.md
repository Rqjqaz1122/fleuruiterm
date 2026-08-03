# Global Context Menus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an accessible, localized global context menu whose actions change for terminal, tabs, AI, SFTP, start, settings, and editable controls.

**Architecture:** A singleton reactive service owns one menu request at a time, while `AppContextMenu.vue` only renders and controls focus/positioning. Feature components translate their current business target into menu entries and continue to call their existing domain actions.

**Tech Stack:** Vue 3 Composition API, TypeScript 5.9, Pinia, Vitest, Vue Test Utils, xterm.js.

---

### Task 1: Context menu model, service, and renderer

**Files:**
- Create: `src/services/contextMenu.ts`
- Create: `src/services/contextMenu.spec.ts`
- Create: `src/components/AppContextMenu.vue`
- Create: `src/components/AppContextMenu.spec.ts`
- Modify: `src/App.vue`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Write service tests for single-instance open and close state**

```ts
contextMenu.open({ x: 20, y: 30, entries: [{ kind: 'action', id: 'copy', label: 'Copy', run }] });
expect(contextMenu.state.value?.x).toBe(20);
contextMenu.close();
expect(contextMenu.state.value).toBeNull();
```

- [ ] **Step 2: Run the focused service test and verify it fails**

Run: `pnpm test -- src/services/contextMenu.spec.ts`
Expected: FAIL because `contextMenu.ts` does not exist.

- [ ] **Step 3: Implement the discriminated entry model and reactive service**

```ts
export type ContextMenuEntry =
  | { kind: 'action'; id: string; label: string; disabled?: boolean; danger?: boolean; run: () => void | Promise<void> }
  | { kind: 'separator'; id: string };

const state = shallowRef<ContextMenuRequest | null>(null);
export const contextMenu = {
  state: readonly(state),
  open(request: ContextMenuRequest) { state.value = request; },
  close() { state.value = null; },
};
```

- [ ] **Step 4: Write renderer tests for edge clamping, disabled actions, keyboard navigation, and close events**

```ts
await wrapper.trigger('keydown', { key: 'ArrowDown' });
expect(document.activeElement).toBe(wrapper.find('[data-context-action="enabled"]').element);
await wrapper.find('[data-context-action="disabled"]').trigger('click');
expect(disabledAction).not.toHaveBeenCalled();
```

- [ ] **Step 5: Implement the global renderer and mount it once in `App.vue`**

```vue
<Teleport to="body">
  <div v-if="request" ref="menuElement" class="app-context-menu" role="menu">
    <template v-for="entry in request.entries" :key="entry.id">
      <div v-if="entry.kind === 'separator'" role="separator" />
      <button v-else role="menuitem" :disabled="entry.disabled" @click="runEntry(entry)">{{ entry.label }}</button>
    </template>
  </div>
</Teleport>
```

- [ ] **Step 6: Run the focused tests and commit**

Run: `pnpm test -- src/services/contextMenu.spec.ts src/components/AppContextMenu.spec.ts`
Expected: PASS.

Commit subject: `feat: add shared context menu foundation`

### Task 2: Editable controls and terminal actions

**Files:**
- Create: `src/services/editableContextMenu.ts`
- Create: `src/services/editableContextMenu.spec.ts`
- Modify: `src/terminal/terminalAdapter.ts`
- Modify: `src/terminal/terminalAdapter.spec.ts`
- Modify: `src/components/TerminalPane.vue`
- Modify: `src/components/TerminalPane.spec.ts`

- [ ] **Step 1: Test editable target detection and selection-preserving cut, copy, paste, and select-all actions**

```ts
const input = document.createElement('input');
input.value = 'FleurTerm';
input.setSelectionRange(0, 5);
const entries = createEditableContextMenuEntries(input, labels, clipboard);
await runAction(entries, 'copy');
expect(clipboard.writeText).toHaveBeenCalledWith('Fleur');
```

- [ ] **Step 2: Implement editable menu entries using captured selection ranges and `setRangeText`**

```ts
const selectionStart = target.selectionStart ?? 0;
const selectionEnd = target.selectionEnd ?? selectionStart;
target.setRangeText(await clipboard.readText(), selectionStart, selectionEnd, 'end');
target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
```

- [ ] **Step 3: Test and expose terminal selection, paste, select-all, and focus operations through `TerminalAdapter`**

```ts
expect(adapter.getSelection()).toBe('selected output');
adapter.paste('pwd');
adapter.selectAll();
expect(terminal.focus).toHaveBeenCalled();
```

- [ ] **Step 4: Add the terminal context menu**

```ts
contextMenu.openAt(event, [
  action('copy', t('contextMenu.copy'), copySelection, adapter?.getSelection().length === 0),
  action('paste', t('contextMenu.paste'), pasteClipboard),
  action('selectAll', t('contextMenu.selectAll'), () => adapter?.selectAll()),
  separator('terminal-separator'),
  action('clearTerminal', t('contextMenu.clearTerminal'), () => store.writeToSession(props.sessionId, '\x0c')),
]);
```

- [ ] **Step 5: Run focused tests and commit**

Run: `pnpm test -- src/services/editableContextMenu.spec.ts src/terminal/terminalAdapter.spec.ts src/components/TerminalPane.spec.ts`
Expected: PASS.

Commit subject: `feat: add terminal and editing context actions`

### Task 3: Tabs, start page, and settings integration

**Files:**
- Modify: `src/components/TerminalTabs.vue`
- Modify: `src/components/TerminalTabs.spec.ts`
- Modify: `src/components/StartPage.vue`
- Modify: `src/components/StartPage.spec.ts`
- Modify: `src/components/SettingsView.vue`
- Modify: `src/components/SettingsView.spec.ts`
- Modify: `src/App.vue`
- Modify: `src/App.spec.ts`

- [ ] **Step 1: Add failing component tests for page-specific menu requests**

```ts
await wrapper.get('[data-tab-id="tab-1"]').trigger('contextmenu');
expect(contextMenu.state.value?.entries).toEqual(expect.arrayContaining([
  expect.objectContaining({ id: 'new-terminal' }),
  expect.objectContaining({ id: 'close-tab' }),
]));
```

- [ ] **Step 2: Add tab menu events and close-others orchestration in `App.vue`**

```ts
async function closeOtherAppTabs(tabId: string): Promise<void> {
  const otherTabIds = workspace.value.tabs.map((tab) => tab.id).filter((id) => id !== tabId);
  for (const otherTabId of otherTabIds) await closeAppTab(otherTabId);
}
```

- [ ] **Step 3: Add homepage and settings background menus while allowing editable controls to override them**

```ts
if (openEditableContextMenu(event)) return;
contextMenu.openAt(event, [action('new-terminal', t('contextMenu.newTerminal'), () => emit('createTerminal'))]);
```

- [ ] **Step 4: Run focused tests and commit**

Run: `pnpm test -- src/components/TerminalTabs.spec.ts src/components/StartPage.spec.ts src/components/SettingsView.spec.ts src/App.spec.ts`
Expected: PASS.

Commit subject: `feat: add workspace context actions`

### Task 4: AI and SFTP integration

**Files:**
- Modify: `src/components/AIPanel.vue`
- Modify: `src/components/AIPanel.spec.ts`
- Modify: `src/components/SftpPanel.vue`
- Modify: `src/components/SftpPanel.spec.ts`

- [ ] **Step 1: Test AI message, AI background, and composer menus**

```ts
await wrapper.get('[data-message-id="message-1"]').trigger('contextmenu');
expect(menuActionIds()).toEqual(['copy-selection', 'copy-message', 'clear-conversation']);
```

- [ ] **Step 2: Implement AI actions with the existing conversation store**

```ts
action('copy-message', labels.value.copyMessage, () => clipboard.writeText(message.content));
action('clear-conversation', labels.value.clearConversation, conversation.clearConversation, !conversation.hasConversationHistory.value);
```

- [ ] **Step 3: Test SFTP file, directory, and background menus including disabled busy state**

```ts
await wrapper.get('[data-testid="sftp-entry-report.log"]').trigger('contextmenu');
expect(menuActionIds()).toEqual(['download', 'copy-path', 'delete']);
```

- [ ] **Step 4: Implement SFTP actions through existing download, delete confirmation, navigation, upload, and refresh methods**

```ts
const entries = entry.kind === 'file'
  ? [downloadAction(entry), copyPathAction(entry), deleteAction(entry)]
  : [openAction(entry), copyPathAction(entry), deleteAction(entry)];
contextMenu.openAt(event, entries);
```

- [ ] **Step 5: Run focused tests and commit**

Run: `pnpm test -- src/components/AIPanel.spec.ts src/components/SftpPanel.spec.ts`
Expected: PASS.

Commit subject: `feat: add AI and SFTP context actions`

### Task 5: Localization and final static verification

**Files:**
- Modify: `src/i18n/locale.ts`
- Modify: `src/i18n/locale.spec.ts`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Add matching English and Chinese keys for every menu action**

```ts
'contextMenu.copy': 'Copy',
'contextMenu.copyPath': 'Copy path',
'contextMenu.clearConversation': 'Clear conversation',
```

- [ ] **Step 2: Complete terminal-style menu states for light and dark themes**

```css
.app-context-menu {
  position: fixed;
  min-width: 190px;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
}
```

- [ ] **Step 3: Run static checks without launching the application**

Run: `pnpm typecheck && pnpm lint && pnpm format:check`
Expected: all commands exit with status 0.

- [ ] **Step 4: Commit the completed localization and styling**

Commit subject: `feat: complete localized context menus`
