# FleurTerm Local Terminal Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable FleurTerm desktop application with local PTY sessions, xterm.js rendering, tabs, horizontal and vertical splits, bounded output flow, and complete quality gates.

**Architecture:** Vue owns presentation and an immutable tab/split workspace model. Rust owns session state, PTY processes, validation, and output flow; a narrow Tauri command/channel adapter connects the two sides. Domain behavior is implemented test-first, while generated icons and framework configuration are treated as scaffold infrastructure.

**Tech Stack:** Node.js 22, pnpm, Vue 3, TypeScript, Vite, Pinia, xterm.js, Vitest, ESLint, Prettier, Tauri 2, Rust stable, Tokio, portable-pty, serde, thiserror, tracing.

---

## File map

### Repository and build

- `.nvmrc`: pins Node.js 22.
- `.gitignore`: excludes dependencies, build output, IDE state, and Tauri artifacts.
- `package.json`: scripts and frontend dependency contract.
- `pnpm-lock.yaml`: reproducible JavaScript dependency graph.
- `index.html`, `vite.config.ts`, `tsconfig*.json`: Vite and TypeScript baseline.
- `eslint.config.js`, `.prettierrc.json`: frontend quality rules.
- `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/build.rs`: Rust and Tauri build baseline.
- `src-tauri/capabilities/default.json`: minimum Tauri capability set.

### Rust backend

- `src-tauri/src/main.rs`: desktop binary entry point only.
- `src-tauri/src/lib.rs`: Tauri application composition and command registration.
- `src-tauri/src/session/mod.rs`: session module exports.
- `src-tauri/src/session/model.rs`: identifiers, snapshots, state, dimensions, and chunks.
- `src-tauri/src/session/error.rs`: stable session error codes and public errors.
- `src-tauri/src/session/state.rs`: legal state transitions.
- `src-tauri/src/session/backend.rs`: backend port and backend event types.
- `src-tauri/src/session/registry.rs`: session ownership and command dispatch.
- `src-tauri/src/session/local_pty.rs`: portable-pty adapter.
- `src-tauri/src/ipc/session_commands.rs`: validated Tauri command/channel adapter.

### Vue frontend

- `src/main.ts`: Vue and Pinia bootstrap.
- `src/App.vue`: application shell composition.
- `src/styles/tokens.css`, `src/styles/global.css`: design tokens and global layout.
- `src/domain/session.ts`: frontend session contract.
- `src/domain/workspace.ts`: tab and split-tree pure domain behavior.
- `src/services/sessionClient.ts`: Tauri IPC adapter.
- `src/stores/workspaceStore.ts`: workspace orchestration.
- `src/terminal/terminalAdapter.ts`: xterm.js lifecycle boundary.
- `src/components/AppHeader.vue`: brand and global new-terminal action.
- `src/components/TerminalTabs.vue`: accessible tab strip.
- `src/components/WorkspacePane.vue`: recursive split renderer.
- `src/components/TerminalPane.vue`: terminal and session lifecycle.
- `src/components/StatusBar.vue`: focused session status.
- `src/components/EmptyWorkspace.vue`: first-run action.
- `src/**/*.spec.ts`: colocated Vitest behavior tests.

## Task 1: Establish the reproducible Tauri/Vue baseline

**Files:**
- Create all repository/build files listed above.
- Create `src-tauri/icons/*` using the official Tauri icon generator.

- [ ] **Step 1: Create the package contract**

Create `package.json` with local tooling and no global CLI dependency:

```json
{
  "name": "fleurterm",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit && vite build",
    "test": "vitest run",
    "lint": "eslint . --max-warnings 0",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "vue-tsc --noEmit",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/xterm": "^5.5.0",
    "pinia": "^3.0.0",
    "vue": "^3.5.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@types/node": "^24.0.0",
    "@vitejs/plugin-vue": "^6.0.0",
    "@vitest/eslint-plugin": "^1.0.0",
    "@vue/eslint-config-prettier": "^10.0.0",
    "@vue/test-utils": "^2.4.0",
    "eslint": "^9.0.0",
    "eslint-plugin-vue": "^10.0.0",
    "jsdom": "^26.0.0",
    "prettier": "^3.0.0",
    "typescript": "~5.9.0",
    "typescript-eslint": "^8.0.0",
    "vite": "^7.0.0",
    "vitest": "^3.0.0",
    "vue-tsc": "^3.0.0"
  },
  "engines": {
    "node": ">=22.12"
  },
  "packageManager": "pnpm@11.9.0"
}
```

- [ ] **Step 2: Add framework configuration and minimal entry points**

Create `.nvmrc` containing `22`, configure strict TypeScript, Vue/Vite, Vitest with jsdom, ESLint flat config, Prettier, Tauri application identifier `io.fleurui.fleurterm`, and a minimal `App.vue` that renders `FleurTerm by FleurUI`. Scaffold files are configuration/generated infrastructure and do not introduce domain behavior.

- [ ] **Step 3: Install and lock dependencies**

Run: `nvm use 22 && pnpm install`

Expected: `pnpm-lock.yaml` is created with no peer-dependency errors.

- [ ] **Step 4: Verify the empty baseline**

Run: `pnpm typecheck && pnpm lint && pnpm test --passWithNoTests && cargo check --manifest-path src-tauri/Cargo.toml`

Expected: every command exits 0.

- [ ] **Step 5: Commit**

```bash
git add .nvmrc .gitignore package.json pnpm-lock.yaml index.html vite.config.ts tsconfig*.json eslint.config.js .prettierrc.json src src-tauri
git commit -m "chore: scaffold FleurTerm desktop application"
```

## Task 2: Implement the session state domain with TDD

**Files:**
- Create: `src-tauri/src/session/model.rs`
- Create: `src-tauri/src/session/error.rs`
- Create: `src-tauri/src/session/state.rs`
- Create: `src-tauri/src/session/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing state-transition tests**

```rust
#[test]
fn ready_session_can_begin_closing() {
    let next = SessionState::Ready.transition_to(SessionState::Closing);
    assert_eq!(next, Ok(SessionState::Closing));
}

#[test]
fn closed_session_rejects_ready_transition() {
    let result = SessionState::Closed.transition_to(SessionState::Ready);
    assert!(matches!(result, Err(SessionError::InvalidStateTransition { .. })));
}
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml session::state`

Expected: compilation fails because `SessionState` and its transition behavior do not exist.

- [ ] **Step 3: Implement the minimal typed state model**

Use serde-tagged enums for `SessionState` and `BackendType`, a validated `TerminalDimensions`, opaque `SessionId`, `SessionSnapshot`, and `TerminalChunk`. Implement transitions through one exhaustive `match`; never use string states or unchecked dimensions.

```rust
pub enum SessionState {
    Created,
    Starting,
    Ready,
    Closing,
    Closed,
    Failed,
}

impl SessionState {
    pub fn transition_to(self, next: Self) -> Result<Self, SessionError> {
        match (self, next) {
            (Self::Created, Self::Starting)
            | (Self::Starting, Self::Ready)
            | (Self::Starting, Self::Failed)
            | (Self::Ready, Self::Closing)
            | (Self::Ready, Self::Failed)
            | (Self::Closing, Self::Closed) => Ok(next),
            (current, requested) => Err(SessionError::invalid_transition(current, requested)),
        }
    }
}
```

- [ ] **Step 4: Add boundary tests**

Test dimensions `0`, maximum accepted values, oversized values, and stable serialization names. Run the focused test until all cases pass.

- [ ] **Step 5: Run Rust quality checks and commit**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml --check && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings && cargo test --manifest-path src-tauri/Cargo.toml`

```bash
git add src-tauri/src
git commit -m "feat: define local session domain"
```

## Task 3: Implement backend dispatch and session ownership with TDD

**Files:**
- Create: `src-tauri/src/session/backend.rs`
- Create: `src-tauri/src/session/registry.rs`
- Modify: `src-tauri/src/session/mod.rs`

- [ ] **Step 1: Write a failing registry behavior test**

```rust
#[tokio::test]
async fn closing_a_registered_session_removes_it() {
    let backend = RecordingBackend::ready();
    let registry = SessionRegistry::new(Arc::new(backend));
    let snapshot = registry.open_local(OpenLocalSessionRequest::default()).await.unwrap();

    registry.close(&snapshot.session_id).await.unwrap();

    assert!(registry.snapshot(&snapshot.session_id).await.is_err());
}
```

- [ ] **Step 2: Run and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml session::registry`

Expected: failure because the backend port and registry do not exist.

- [ ] **Step 3: Implement the backend port and registry**

Define a small async port with `open`, `write`, `resize`, `interrupt`, and `close`. The registry owns `HashMap<SessionId, SessionHandle>` behind Tokio synchronization, validates existence before dispatch, and makes close idempotent. Keep the test backend under `#[cfg(test)]`.

```rust
#[async_trait]
pub trait SessionBackend: Send + Sync {
    async fn open(&self, request: OpenLocalSessionRequest) -> Result<OpenedSession, SessionError>;
    async fn write(&self, handle: &SessionHandle, input: &[u8]) -> Result<(), SessionError>;
    async fn resize(&self, handle: &SessionHandle, size: TerminalDimensions) -> Result<(), SessionError>;
    async fn close(&self, handle: SessionHandle) -> Result<(), SessionError>;
}
```

- [ ] **Step 4: Cover invalid and concurrent behavior**

Add tests for unknown IDs, duplicate close, oversized input, and two independent sessions. Run the registry tests and then the full Rust suite.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/session
git commit -m "feat: add session registry and backend boundary"
```

## Task 4: Connect portable-pty and the Tauri IPC channel

**Files:**
- Create: `src-tauri/src/session/local_pty.rs`
- Create: `src-tauri/src/ipc/mod.rs`
- Create: `src-tauri/src/ipc/session_commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing shell-selection and validation tests**

Test that an explicit supported shell is selected, an unavailable shell returns `ShellUnavailable`, input larger than 64 KiB is rejected, and output sequence starts at one and increases monotonically.

- [ ] **Step 2: Run and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml local_pty && cargo test --manifest-path src-tauri/Cargo.toml ipc`

Expected: failure because the PTY adapter and command validation are missing.

- [ ] **Step 3: Implement LocalPtyBackend**

Use `portable_pty::native_pty_system`, a bounded Tokio `mpsc` queue, and `spawn_blocking` for blocking reader/writer operations. Select the shell from the request or platform default without interpolating user input into a command string. Batch output by a 16–32 ms interval or 64 KiB threshold and attach a monotonic sequence.

- [ ] **Step 4: Implement the IPC adapter**

Expose `session_open_local`, `session_write`, `session_resize`, `session_interrupt`, and `session_close`. Accept a Tauri `Channel<TerminalChunk>` when opening; validate all DTOs again before registry dispatch. Register managed state in `lib.rs` and close active sessions during application exit.

- [ ] **Step 5: Verify a real controlled shell**

Add a macOS integration test that opens `/bin/sh`, writes `printf fleurterm-ready\\n`, observes the marker, closes the session, and confirms the process is reaped. The command is fixed test data and never contains external input.

- [ ] **Step 6: Run Rust gates and commit**

Run all Rust tests, rustfmt check, and Clippy with warnings denied.

```bash
git add src-tauri
git commit -m "feat: run local PTY sessions through Tauri"
```

## Task 5: Implement the immutable tab and split-tree domain with TDD

**Files:**
- Create: `src/domain/session.ts`
- Create: `src/domain/workspace.ts`
- Create: `src/domain/workspace.spec.ts`

- [ ] **Step 1: Write failing workspace tests**

```typescript
it('splits the focused pane horizontally with a new session', () => {
  const workspace = createWorkspace('session-a');

  const updated = splitPane(workspace, workspace.focusedPaneId, 'horizontal', 'session-b');

  expect(updated.tabs[0].root).toMatchObject({ direction: 'horizontal' });
  expect(updated.focusedSessionId).toBe('session-b');
});

it('collapses a split after one pane closes', () => {
  const split = splitPane(createWorkspace('session-a'), 'pane-1', 'vertical', 'session-b');
  const updated = closePane(split, split.focusedPaneId);
  expect(updated.tabs[0].root).toMatchObject({ kind: 'pane', sessionId: 'session-a' });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test src/domain/workspace.spec.ts`

Expected: failure because the workspace API does not exist.

- [ ] **Step 3: Implement minimal immutable transformations**

Use discriminated unions for `TerminalPaneNode` and `TerminalSplitNode`, UUID creation behind an injected `IdGenerator`, and pure functions for new tab, activate tab, split pane, close pane, and close tab. Reject unknown IDs without mutating the previous state.

- [ ] **Step 4: Cover edge behavior**

Test closing the final pane, closing an inactive tab, splitting an unknown pane, and maintaining focus after removal. Run all frontend tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain
git commit -m "feat: model terminal tabs and split layouts"
```

## Task 6: Build the frontend session and terminal adapters with TDD

**Files:**
- Create: `src/services/sessionClient.ts`
- Create: `src/services/sessionClient.spec.ts`
- Create: `src/terminal/terminalAdapter.ts`
- Create: `src/terminal/terminalAdapter.spec.ts`
- Create: `src/stores/workspaceStore.ts`

- [ ] **Step 1: Write failing adapter tests**

Inject the Tauri invoke/channel boundary and xterm factory. Verify that opening a session installs the channel before invoking, terminal input calls `session_write`, resize sends positive integer dimensions, sequence gaps raise a visible session error, and dispose removes listeners exactly once.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test src/services/sessionClient.spec.ts src/terminal/terminalAdapter.spec.ts`

Expected: failure because both adapters are missing.

- [ ] **Step 3: Implement SessionClient**

Expose typed methods `openLocal`, `write`, `resize`, `interrupt`, and `close`. Keep command names in one constant map, enforce the 64 KiB frontend input boundary, and map unknown IPC errors to a stable public `SessionClientError` without exposing raw objects.

- [ ] **Step 4: Implement TerminalAdapter and workspace store**

Create xterm and Fit Addon, subscribe to data/resize, validate ordered chunks, and dispose all subscriptions. The Pinia store orchestrates the pure workspace model with SessionClient and records snapshots by session ID; it does not invoke Tauri directly.

- [ ] **Step 5: Run frontend gates and commit**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`

```bash
git add src/services src/terminal src/stores
git commit -m "feat: connect terminal workspace to local sessions"
```

## Task 7: Build the usable desktop workspace with component tests

**Files:**
- Create: `src/components/*.vue`
- Create: `src/components/*.spec.ts`
- Modify: `src/App.vue`
- Create: `src/styles/tokens.css`
- Create: `src/styles/global.css`
- Modify: `src/main.ts`

- [ ] **Step 1: Write failing user-flow component tests**

Mount the app with a testing Pinia and injected fake SessionClient. Verify empty-state creation, two tabs, tab activation, close action, horizontal split, vertical split, focused-pane status, loading state, and shell-start failure with retry.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test src/components`

Expected: failure because the application components do not exist.

- [ ] **Step 3: Implement semantic components**

Use native buttons, ARIA tab roles, visible focus styles, text plus color for session state, and a recursive workspace pane component. Keep session lifecycle in `TerminalPane.vue`; keep `App.vue` limited to shell composition.

- [ ] **Step 4: Apply FleurTerm design tokens**

Define named tokens for surfaces, borders, text, accent, success, warning, danger, spacing, radii, and type. Build a terminal-first layout with a compact header, tab strip, flexible workspace, and status bar. Respect `prefers-reduced-motion`.

- [ ] **Step 5: Run frontend gates and production build**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm format:check && pnpm build`

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "feat: add FleurTerm terminal workspace UI"
```

## Task 8: Perform end-to-end verification and harden lifecycle behavior

**Files:**
- Modify only files implicated by verification failures.
- Create: `README.md`

- [ ] **Step 1: Write the development and verification contract**

Document Node/Rust prerequisites, `nvm use`, `pnpm install`, browser frontend testing limitations, `pnpm tauri dev`, and every quality command. Do not claim SSH or AI support.

- [ ] **Step 2: Run the complete automated gate**

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm format:check
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
pnpm tauri build --debug
```

Expected: all commands exit 0 with no warnings promoted to errors.

- [ ] **Step 3: Run the desktop smoke flow**

Start `pnpm tauri dev`, create two local terminals, run `printf 'fleurterm-smoke\\n'` in each, create horizontal and vertical splits, resize the window, close panes and tabs, and quit the app. Confirm the expected output, responsive dimensions, clear status transitions, and no leftover child Shell processes.

- [ ] **Step 4: Review security and scope**

Confirm there are no credentials, arbitrary environment injection, shell command concatenation, unrestricted capabilities, unbounded queues, dead code, placeholder modules, generated build artifacts, or unrelated changes in Git.

- [ ] **Step 5: Commit the verified foundation**

```bash
git add README.md package.json pnpm-lock.yaml src src-tauri
git commit -m "docs: document FleurTerm development workflow"
```

## Plan self-review

- The plan covers every acceptance criterion in the approved local-terminal specification.
- All domain behavior follows RED, GREEN, REFACTOR order; only framework configuration and generated icon assets are scaffold exceptions.
- Rust and TypeScript types use consistent names across backend, IPC, stores, and components.
- SSH, persistence, AI, plugins, signing, and release automation remain outside this implementation cycle.
- No task contains an unspecified implementation placeholder.
