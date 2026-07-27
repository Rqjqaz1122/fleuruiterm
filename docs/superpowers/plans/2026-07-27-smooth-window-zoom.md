# Smooth Window Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make double-click zoom resize the native window smoothly while keeping text and controls at their normal sizes and continuously reflowing the application layout.

**Architecture:** macOS keeps Tauri's native drag-region zoom behavior, pins WKWebView to its AppKit parent, and requests redraws throughout native view resizing instead of scaling cached application content. The native backing color matches the application canvas only as a compositor fallback. `TerminalAdapter` coalesces container resize notifications, fits xterm without changing font settings, and refreshes visible rows.

**Tech Stack:** Vue 3, TypeScript, Vitest, Tauri 2, Rust, objc2 AppKit.

---

### Task 1: Define shared cross-platform zoom behavior

**Files:**

- Modify: `src/components/TerminalTabs.spec.ts`
- Modify: `src/components/TerminalTabs.vue`
- Modify: `src-tauri/src/lib.rs`

- [x] **Step 1: Write failing tab-bar zoom tests**

Mock `@tauri-apps/api/core` and assert that Windows invokes `toggle_window_zoom`. Assert that macOS uses native Tauri drag-region attributes and does not invoke custom drag or zoom calls. Preserve the existing assertion that interactive controls do not trigger window zoom.

```ts
expect(coreApi.invoke).toHaveBeenCalledWith('toggle_window_zoom');
```

- [x] **Step 2: Run the focused component tests and verify RED**

```bash
pnpm --config.verify-deps-before-run=false vitest run src/components/TerminalTabs.spec.ts
```

Expected: macOS does not expose native drag-region attributes or still invokes custom drag and zoom calls.

- [x] **Step 3: Route zoom through one native command**

Import `invoke` in `TerminalTabs.vue`, handle Windows double-click, prevent its default action, and call:

```ts
await invoke('toggle_window_zoom');
```

Use the same function for the Windows maximize button. On macOS, mark the non-interactive tab-bar surfaces as native Tauri drag regions and do not run custom pointer handlers.

- [x] **Step 4: Add the Rust command**

Register `toggle_window_zoom` in the Tauri invoke handler for Windows. During macOS setup, replace WKWebView's autoresizing-mask layout with four AppKit edge constraints so the browser view follows the native content view throughout zoom animation.

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

Add `pendingResizeFitFrameId`. Make the resize observer callback call `scheduleResizeFit()`, return early when a frame is already pending, clear the identifier before fitting, refresh all terminal rows without changing font settings, and cancel the frame during disposal.

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

### Task 3: Reflow the macOS WebView throughout native zoom

**Files:**

- Modify: `src/components/TerminalTabs.spec.ts`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.macos.conf.json`

- [x] **Step 1: Restore the macOS native gesture regression expectation**

Keep the test aligned with the approved design: macOS drag surfaces expose `data-tauri-drag-region`, do not call the application `startDragging()` handler, and do not invoke the Windows zoom command.

```ts
expect(wrapper.get('.macos-window-control-space').attributes('data-tauri-drag-region')).toBe(
  'true',
);
expect(wrapper.get('.tabbar-drag-region').attributes('data-tauri-drag-region')).toBe('true');
expect(windowApi.startDragging).not.toHaveBeenCalled();
expect(coreApi.invoke).not.toHaveBeenCalled();
```

- [x] **Step 2: Write failing Rust policy and configuration tests**

Add a macOS-only test requiring AppKit's `DuringViewResize` redraw policy and disabled live-resize content preservation. Add a platform-independent test that reads `tauri.macos.conf.json` and requires the native backing color to match the `#000000` application canvas.

```rust
#[cfg(target_os = "macos")]
#[test]
fn macos_window_reflows_webview_content_during_native_resize() {
    assert_eq!(
        macos_webview_redraw_policy(),
        NSViewLayerContentsRedrawPolicy::DuringViewResize
    );
    assert!(!macos_preserves_content_during_live_resize());
}

#[test]
fn macos_window_background_matches_application_canvas() {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.macos.conf.json")).unwrap();
    assert_eq!(
        config["app"]["windows"][0]["backgroundColor"],
        serde_json::json!("#000000")
    );
}
```

- [x] **Step 3: Run tests and verify RED**

```bash
cargo test --manifest-path src-tauri/Cargo.toml macos_window_
```

Expected: compilation fails because the resize-policy helpers do not exist, and the background assertion fails until `backgroundColor` is configured.

- [x] **Step 4: Configure AppKit for live WebView redraw**

Return `NSViewLayerContentsRedrawPolicy::DuringViewResize` from a focused helper and return `false` from the live-resize preservation helper. Use those values in `configure_macos_webview_layout`: pin all four WebView edges, apply the redraw policy to both the WebView and its parent, and disable `NSWindow` content preservation during live resize.

```rust
#[cfg(target_os = "macos")]
fn macos_webview_redraw_policy() -> objc2_app_kit::NSViewLayerContentsRedrawPolicy {
    objc2_app_kit::NSViewLayerContentsRedrawPolicy::DuringViewResize
}

#[cfg(target_os = "macos")]
fn macos_preserves_content_during_live_resize() -> bool {
    false
}
```

Inside the WebView callback:

```rust
let redraw_policy = macos_webview_redraw_policy();
webview.setLayerContentsRedrawPolicy(redraw_policy);
parent_view.setLayerContentsRedrawPolicy(redraw_policy);
if let Some(native_window) = webview.window() {
    native_window.setPreservesContentDuringLiveResize(
        macos_preserves_content_during_live_resize(),
    );
}
```

- [x] **Step 5: Match the native backing color to the application canvas**

Add the following property to the macOS main-window configuration:

```json
"backgroundColor": "#000000"
```

This color is a fallback for native compositor gaps and does not replace live layout and redraw.

- [x] **Step 6: Run focused tests and verify GREEN**

```bash
cargo test --manifest-path src-tauri/Cargo.toml macos_window_
pnpm --config.verify-deps-before-run=false vitest run src/components/TerminalTabs.spec.ts src/terminal/terminalAdapter.spec.ts
```

Expected: the native policy/configuration tests and frontend resize behavior tests pass.

### Task 4: Verify and commit

**Files:**

- Verify: `src/components/TerminalTabs.vue`
- Verify: `src/components/TerminalTabs.spec.ts`
- Verify: `src/terminal/terminalAdapter.ts`
- Verify: `src/terminal/terminalAdapter.spec.ts`
- Verify: `src-tauri/src/lib.rs`
- Verify: `src-tauri/tauri.macos.conf.json`

- [x] **Step 1: Format all modified files**

```bash
pnpm --config.verify-deps-before-run=false exec prettier --write docs/superpowers/plans/2026-07-27-smooth-window-zoom.md src/components/TerminalTabs.vue src/components/TerminalTabs.spec.ts src/terminal/terminalAdapter.ts src/terminal/terminalAdapter.spec.ts src-tauri/tauri.macos.conf.json
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

- [x] **Step 3: Commit the implementation**

```bash
git add docs/superpowers/plans/2026-07-27-smooth-window-zoom.md src/components/TerminalTabs.vue src/components/TerminalTabs.spec.ts src/terminal/terminalAdapter.ts src/terminal/terminalAdapter.spec.ts src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/tauri.macos.conf.json
git commit -m "fix: smooth native window zoom"
```
