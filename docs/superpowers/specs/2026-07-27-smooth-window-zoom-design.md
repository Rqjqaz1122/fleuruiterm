# Smooth Window Zoom Design

## Goal

Make double-click window zoom resize FleurTerm smoothly on macOS and Windows without exposing a white backing surface. Content must keep its normal font, icon, and control sizes while the layout continuously adapts to the changing window bounds.

## Root Cause

Wry gives its root WKWebView flexible width and height, but macOS can advance the native `NSWindow.zoom` animation before WebKit has produced content for the new bounds. The uncovered native backing surface is white, so it becomes visible while the browser viewport and composited WebView content catch up. Pinning the WebView frame alone does not guarantee that WebKit redraws during every animated resize step.

The required behavior is live reflow, not visual scaling. The browser viewport must receive the changing native bounds throughout the animation so Vue grid and flex layouts can recalculate normally. Separately, xterm resize work must remain coordinated with browser animation frames so terminal layout does not block or outrun WebView painting.

## Window Zoom

macOS delegates tab-bar dragging and double-click zoom to Tauri's native drag-region behavior. Windows keeps FleurTerm's explicit drag and maximize handlers.

At application setup, FleurTerm disables WKWebView's translated autoresizing mask and activates leading, trailing, top, and bottom constraints against Wry's parent view. It configures the WebView hierarchy to redraw during view resize and disables native live-resize content preservation for the application window. AppKit then updates the WebView bounds during each native zoom step instead of leaving WebKit at the old frame until the animation completes.

The native window backing color matches FleurTerm's canvas color. This is only a final fallback for a compositor gap; it is not the mechanism used to hide a delayed layout. The primary behavior remains continuous WebView resize and redraw.

The Windows maximize button uses the same command as double-click. The application does not scale a screenshot, apply CSS transforms, change browser zoom, invoke `NSWindow.zoom` directly, or manually calculate monitor dimensions.

## Terminal Resize Coordination

`TerminalAdapter` does not fit synchronously from the `ResizeObserver` callback. Resize observations schedule one fit on the next animation frame, and additional notifications received before that frame are coalesced. After `fit()`, xterm refreshes the visible rows so its renderer matches the new container dimensions. Font size, line height, browser zoom, and CSS transforms are never modified by window resizing.

Initial terminal fitting remains unchanged: one immediate fit followed by the existing two-frame post-render fit. Pending resize and initial-fit frames are cancelled when the adapter is disposed.

## Visual Behavior

During the native animation, the tab bar, terminal, optional SFTP drawer, AI panel, and status bar reflow against the current window bounds. Their visual sizes remain unchanged. A larger window shows more usable space and potentially more terminal columns and rows; it does not enlarge glyphs, icons, panels, or controls.

No screenshot layer, font scaling, browser zoom, or CSS scale animation is introduced. At the end of the animation, the interface is already laid out for the final window size rather than jumping from the previous layout.

## Testing

Frontend component tests verify that:

- Windows double-click invokes the shared native zoom command.
- macOS drag surfaces use Tauri's native drag-region behavior and do not invoke custom drag or zoom handlers.
- Interactive tab controls do not trigger window zoom.
- The Windows maximize button uses the same command.

Terminal adapter tests verify that repeated resize observations before the next animation frame produce exactly one terminal fit, visible rows are refreshed, the configured font size is unchanged, and disposal cancels a pending resize fit.

Rust compilation verifies the macOS Auto Layout and redraw configuration, while Rust tests verify the Windows maximize/restore decision. Configuration checks verify that the native window backing color matches the application canvas.

Manual macOS validation verifies both zoom directions and confirms that:

- no white native surface appears during the animation;
- text, icons, and controls retain their normal sizes;
- the layout changes throughout the animation instead of jumping only at the end;
- terminal columns and rows settle correctly after the final frame.

Final automated validation runs the complete frontend tests, ESLint, production build, Rust tests, Rust formatting checks, and `git diff --check`.
