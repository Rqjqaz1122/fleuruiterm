# Local terminal workspace persistence hotfix

## Goal

Keep every open application tab across restarts, including local terminals, saved connections, and the settings tab. Restore the previously active tab and tab order without persisting terminal output, runtime session identifiers, passwords, tokens, or private key contents.

## Root cause

The native workspace DTO serializes absent local terminal launch fields (`shell`, `args`, and `cwd`) as JSON `null`. The frontend parser currently accepts only omitted fields or correctly typed values, so it rejects the entire workspace when a default local terminal is present. A later save can then replace the rejected workspace with an empty snapshot. Saved SSH connection entries do not contain these optional fields and therefore restore normally.

## Persistence model

Workspace schema version 2 retains terminal entries and adds application-tab state:

- `tabs`: terminal tabs in terminal order, containing only stable launch metadata.
- `activeTabId`: the persisted terminal tab identifier or the fixed settings-tab identifier.
- `settingsTabIndex`: the settings tab position in the complete tab strip, or `null` when settings is closed.

Runtime terminal and pane session identifiers remain excluded. During restoration, persisted terminal identifiers are mapped to newly created runtime tab identifiers. The settings tab uses its existing fixed identifier.

Version 1 workspaces remain readable. They restore terminal tabs as before and treat settings as closed.

## Data flow

1. Load and validate `workspace.json`.
2. Accept legacy `null` values for optional local launch fields as absent values.
3. Recreate terminal sessions in saved order and map persisted tab identifiers to runtime identifiers.
4. Reinsert the settings tab at its saved index when present.
5. Restore the active terminal or settings tab.
6. Observe terminal and application-tab state changes and serialize saves through the existing save queue.
7. Flush the latest combined snapshot before window close, application exit, or update restart.

## Native compatibility

The Rust DTO omits absent optional local launch fields when serializing. It accepts both schema versions and the optional settings-tab field while retaining `deny_unknown_fields` and the existing sensitive-field rejection.

## Error handling

- A malformed workspace is rejected as a whole instead of partially trusting unsafe data.
- A missing saved connection skips only that terminal during restoration.
- Existing persistence errors continue to keep the application open during a final flush failure.
- Already overwritten workspace data cannot be reconstructed; the fix prevents future loss and recovers legacy files that still contain local launch `null` values.

## Tests

- Frontend parser accepts Rust-generated `null` local launch fields.
- Native serialization omits absent local launch fields.
- Version 1 terminal-only workspaces still restore.
- Settings presence, position, and active state persist and restore.
- Opening a local terminal alongside existing SSH and settings tabs does not remove them from the saved snapshot.
- Existing frontend, lint, build, Rust tests, formatting, and diff checks remain green.
