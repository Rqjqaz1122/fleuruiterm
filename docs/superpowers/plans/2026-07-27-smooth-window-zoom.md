# Smooth Window Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make macOS and Windows double-click zoom resize the complete native window smoothly while coalescing terminal layout work to animation frames.

**Architecture:** `TerminalTabs` delegates macOS tab-bar drag and double-click gestures to Tauri's native drag-region script, which delays maximize until the second mouse up and avoids racing a drag operation. Windows keeps the explicit Rust zoom command. `TerminalAdapter` coalesces repeated container resize notifications before fitting xterm.

**Tech Stack:** Vue 3, TypeScript, Vitest, Tauri 2, Rust, objc2 AppKit.

---

### Task 1: Define shared cross-platform zoom behavior

**Files:**

- Modify: `src/components/TerminalTabs.spec.ts`
- Modify: `src/components/TerminalTabs.vue`
- Modify: `src-tauri/src/lib.rs`

- [x] **Step 1: Write failing tab-bar zoom tests**

Mock `@tauri-apps/api/core` and assert that Windows double-click invokes `toggle_window_zoom`. Assert that macOS drag surfaces carry `data-tauri-drag-region` and that macOS pointer down and double-click do not invoke FleurTerm's custom drag or zoom calls. Change the Windows maximize-button assertion to require the same command. Preserve the existing assertion that interactive controls do not trigger a tab-bar zoom.

```ts
expect(coreApi.invoke).toHaveBeenCalledWith('toggle_window_zoom');
```

- [x] **Step 2: Run the focused component tests and verify RED**

```bash
pnpm --config.verify-deps-before-run=false vitest run src/components/TerminalTabs.spec.ts
```

Expected: macOS does not expose native drag-region attributes and still invokes the custom drag or zoom path.

- [x] **Step 3: Route zoom through one native command**

Import `invoke` in `TerminalTabs.vue`, keep `onTabBarDoubleClick` Windows-only, prevent the handled Windows double-click default, and call:

```ts
await invoke('toggle_window_zoom');
```

Use the same function for the Windows maximize button. Mark the macOS traffic-light spacer and flexible tab-bar area with `data-tauri-drag-region`. Return before `startDragging()` on macOS so Tauri's native script owns the full click sequence.

- [x] **Step 4: Add the Rust command**

Register `toggle_window_zoom` in the Tauri invoke handler. Read `is_maximized()` and then call Tauri's `maximize()` or `unmaximize()`. The frontend uses this command for Windows double-click and the custom Windows maximize button; macOS tab-bar gestures stay on Tauri's internal native drag-region path.

```rust
#[tauri::command]
fn toggle_window_zoom(window: tauri::Window) -> Result<(), String> {
    if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize().map_err(|error| error.to_string())
    } else {
        window.maximize().map_err(|error| error.to_string())
    }
}
```

- [x] **Step 5: Run the focused component tests and Rust check**

```bash
pnpm --config.verify-deps-before-run=false vitest run src/components/TerminalTabs.spec.ts
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: component tests pass and the platform-specific Rust code compiles on macOS.

### Task 2: Coalesce terminal fitting during native resize animations

**Files:**

- Modify: `src/terminal/terminalAdapter.spec.ts`
- Modify: `src/terminal/terminalAdapter.ts`

- [x] **Step 1: Write failing resize-coalescing tests**

After completing the initial two-frame fit, trigger the fake resize observer three times before running another frame. Assert that no immediate fit occurs, only one animation frame remains pending, and running it performs exactly one fit. Add a disposal test that starts a pending resize fit and verifies its frame is cancelled.

```ts
observer.trigger();
observer.trigger();
observer.trigger();

expect(fitAddon.fit).not.toHaveBeenCalled();
expect(frames.pendingCount()).toBe(1);
frames.runNextFrame();
expect(fitAddon.fit).toHaveBeenCalledOnce();
```

- [x] **Step 2: Run the focused adapter tests and verify RED**

```bash
pnpm --config.verify-deps-before-run=false vitest run src/terminal/terminalAdapter.spec.ts
```

Expected: repeated observer callbacks fit synchronously three times and no resize frame is pending.

- [x] **Step 3: Schedule one resize fit per animation frame**

Add `pendingResizeFitFrameId`. Make the resize observer callback call `scheduleResizeFit()`, return early when a frame is already pending, clear the identifier before fitting, and cancel the frame during disposal.

```ts
private scheduleResizeFit(): void {
  if (this.disposed || this.pendingResizeFitFrameId !== null) {
    return;
  }
  this.pendingResizeFitFrameId = this.options.frameScheduler.requestFrame(() => {
    this.pendingResizeFitFrameId = null;
    this.fitAndNotify();
  });
}
```

- [x] **Step 4: Run the focused adapter tests and verify GREEN**

Run the Task 2 focused command and expect all adapter tests to pass.

### Task 3: Verify and commit

**Files:**

- Verify: `src/components/TerminalTabs.vue`
- Verify: `src/components/TerminalTabs.spec.ts`
- Verify: `src/terminal/terminalAdapter.ts`
- Verify: `src/terminal/terminalAdapter.spec.ts`
- Verify: `src-tauri/src/lib.rs`

- [x] **Step 1: Format all modified files**

```bash
pnpm --config.verify-deps-before-run=false exec prettier --write docs/superpowers/plans/2026-07-27-smooth-window-zoom.md src/components/TerminalTabs.vue src/components/TerminalTabs.spec.ts src/terminal/terminalAdapter.ts src/terminal/terminalAdapter.spec.ts
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

- [x] **Step 2: Run full frontend and Rust verification**

```bash
pnpm --config.verify-deps-before-run=false test
pnpm --config.verify-deps-before-run=false lint
pnpm --config.verify-deps-before-run=false build
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
git diff --check
```

Expected: frontend and Rust tests pass, lint has zero warnings, the production build succeeds, Rust formatting is clean, and Git reports no whitespace errors.

- [ ] **Step 3: Commit the implementation**

```bash
git add docs/superpowers/plans/2026-07-27-smooth-window-zoom.md src/components/TerminalTabs.vue src/components/TerminalTabs.spec.ts src/terminal/terminalAdapter.ts src/terminal/terminalAdapter.spec.ts src-tauri/src/lib.rs
git commit -m "fix: smooth native window zoom"
```
