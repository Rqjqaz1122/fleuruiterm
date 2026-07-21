# Tool Card Disclosure and macOS Keychain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make historical terminal tool cards expand completely without overlap and persist saved SSH passwords in the macOS system Keychain.

**Architecture:** Replace the nested output-only disclosure with a single whole-card disclosure while keeping actionable states expanded. Extract connection password persistence into a Rust credentials module with platform backends: existing Windows Credential Manager and new macOS Security.framework Keychain support.

**Tech Stack:** Vue 3, TypeScript, Vitest, CSS, Rust 2024, Tauri 2, security-framework 3.7.

---

### Task 1: Whole-card terminal disclosure

**Files:**
- Modify: `src/components/AiToolCard.spec.ts`
- Modify: `src/components/AiToolCard.vue`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Write failing disclosure tests**

Add tests asserting a completed call renders a closed `.ai-tool-disclosure`, its summary includes `pwd`, and its body contains the full command and output. Add assertions that proposed and blocked calls render with the disclosure open.

- [ ] **Step 2: Run tests and verify RED**

Run `pnpm test src/components/AiToolCard.spec.ts`.

Expected: FAIL because the current card has only a nested output disclosure and no whole-card disclosure.

- [ ] **Step 3: Implement one disclosure per card**

Render the status header as `<summary>`. Put target session, risk, full command, output, errors and actions in `.ai-tool-card-body`. Bind `open` for proposed and blocked states, and keep those states open if a toggle tries to close them. Remove the nested output `<details>`.

- [ ] **Step 4: Correct intrinsic layout and disclosure styling**

Remove content clipping from `.ai-tool-card`, hide the native marker, add a command summary with ellipsis, and give `.ai-tool-card-body` normal-flow spacing. Keep output bounded with its own scrolling `<pre>`.

- [ ] **Step 5: Verify the component**

Run `pnpm test src/components/AiToolCard.spec.ts src/components/AIPanel.spec.ts`.

Expected: PASS.

### Task 2: Platform credential module

**Files:**
- Create: `src-tauri/src/credentials.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`

- [ ] **Step 1: Write failing backend orchestration tests**

Add a fake `ConnectionPasswordBackend` test implementation and tests proving batch load returns existing passwords, omits missing items, and propagates backend errors.

- [ ] **Step 2: Run tests and verify RED**

Run `cargo test --manifest-path src-tauri/Cargo.toml credentials`.

Expected: FAIL because the credentials module and backend abstraction do not exist.

- [ ] **Step 3: Extract the existing Windows implementation**

Move password target construction and Windows Credential Manager read/write/delete functions from `lib.rs` into `credentials.rs`. Keep the Tauri command names and request shapes unchanged.

- [ ] **Step 4: Implement macOS Keychain persistence**

Add `security-framework = "3.7.0"` under the macOS target dependencies. Use `set_generic_password`, `generic_password(PasswordOptions::new_generic_password(...))`, and `delete_generic_password`. Treat OSStatus `-25300` as an absent item and convert stored bytes to UTF-8.

- [ ] **Step 5: Verify the backend**

Run `cargo test --manifest-path src-tauri/Cargo.toml` and `cargo check --manifest-path src-tauri/Cargo.toml`.

Expected: all tests pass and the macOS backend compiles without the previous password helper dead-code warnings.

### Task 3: Complete regression

**Files:**
- Verify all files modified by Tasks 1-2.

- [ ] **Step 1: Run frontend validation**

Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.

Expected: all commands pass.

- [ ] **Step 2: Run formatting and diff checks**

Run `pnpm exec prettier --check src/components/AiToolCard.vue src/components/AiToolCard.spec.ts src/styles/global.css`, `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, and `git diff --check`.

Expected: no formatting or whitespace errors.

- [ ] **Step 3: Build the desktop application**

Run `pnpm tauri build --debug --no-bundle`.

Expected: the debug application is produced at `src-tauri/target/debug/fleurterm`.
