# FleurTerm Automatic Update Download Design

Date: 2026-08-03

## Goal

Add a persistent **Automatically download updates** toggle to **Settings → General → Software updates**. The toggle is off by default. When enabled, the existing startup update check automatically downloads and prepares an available update without interrupting active terminal, SSH, or SFTP sessions.

## User Experience

- The General settings list displays the bilingual automatic-download preference as its own row, at the same hierarchy as **Open terminal on startup**.
- The preference row displays only the Switch control on the right; it does not render separate On/Off state text.
- Enabling the toggle persists the preference immediately.
- If the startup check finds a newer version while the toggle is enabled, FleurTerm begins downloading it without another click.
- Download progress remains visible in the existing software update card.
- After the updater prepares the new version, the card displays a **Restart and update** action. FleurTerm restarts only after the user clicks it.
- With automatic download disabled, the existing manual **Download and install** action remains available and retains its current download, state-save, and restart behavior.
- Enabling automatic download while an update is already available starts the download immediately.

## Architecture

### Persisted setting

Add an `UpdateSettings` group to the existing application settings store with one boolean field, `automaticDownloadEnabled`. The sanitizer defaults missing or invalid values to `false`, and runtime-settings serialization preserves the value alongside the existing terminal, AI, and shortcut settings.

### Update state machine

Extend the update store with a `readyToRestart` status and split the current install flow into two reusable stages:

1. `prepareUpdate()` calls Tauri Updater's `download()` operation and ends in `readyToRestart` without installing or relaunching.
2. `restartToApplyUpdate()` saves the workspace, calls `install()`, and invokes the existing process relaunch operation.

The existing manual `installUpdate()` action composes these two stages so its behavior does not change. Promise deduplication prevents automatic and manual actions from starting parallel downloads or restarts.

### Startup orchestration

App startup first runs the existing update check. After it resolves, the app starts `prepareUpdate()` only when automatic download is enabled and an update is available. A watcher also covers two runtime transitions: enabling the setting while an update is available, and detecting an update through a later manual check while the setting is enabled.

The automatic path never calls relaunch. Only the explicit **Restart and update** action may save the workspace and restart FleurTerm.

## Error Handling

- Check failures continue to use the existing non-blocking update error state.
- Download or preparation failures display a localized error and do not retry in a loop.
- Workspace-save, installation, or relaunch failures retain the prepared update state where possible and expose a retryable restart action.
- If installation succeeds but relaunch fails, retrying skips the consumed installation step and retries only the relaunch.
- Browser development mode remains `unsupported` and never invokes native updater APIs.

## Testing

- Settings-store tests cover the default value, sanitization, persistence, and serialization of the automatic-download preference.
- Update-store tests cover preparing without restart, explicit restart, retained manual behavior, error states, and concurrent-action deduplication.
- Settings-view tests cover the separate bilingual preference row, Switch-only presentation, and immediate setting updates.
- Update-card tests cover progress and the restart action without owning the automatic-download preference.
- App tests cover automatic preparation after detection, no automatic restart, disabled behavior, and enabling the toggle for an already available update.
- Existing frontend tests, type checking, linting, production build, Rust tests, and diff checks remain required.

## Out of Scope

- Forced restart, scheduled restart, background polling, retry loops, update channels, and resumable downloads.
- Changes to AI-managed settings permissions.
- Changes to release signing, updater endpoints, or GitHub Actions release behavior.
