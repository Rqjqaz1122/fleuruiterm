# FleurTerm

FleurTerm by FleurUI is a Tauri 2 desktop terminal foundation built with Vue 3, TypeScript, xterm.js, and Rust. The current implementation provides local Shell sessions, multiple tabs, horizontal and vertical splits, bounded terminal output, resize handling, and process cleanup.

SSH, saved profiles, AI analysis, command policy, and audit storage are planned for later MVP stages and are not included in this foundation.

## Prerequisites

- macOS with Xcode Command Line Tools
- Node.js 22 through nvm
- pnpm 11
- Rust stable through rustup

## Install

```bash
nvm use
pnpm install
```

The project pins Node.js in `.nvmrc`. pnpm only permits the required `esbuild` dependency install script through `pnpm-workspace.yaml`.

## Run

```bash
nvm use
pnpm tauri dev
```

The browser-only Vite server can render the application shell, but opening a local terminal requires the Tauri desktop runtime because session commands are implemented in Rust.

## Verify

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

## Architecture

- `src/domain`: immutable frontend session, tab, and split-tree models.
- `src/services`: typed Tauri IPC client.
- `src/stores`: workspace orchestration and bounded early-output buffering.
- `src/terminal`: xterm.js lifecycle and ordered-output adapter.
- `src/components`: terminal-first FleurTerm desktop interface.
- `src-tauri/src/session`: session domain, registry, backend boundary, and local PTY.
- `src-tauri/src/ipc`: validated Tauri commands and stable public errors.

The WebView cannot spawn processes directly. All PTY creation, input validation, resize, interrupt, close, and application-exit cleanup remain in Rust.
