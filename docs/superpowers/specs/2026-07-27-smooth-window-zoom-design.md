# Smooth Window Zoom Design

## Goal

Make double-click window zoom animate the complete FleurTerm interface on macOS and Windows without exposing a white backing surface or allowing the terminal WebView content to resize ahead of the native window.

## Root Cause

The custom tab bar starts native window dragging on every pointer down. When a macOS double-click is handled separately, the second pointer down enters the native drag loop immediately before maximize begins. The overlapping drag and zoom operations let the native frame animation advance ahead of WKWebView painting and expose a white edge during the animation. Tauri's built-in macOS drag-region handler deliberately skips dragging on the second mouse down and waits until the second mouse up before maximizing, which avoids this race. Separately, every `ResizeObserver` notification immediately calls `xterm.fit()` and sends a PTY resize. Native maximize animations emit many resize notifications, which causes repeated synchronous terminal redraws and allows the WebView terminal surface to become visually out of step with the outer window.

## Window Zoom

FleurTerm uses platform-specific gesture ownership. macOS delegates tab-bar dragging and double-click maximize to Tauri's native drag-region handler, while Windows keeps FleurTerm's explicit drag and zoom handlers. Only one handler owns a gesture on each platform, so a native drag loop cannot race a separate maximize request.

On macOS, the non-interactive tab-bar surfaces use `data-tauri-drag-region`. FleurTerm does not call `startDragging()` or its custom zoom command for macOS tab-bar gestures. Tauri handles the full gesture using its macOS-specific mouse-up timing and invokes the native maximize operation only after confirming that the second click did not become a drag.

On Windows, FleurTerm continues to start dragging explicitly and invokes a focused Rust command for double-click maximize and restore. The Windows maximize button uses the same command, so both entry points have identical behavior. The application does not invoke `NSWindow.zoom` directly, simulate maximize with CSS transforms, or manually calculate monitor dimensions.

## Terminal Resize Coordination

`TerminalAdapter` will no longer fit synchronously from the `ResizeObserver` callback. Resize observations schedule one fit on the next animation frame. Additional notifications received before that frame are coalesced. This keeps xterm layout aligned with browser painting and prevents repeated PTY resize IPC during a single native window animation frame.

Initial terminal fitting remains unchanged: one immediate fit followed by the existing two-frame post-render fit. Pending resize and initial-fit frames are cancelled when the adapter is disposed.

## Visual Behavior

The native application window, tab bar, terminal, optional SFTP drawer, AI panel, and status bar resize as one interface. No artificial full-screen overlay, screenshot layer, CSS scale animation, or background-color masking is introduced. The animation duration and easing remain controlled by macOS and Windows accessibility and window-animation settings.

## Testing

Frontend component tests verify that:

- Windows double-click invokes the shared native zoom command.
- macOS drag surfaces are marked as native Tauri drag regions and do not invoke FleurTerm's custom drag or zoom commands.
- Interactive tab controls do not trigger window zoom.
- The Windows maximize button uses the same command.

Terminal adapter tests verify that repeated resize observations before the next animation frame produce exactly one terminal fit and that disposal cancels a pending resize fit.

Rust tests verify the maximize/restore decision derived from Tauri's current window state, and compilation verifies that the Windows zoom command is registered. Final validation runs the complete frontend tests, ESLint, production build, Rust tests, and Rust formatting checks. Manual macOS validation verifies that the native drag-region gesture performs zoom and restore without exposing a white edge during the animation.
