# FleurTerm SFTP Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a connection-bound SFTP panel that lists remote directories and uploads or downloads files for ready terminals opened from saved FleurTerm SSH profiles.

**Architecture:** A Rust `ssh2` registry owns authenticated blocking SFTP connections behind opaque identifiers and exposes narrow Tauri commands. Vue records runtime terminal-to-profile bindings, renders a dedicated SFTP panel inside eligible terminal panes, and uses native file dialogs so file bytes never cross JavaScript IPC.

**Tech Stack:** Vue 3, TypeScript, Pinia, Vitest, Tauri 2, Rust 2024, `ssh2`, `tauri-plugin-dialog`

---

### Task 1: Add SFTP and native-dialog dependencies

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/src/lib.rs`

- [ ] Add `@tauri-apps/plugin-dialog@^2`, `dirs = "6"`, `ssh2 = { version = "0.9", features = ["vendored-openssl"] }`, and `tauri-plugin-dialog = "2"`.
- [ ] Register `.plugin(tauri_plugin_dialog::init())` and grant only `dialog:allow-open` and `dialog:allow-save`.
- [ ] Run `pnpm version:check` and `cargo check --manifest-path src-tauri/Cargo.toml`; expect both to pass.

### Task 2: Define the Rust SFTP domain boundary with TDD

**Files:**
- Create: `src-tauri/src/sftp/mod.rs`
- Create: `src-tauri/src/sftp/model.rs`
- Create: `src-tauri/src/sftp/path.rs`
- Create: `src-tauri/src/sftp/error.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] Write failing tests for absolute POSIX path normalization, parent paths, safe child names, directory-first ordering, metadata conversion, request validation, and credential-safe public errors.

```rust
#[test]
fn joins_only_a_safe_child_name() {
    assert_eq!(join_remote_child("/tmp", "report.txt").unwrap(), "/tmp/report.txt");
    assert!(join_remote_child("/tmp", "../secret").is_err());
    assert!(join_remote_child("/tmp", "nested/file").is_err());
}

#[test]
fn normalizes_absolute_remote_paths() {
    assert_eq!(normalize_remote_path("/var/../tmp/./files").unwrap(), "/tmp/files");
    assert!(normalize_remote_path("tmp/files").is_err());
}
```

- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml sftp::`; confirm RED because the functions do not exist.
- [ ] Implement camel-case serialized `OpenSftpRequest`, `OpenSftpResponse`, `ListSftpDirectoryResponse`, `SftpDirectoryEntry`, `SftpAuthMethod`, `SftpEntryKind`, `SftpError`, and `PublicSftpError`.

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenSftpRequest {
    pub connection_id: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth_method: SftpAuthMethod,
    pub private_key_paths: Vec<String>,
}
```

- [ ] Implement platform-independent POSIX path helpers and stable directory-first sorting.
- [ ] Run the targeted Rust tests and `cargo fmt --check`; confirm GREEN.

### Task 3: Implement authenticated SFTP connections and commands with TDD

**Files:**
- Create: `src-tauri/src/sftp/connection.rs`
- Create: `src-tauri/src/sftp/registry.rs`
- Create: `src-tauri/src/ipc/sftp_commands.rs`
- Modify: `src-tauri/src/ipc/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] Write failing tests with a fake `SftpOperations` adapter for registry insertion/close, directory listing, safe upload destination construction, download cleanup after failure, and stable public error codes.

```rust
#[tokio::test]
async fn closing_a_registered_session_removes_it() {
    let registry = SftpRegistry::default();
    let id = registry.insert(Box::new(FakeSftpOperations::default())).await;
    registry.close(&id).await.unwrap();
    assert!(matches!(registry.list(&id, "/").await, Err(SftpError::SessionNotFound)));
}
```

- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml sftp::registry ipc::sftp_commands`; confirm RED.
- [ ] Implement `Ssh2SftpConnection::connect`: bounded TCP timeouts, handshake, `~/.ssh/known_hosts` `check_port`, rejection of unknown/changed keys, requested authentication, and `session.authenticated()` verification.
- [ ] Support agent, configured private-key paths, encrypted-vault password, keyboard-interactive password responses, and ordered auto authentication. Zeroize copied passwords after authentication.
- [ ] Implement directory metadata conversion and `std::io::copy` transfers. Remove incomplete local downloads after remote read failure and construct uploads only from a validated remote directory plus local file name.
- [ ] Implement `SftpRegistry` using UUID identifiers and `Arc<Mutex<Box<dyn SftpOperations>>>`; release the registry map lock before blocking I/O.
- [ ] Expose and register these commands:

```rust
pub async fn sftp_open(...) -> Result<OpenSftpResponse, PublicSftpError>;
pub async fn sftp_list_directory(...) -> Result<ListSftpDirectoryResponse, PublicSftpError>;
pub async fn sftp_upload_files(...) -> Result<(), PublicSftpError>;
pub async fn sftp_download_file(...) -> Result<(), PublicSftpError>;
pub async fn sftp_close(...) -> Result<(), PublicSftpError>;
```

- [ ] Manage the registry in `run()` and close all SFTP sessions during application exit.
- [ ] Run targeted Rust tests and formatting; confirm GREEN.

### Task 4: Add typed frontend SFTP services with TDD

**Files:**
- Create: `src/services/sftpClient.spec.ts`
- Create: `src/services/sftpClient.ts`
- Create: `src/services/sftpFileDialogs.spec.ts`
- Create: `src/services/sftpFileDialogs.ts`

- [ ] Write failing tests for exact IPC command names and camel-case payloads, response validation, structured error mapping, multiple upload selection, cancelled dialogs, and download destinations.

```typescript
it('opens SFTP without sending the saved password', async () => {
  invoke.mockResolvedValue({ sftpSessionId: 'sftp-1', path: '/home/root' });
  await client.open(profile);
  expect(invoke).toHaveBeenCalledWith('sftp_open', {
    request: {
      connectionId: 'server-1',
      host: '10.7.121.81',
      port: 22,
      user: 'root',
      authMethod: 'agent',
      privateKeyPaths: [],
    },
  });
});
```

- [ ] Run `pnpm test src/services/sftpClient.spec.ts src/services/sftpFileDialogs.spec.ts`; confirm RED.
- [ ] Implement validated `SftpClient` methods for open, list, upload, download, and close. Never include `password` in an IPC request.
- [ ] Wrap `@tauri-apps/plugin-dialog` `open` and `save` in focused functions returning normalized path results.
- [ ] Run targeted service tests; confirm GREEN.

### Task 5: Track saved-connection ownership per runtime pane with TDD

**Files:**
- Modify: `src/stores/workspaceStore.spec.ts`
- Modify: `src/stores/workspaceStore.ts`

- [ ] Write failing tests for `connectionProfileIdForSession` and `sessionStateForSession`, cleanup on pane/tab close, and a local split pane not inheriting the SSH profile.

```typescript
expect(store.connectionProfileIdForSession('ssh-session')).toBe('production');
expect(store.connectionProfileIdForSession('local-session')).toBeNull();
expect(store.sessionStateForSession('ssh-session')).toBe('ready');
```

- [ ] Run `pnpm test src/stores/workspaceStore.spec.ts`; confirm RED.
- [ ] Record `connectionProfileId` by returned runtime session ID inside `openSession`, expose read-only queries, and clear the binding through `removeSessionState`. Do not persist this runtime map.
- [ ] Run the targeted store tests; confirm GREEN.

### Task 6: Build the SFTP panel with TDD

**Files:**
- Create: `src/components/SftpPanel.spec.ts`
- Create: `src/components/SftpPanel.vue`
- Modify: `src/i18n/locale.spec.ts`
- Modify: `src/i18n/locale.ts`
- Modify: `src/styles/tokens.css`

- [ ] Write failing component tests for initial connection/listing, retry, directory/parent/breadcrumb navigation, refresh, empty state, upload/download cancellation and success, backend cleanup, and stale response suppression.
- [ ] Run `pnpm test src/components/SftpPanel.spec.ts`; confirm RED.
- [ ] Add matching English and Chinese keys for all SFTP controls, columns, states, and safe errors. Extend locale parity tests.
- [ ] Implement explicit `connecting`, `ready`, and `failed` states, serialized transfers, request-generation stale response protection, and disposal of late-opened sessions.
- [ ] Style a responsive 220–420 px bottom panel using existing theme tokens, compact actions, subtle separators, row hover, visible focus, and no permanent high-contrast container border.
- [ ] Run panel and locale tests; confirm GREEN.

### Task 7: Integrate SFTP into eligible terminal panes with TDD

**Files:**
- Create: `src/components/TerminalPane.spec.ts`
- Modify: `src/components/TerminalPane.vue`
- Modify: `src/components/WorkspacePane.vue`
- Modify: `src/App.spec.ts`

- [ ] Write failing tests proving the action appears only for a ready runtime session bound to an existing saved SSH profile, and remains hidden for local, Telnet, serial, manually invoked SSH, missing-profile, connecting, failed, and closed sessions.
- [ ] Test opening/closing `SftpPanel` and automatic closure when eligibility is lost.
- [ ] Run `pnpm test src/components/TerminalPane.spec.ts src/App.spec.ts`; confirm RED.
- [ ] Resolve eligibility per pane using the workspace runtime binding, session state, and current saved profiles. Render the compact action and panel inside the same terminal pane.
- [ ] Stop SFTP controls from injecting terminal focus events and close the panel immediately when the session becomes unavailable.
- [ ] Run integration tests; confirm GREEN.

### Task 8: Complete verification

**Files:**
- Modify only files required to correct verification failures.

- [ ] Run Prettier on modified frontend files and `cargo fmt --manifest-path src-tauri/Cargo.toml`.
- [ ] Run `pnpm test`, `pnpm lint`, `pnpm build`, and `pnpm version:check`; expect all to pass.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml` and `cargo fmt --check --manifest-path src-tauri/Cargo.toml`; expect all to pass.
- [ ] Run `git diff --check` and `git status --short`; expect no whitespace errors, secrets, generated transfer files, or unrelated modifications.
- [ ] Report that automated tests use fake SFTP adapters and that real password, private-key, agent, host-key, upload, and download behavior still requires manual verification against a user-owned SSH server.
