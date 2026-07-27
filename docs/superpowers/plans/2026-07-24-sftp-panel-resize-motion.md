# SFTP Panel Resize and Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the SFTP panel vertically resizable from its top edge and animate opening and closing without persisting its height.

**Architecture:** `SftpPanel` owns its transient height and pointer-resize lifecycle because that state exists only while the panel is mounted. `TerminalPane` owns visibility and wraps the panel in a Vue transition, keeping file-transfer behavior independent from presentation motion.

**Tech Stack:** Vue 3 Composition API, TypeScript, scoped CSS, Vue Test Utils, Vitest, jsdom.

---

### Task 1: Add the panel resize interaction

**Files:**

- Modify: `src/components/SftpPanel.spec.ts`
- Modify: `src/components/SftpPanel.vue`

- [ ] **Step 1: Write failing resize tests**

Add tests that mount the component inside a host with a mocked `600px` bounding height, start from a mocked `300px` panel height, and verify that moving the pointer upward changes `flex-basis` to `360px`. Add separate assertions that downward movement clamps at `220px`, upward movement clamps at `420px`, and movement after `pointerup` no longer changes the height.

```ts
await wrapper.get('[data-testid="sftp-resize-handle"]').trigger('pointerdown', {
  clientY: 400,
  pointerId: 1,
});
window.dispatchEvent(new MouseEvent('pointermove', { clientY: 340 }));
expect(wrapper.get('.sftp-panel').attributes('style')).toContain('flex-basis: 360px');
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --config.verify-deps-before-run=false vitest run src/components/SftpPanel.spec.ts
```

Expected: FAIL because `sftp-resize-handle` and resize styles do not exist.

- [ ] **Step 3: Implement transient bounded resizing**

Add named constants for the `220px` minimum and `0.7` parent-height ratio, a panel ref, transient `panelHeight`, and a focused resize state. On pointer down, read the current panel and terminal-pane bounds, clamp the maximum to at least the minimum, capture the pointer when supported, and register window `pointermove`, `pointerup`, and `pointercancel` listeners. Moving upward increases the height. Ending, cancelling, or unmounting clears listeners and the body resize class.

Render a dedicated separator before the header and bind the computed flex basis:

```vue
<section ref="panelElement" class="sftp-panel" :style="panelStyle">
  <div
    data-testid="sftp-resize-handle"
    class="sftp-resize-handle"
    role="separator"
    aria-orientation="horizontal"
    @pointerdown="startPanelResize"
  >
    <span aria-hidden="true" />
  </div>
</section>
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Task 1 focused command and expect all `SftpPanel` tests to pass.

- [ ] **Step 5: Format the modified component and test**

Run:

```bash
pnpm --config.verify-deps-before-run=false exec prettier --write src/components/SftpPanel.vue src/components/SftpPanel.spec.ts
```

### Task 2: Animate open and close

**Files:**

- Modify: `src/components/TerminalPane.spec.ts`
- Modify: `src/components/TerminalPane.vue`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Write a failing transition integration test**

Mount `TerminalPane` with `Transition` left unstubbed, open SFTP, and assert that the rendered panel is inside the named `sftp-panel` transition boundary. Close it and verify the panel is removed after Vue settles.

```ts
const wrapper = mountPane({ transition: false });
await wrapper.get('[data-testid="sftp-open"]').trigger('click');
expect(wrapper.find('sftp-panel-stub').exists()).toBe(true);
await wrapper.get('[data-testid="sftp-open"]').trigger('click');
expect(wrapper.find('sftp-panel-stub').exists()).toBe(false);
```

- [ ] **Step 2: Run the focused integration test and verify RED**

Run:

```bash
pnpm --config.verify-deps-before-run=false vitest run src/components/TerminalPane.spec.ts
```

Expected: FAIL because the SFTP panel is not wrapped by a named transition.

- [ ] **Step 3: Add the Vue transition and scoped motion styles**

Wrap the conditional `SftpPanel` in `<Transition name="sftp-panel">`. Add 180ms opacity, translate, and bounded max-height transitions, hide overflow during the transition, and disable all transition duration under `prefers-reduced-motion: reduce`.

```css
.sftp-panel-enter-active,
.sftp-panel-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease,
    max-height 180ms ease;
}

.sftp-panel-enter-from,
.sftp-panel-leave-to {
  max-height: 0 !important;
  opacity: 0;
  transform: translateY(8px);
}
```

- [ ] **Step 4: Run both focused suites and verify GREEN**

Run:

```bash
pnpm --config.verify-deps-before-run=false vitest run src/components/SftpPanel.spec.ts src/components/TerminalPane.spec.ts
```

Expected: both suites pass without warnings.

- [ ] **Step 5: Format the modified pane files**

Run:

```bash
pnpm --config.verify-deps-before-run=false exec prettier --write src/components/TerminalPane.vue src/components/TerminalPane.spec.ts
```

### Task 3: Verify the complete change

**Files:**

- Verify: `src/components/SftpPanel.vue`
- Verify: `src/components/SftpPanel.spec.ts`
- Verify: `src/components/TerminalPane.vue`
- Verify: `src/components/TerminalPane.spec.ts`
- Verify: `src/styles/global.css`

- [ ] **Step 1: Run all frontend tests**

```bash
pnpm --config.verify-deps-before-run=false test
```

Expected: all Vitest suites pass.

- [ ] **Step 2: Run lint and production build**

```bash
pnpm --config.verify-deps-before-run=false lint
pnpm --config.verify-deps-before-run=false build
```

Expected: ESLint reports zero warnings and the Vue production build exits successfully.

- [ ] **Step 3: Check the final diff**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only the planned SFTP resize/motion files plus this plan are modified.

- [ ] **Step 4: Commit the implementation**

```bash
git add docs/superpowers/plans/2026-07-24-sftp-panel-resize-motion.md src/components/SftpPanel.vue src/components/SftpPanel.spec.ts src/components/TerminalPane.vue src/components/TerminalPane.spec.ts src/styles/global.css
git commit -m "feat: add resizable animated SFTP panel"
```
