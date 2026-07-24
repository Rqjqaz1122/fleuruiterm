# FleurTerm SFTP Browser Design

## Goal

Add a Tabby-style SFTP browser to an active FleurTerm SSH terminal. Users can browse remote directories, upload local files, and download remote files without opening another application.

## Scope

The SFTP action is available only when all of the following are true:

- The active terminal tab was opened from a FleurTerm saved connection.
- The saved connection method is SSH.
- The terminal session state is `ready`.
- The saved connection still exists.

A local terminal in which the user manually runs `ssh` is intentionally unsupported because FleurTerm does not own or safely inspect that connection's authentication context.

The first release includes:

- Open and close an SFTP panel below the active terminal.
- Connect using the saved SSH host, port, username, and authentication configuration.
- List a remote directory.
- Navigate into a directory and to its parent.
- Refresh the current directory.
- Upload one or more local files into the current remote directory.
- Download a remote file to a user-selected local destination.
- Display connection, loading, empty, transfer, and error states.

The first release excludes folder upload, recursive download, file deletion, renaming, moving, permissions editing, and directory creation.

## Architecture

### Frontend

`TerminalPane` remains responsible only for the terminal surface. A dedicated `SftpPanel` component renders below it when SFTP is open. The panel receives the terminal pane's saved connection identifier and delegates all SFTP operations to an `SftpClient` service.

The workspace store records which runtime session was opened from which saved connection and exposes that binding with the runtime session state. Eligibility is checked per terminal pane rather than per tab, so a local pane created by splitting an SSH tab cannot incorrectly inherit SFTP access. SFTP UI state is scoped to a terminal pane, so closing the panel or terminal disposes the corresponding SFTP backend session.

The file picker and save dialog use Tauri's dialog plugin. Only selected local paths are sent to Rust; file contents are not copied through JavaScript IPC.

### Rust backend

The backend uses the synchronous `ssh2` library inside `spawn_blocking` tasks. A dedicated SFTP registry owns authenticated SFTP connections by opaque SFTP session identifier. The registry is separate from the PTY session registry because the existing SSH terminal is a system `ssh` process and cannot safely share its transport.

The backend provides focused IPC commands:

- `sftp_open`: validate input, resolve the stored credential, authenticate, initialize SFTP, and return an opaque SFTP session identifier plus the initial path.
- `sftp_list_directory`: return structured entries for a normalized absolute remote path.
- `sftp_upload_files`: stream selected local files into the current remote directory.
- `sftp_download_file`: stream one remote file into the selected local destination.
- `sftp_close`: remove and disconnect the SFTP session.

Blocking filesystem and network work never runs on Tauri's async executor thread.

## Authentication and Security

The SFTP connection reuses the selected saved SSH profile:

- `agent`: authenticate through the local SSH agent.
- `publicKey`: try configured private-key paths in order. The profile password is used as a key passphrase when present.
- `password`: retrieve the connection password from FleurTerm's encrypted credential vault.
- `keyboardInteractive`: answer password-style prompts with the stored connection password.
- `auto`: try agent, configured private keys, password, and keyboard-interactive in that order until authenticated.

Passwords and key contents are never returned in SFTP command results, logged, or persisted in SFTP state. Command errors expose stable public codes and user-safe messages without host secrets or local path contents.

Before authentication, the backend verifies the server host key against the user's OpenSSH `known_hosts` file. A changed or unknown key is rejected. Because SFTP is available only after the system SSH terminal is connected, the user can review and accept a new host key through the normal SSH prompt before opening SFTP; FleurTerm never silently trusts an unknown server.

Remote paths are normalized as POSIX paths. Entry names cannot inject separators into upload destinations. Local upload paths and download destinations must come from the native dialog result and are validated again in Rust. Upload uses truncating file creation only after explicit file selection; download uses the destination explicitly selected by the user.

## Data Model

A directory entry contains:

- `name`
- `path`
- `kind`: `directory`, `file`, or `symlink`
- `size`
- `modifiedAt`: Unix timestamp when available
- `permissions`: formatted Unix permissions when available

Directory entries are ordered with directories first, then files and symlinks, using case-insensitive name ordering with a stable case-sensitive tie-breaker.

The frontend SFTP state contains:

- Backend SFTP session identifier.
- Current remote path and breadcrumb segments.
- Directory entries.
- Connection/listing busy state.
- Active transfer labels.
- Recoverable user-visible error.

## User Interface

For an eligible active terminal, the pane toolbar shows an `SFTP` action beside existing terminal actions. Activating it expands a panel from the bottom of the terminal pane, following FleurTerm's current dark/light tokens rather than copying Tabby's colors literally.

The panel contains:

- Header title and close action.
- Breadcrumb path with clickable ancestors.
- Parent-directory and refresh actions.
- Upload-file action.
- A compact table with name, size, modified time, permissions, and a download action for files.

Clicking a directory navigates into it. Double-clicking is not required. Download is always explicit through the file action and native save dialog. The panel keeps the current terminal visible above it and uses a bounded resizable-height layout suitable for smaller windows.

The UI supports existing English and Simplified Chinese locales. Controls include accessible names, disabled states during conflicting operations, keyboard activation, and non-color status text.

## Lifecycle and Error Handling

Opening the panel establishes SFTP and lists the server's home directory. If connection or authentication fails, the panel remains open with a retry action. A failed listing preserves the previous successful entries. A failed upload or download reports the affected operation and allows retry without reconnecting when the SFTP session remains usable.

Closing the SFTP panel, closing its terminal tab, changing that tab to an unavailable state, or exiting the application closes the backend SFTP session. Late async responses are ignored after component disposal.

Concurrent directory navigation is serialized and stale responses cannot replace a newer path. Upload and download operations are serialized per SFTP session in the first release to keep destination and error behavior deterministic.

## Testing

Frontend tests cover:

- SFTP action visibility for saved ready SSH tabs only.
- Panel open, close, retry, navigation, refresh, upload selection, and download selection.
- Loading, empty, transfer, and error states.
- Disposal when the terminal closes or becomes unavailable.
- English and Chinese labels.

Rust tests cover:

- Remote path normalization and safe child-path construction.
- File kind, permission, timestamp, and ordering conversion.
- Public error mapping without credential leakage.
- Registry insertion, lookup, serialization, and close behavior using a test SFTP adapter.
- Upload and download streaming against temporary local files and a fake remote adapter.

The final verification runs the full frontend test suite, ESLint, production build, Rust tests, and Rust formatting checks. Live-server authentication and transfer behavior require a manual check with a user-owned SSH server because automated tests must not depend on external credentials.
