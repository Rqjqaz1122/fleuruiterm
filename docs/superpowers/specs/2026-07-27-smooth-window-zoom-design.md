# Smooth Window Zoom Design

## Goal

Make double-click window zoom animate the complete FleurTerm interface on macOS and Windows without exposing a white backing surface or allowing the terminal WebView content to resize ahead of the native window.

## Root Cause

The tab bar currently handles double-click maximize only on Windows. macOS relies on the drag-region default behavior, so FleurTerm cannot coordinate the native zoom operation with terminal redraws. Separately, every `ResizeObserver` notification immediately calls `xterm.fit()` and sends a PTY resize. Native maximize animations emit many resize notifications, which causes repeated synchronous terminal redraws and allows the WebView terminal surface to become visually out of step with the outer window.

## Window Zoom

FleurTerm will own double-click behavior on both platforms. Native drag-region attributes are removed from the custom tab bar drag surfaces because pointer dragging is already initiated explicitly through Tauri's `startDragging()` API. This prevents the operating system's implicit title-bar double-click behavior from racing the application handler.

The tab bar invokes a focused Rust command for maximize and restore:

- On macOS, the command runs on the main thread and calls `NSWindow.zoom(None)`. AppKit performs its native smooth whole-window zoom and retains the restore frame.
- On Windows and other desktop platforms, the command toggles Tauri's native maximize and unmaximize operations. The application does not simulate maximize with CSS transforms or manually calculated monitor dimensions.

The Windows maximize button uses the same command as tab-bar double-click, so both entry points have identical behavior.

## Terminal Resize Coordination

`TerminalAdapter` will no longer fit synchronously from the `ResizeObserver` callback. Resize observations schedule one fit on the next animation frame. Additional notifications received before that frame are coalesced. This keeps xterm layout aligned with browser painting and prevents repeated PTY resize IPC during a single native window animation frame.

Initial terminal fitting remains unchanged: one immediate fit followed by the existing two-frame post-render fit. Pending resize and initial-fit frames are cancelled when the adapter is disposed.

## Visual Behavior

The native application window, tab bar, terminal, optional SFTP drawer, AI panel, and status bar resize as one interface. No artificial full-screen overlay, screenshot layer, CSS scale animation, or background-color masking is introduced. The animation duration and easing remain controlled by macOS and Windows accessibility and window-animation settings.

## Testing

Frontend component tests verify that:

- Windows double-click invokes the shared native zoom command.
- macOS double-click also invokes the shared native zoom command.
- Interactive tab controls do not trigger window zoom.
- The Windows maximize button uses the same command.

Terminal adapter tests verify that repeated resize observations before the next animation frame produce exactly one terminal fit and that disposal cancels a pending resize fit.

Rust compilation and tests verify that the native command is registered and platform-specific code compiles. Final validation runs the complete frontend tests, ESLint, production build, Rust tests, and Rust formatting checks.
