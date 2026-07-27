# SFTP Terminal Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the resizable SFTP panel with a fixed-height bottom drawer that overlays 75% of the current terminal pane without resizing the terminal.

**Architecture:** `TerminalPane` remains the positioning container and renders `SftpPanel` as an absolutely positioned child. `SftpPanel` removes all pointer-resize state and exposes only SFTP file-browser behavior, while the existing Vue transition becomes a translate-and-opacity drawer transition.

**Tech Stack:** Vue 3 Composition API, TypeScript, scoped CSS, Vue Test Utils, Vitest, jsdom.

---

### Task 1: Specify the overlay drawer behavior in tests

**Files:**

- Modify: `src/components/SftpPanel.spec.ts`
- Modify: `src/components/TerminalPane.spec.ts`

- [ ] **Step 1: Replace resize tests with drawer structure assertions**

Remove the three pointer-resize tests and their rectangle helpers. Add an assertion that the mounted SFTP surface does not contain `[data-testid="sftp-resize-handle"]`.

```ts
it('renders without a resize handle', async () => {
  const wrapper = mount(SftpPanel, {
    props: { terminalSessionId: 'terminal-1', client: createClient() },
  });
  await flushPromises();

  expect(wrapper.find('[data-testid="sftp-resize-handle"]').exists()).toBe(false);
});
```

- [ ] **Step 2: Add a terminal integration assertion for the drawer wrapper**

After opening SFTP, assert that the panel is rendered inside `.sftp-drawer-layer`, which will be the absolute overlay container.

```ts
await wrapper.get('[data-testid="sftp-open"]').trigger('click');
expect(wrapper.get('.sftp-drawer-layer').find('sftp-panel-stub').exists()).toBe(true);
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
pnpm --config.verify-deps-before-run=false vitest run src/components/SftpPanel.spec.ts src/components/TerminalPane.spec.ts
```

Expected: the new no-resize-handle test fails while the old handle exists, and the integration test fails because `.sftp-drawer-layer` does not exist.

### Task 2: Remove resizing and create the 75% overlay drawer

**Files:**

- Modify: `src/components/SftpPanel.vue`
- Modify: `src/components/TerminalPane.vue`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Remove panel resize state and markup**

Delete `PanelResizeState`, resize constants, `panelElement`, `panelHeight`, `panelStyle`, `startPanelResize`, `resizePanel`, `stopPanelResize`, `clamp`, the resize handle markup, body resize classes, and all resize-handle CSS. Keep connection cleanup and file-transfer behavior unchanged.

- [ ] **Step 2: Add an absolute drawer layer**

Wrap the transition in a layer placed after the terminal surface:

```vue
<div class="sftp-drawer-layer">
  <Transition name="sftp-drawer">
    <SftpPanel
      v-if="sftpPanelOpen && sftpProfile"
      :terminal-session-id="sessionId"
      @close="sftpPanelOpen = false"
    />
  </Transition>
</div>
```

The layer uses `position: absolute`, spans horizontally, anchors to the bottom, has `height: 75%`, and disables pointer events when empty. The rendered panel restores pointer events and fills the layer height.

- [ ] **Step 3: Replace layout animation with drawer animation**

Remove flex-basis and max-height transition rules. Use a 180ms opacity and vertical translate transition:

```css
.sftp-drawer-enter-active,
.sftp-drawer-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

.sftp-drawer-enter-from,
.sftp-drawer-leave-to {
  opacity: 0;
  transform: translateY(24px);
}
```

Keep the existing `prefers-reduced-motion: reduce` override for the renamed transition.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Task 1 command and expect all SFTP component and terminal integration tests to pass.

### Task 3: Verify and commit

**Files:**

- Verify: `src/components/SftpPanel.vue`
- Verify: `src/components/SftpPanel.spec.ts`
- Verify: `src/components/TerminalPane.vue`
- Verify: `src/components/TerminalPane.spec.ts`
- Verify: `src/styles/global.css`

- [ ] **Step 1: Format modified files**

```bash
pnpm --config.verify-deps-before-run=false exec prettier --write docs/superpowers/plans/2026-07-27-sftp-terminal-drawer.md src/components/SftpPanel.vue src/components/SftpPanel.spec.ts src/components/TerminalPane.vue src/components/TerminalPane.spec.ts src/styles/global.css
```

- [ ] **Step 2: Run full verification**

```bash
pnpm --config.verify-deps-before-run=false test
pnpm --config.verify-deps-before-run=false lint
pnpm --config.verify-deps-before-run=false build
git diff --check
```

Expected: all tests pass, ESLint reports zero warnings, the production build succeeds, and Git reports no whitespace errors.

- [ ] **Step 3: Commit the implementation**

```bash
git add docs/superpowers/plans/2026-07-27-sftp-terminal-drawer.md src/components/SftpPanel.vue src/components/SftpPanel.spec.ts src/components/TerminalPane.vue src/components/TerminalPane.spec.ts src/styles/global.css
git commit -m "refactor: show SFTP as terminal drawer"
```
