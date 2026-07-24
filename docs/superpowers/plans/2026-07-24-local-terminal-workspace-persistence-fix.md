# Local Terminal Workspace Persistence Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent default local terminals from invalidating workspace persistence and restore every open application tab, including settings, with its order and active state.

**Architecture:** Keep terminal launch metadata in the existing workspace DTO, add version-2 application-tab metadata through a nullable settings-tab index, and map persisted terminal IDs to runtime IDs during restoration. Make the native serializer omit absent local fields and make the frontend parser accept legacy `null` fields so already-written files remain recoverable.

**Tech Stack:** Vue 3, Pinia, TypeScript, Vitest, Tauri 2, Rust, Serde

---

### Task 1: Recover local terminal workspace records

**Files:**
- Modify: `src/services/workspacePersistence.spec.ts`
- Modify: `src/services/workspacePersistence.ts`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing frontend parser test**

Add a Vitest case that passes Rust-shaped local launch data with `shell`, `args`, and `cwd` set to `null`, then expects a valid local launch with those keys omitted.

```ts
expect(
  parsePersistedWorkspace({
    version: 1,
    activeTabId: 'local-tab',
    tabs: [{
      id: 'local-tab',
      title: 'Local',
      launch: { type: 'local', shell: null, args: null, cwd: null },
    }],
  }),
).toEqual({
  version: 1,
  activeTabId: 'local-tab',
  tabs: [{ id: 'local-tab', title: 'Local', launch: { type: 'local' } }],
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --config.verify-deps-before-run=false test src/services/workspacePersistence.spec.ts`

Expected: FAIL because `parsePersistedWorkspace` returns `null`.

- [ ] **Step 3: Accept legacy null optional fields**

Change `optionalString` and `optionalStringArray` so both `undefined` and `null` represent an absent optional value, while all other invalid types still return the invalid sentinel.

```ts
if (field === undefined || field === null) {
  return undefined;
}
```

- [ ] **Step 4: Add and run the native serialization regression test**

Serialize a local `PersistedTerminalWorkspace` with all optional launch fields set to `None` and assert that the resulting launch object contains only `{ "type": "local" }`. Verify the test fails before adding `skip_serializing_if = "Option::is_none"` to all three native local fields, then rerun it to PASS.

- [ ] **Step 5: Run both focused suites**

Run: `pnpm --config.verify-deps-before-run=false test src/services/workspacePersistence.spec.ts`

Run: `cargo test --manifest-path src-tauri/Cargo.toml terminal_workspace`

Expected: both PASS.

### Task 2: Persist settings tab state in schema version 2

**Files:**
- Modify: `src/services/workspacePersistence.spec.ts`
- Modify: `src/services/workspacePersistence.ts`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing serializer and parser tests**

Define an application-tab snapshot containing `activeTabId`, `tabOrder`, and `settingsTabOpen`. Expect `createPersistedWorkspace` to produce version 2 and a `settingsTabIndex`, and expect a version-1 workspace to migrate with `settingsTabIndex: null`.

```ts
createPersistedWorkspace(workspace, {
  activeTabId: 'app-settings',
  tabOrder: ['tab-1', 'app-settings'],
  settingsTabOpen: true,
});
```

Expected persisted fields:

```ts
{
  version: 2,
  activeTabId: 'app-settings',
  settingsTabIndex: 1,
  tabs: [{ id: 'tab-1', title: 'Local', launch: { type: 'local' } }],
}
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --config.verify-deps-before-run=false test src/services/workspacePersistence.spec.ts`

Expected: FAIL because schema version 2 and settings metadata are not implemented.

- [ ] **Step 3: Implement the typed version-2 model and v1 migration**

Add `PersistedApplicationTabs`, version-2 `settingsTabIndex`, validation that the index is within `0..tabs.length`, and active-ID validation against terminal IDs plus `app-settings` only when settings is open. Convert valid version-1 data to the version-2 in-memory shape with `settingsTabIndex: null`.

- [ ] **Step 4: Extend the Rust DTO safely**

Add `settings_tab_index: Option<usize>` with `#[serde(default, skip_serializing_if = "Option::is_none")]`. Retain `deny_unknown_fields`, and add a Rust test proving settings metadata round-trips without allowing sensitive launch fields.

- [ ] **Step 5: Run focused frontend and Rust tests**

Run: `pnpm --config.verify-deps-before-run=false test src/services/workspacePersistence.spec.ts`

Run: `cargo test --manifest-path src-tauri/Cargo.toml terminal_workspace`

Expected: both PASS.

### Task 3: Restore and save the complete application tab strip

**Files:**
- Modify: `src/App.spec.ts`
- Modify: `src/App.vue`

- [ ] **Step 1: Write failing application tests**

Add tests that verify:

1. A saved settings tab is restored at its persisted position and remains active.
2. Opening a default local terminal with an existing SSH tab and settings tab saves all three application tabs instead of an empty workspace.
3. Opening, closing, activating, or moving settings triggers persistence even when terminal workspace state does not change.

- [ ] **Step 2: Run focused application tests and verify RED**

Run: `pnpm --config.verify-deps-before-run=false test src/App.spec.ts`

Expected: FAIL because `App.vue` currently persists only the terminal workspace.

- [ ] **Step 3: Restore runtime IDs and settings state**

While restoring terminals, map each persisted terminal ID to the runtime active tab ID created by `store.openTab`. Rebuild `appTabOrder` using runtime IDs, insert `app-settings` at `settingsTabIndex`, and map the persisted active terminal ID or fixed settings ID to `activeAppTabId`.

- [ ] **Step 4: Save combined application state**

Replace the terminal-only watcher snapshot with `createPersistedWorkspace(workspace, { activeTabId, tabOrder, settingsTabOpen })`. Ensure the final close flush uses the same snapshot so settings-only changes are included in the serialized queue.

- [ ] **Step 5: Run focused application tests**

Run: `pnpm --config.verify-deps-before-run=false test src/App.spec.ts src/services/workspacePersistence.spec.ts`

Expected: PASS.

### Task 4: Verify and commit the hotfix

**Files:**
- Verify all modified files

- [ ] **Step 1: Run frontend verification**

Run: `pnpm --config.verify-deps-before-run=false test`

Run: `pnpm --config.verify-deps-before-run=false lint`

Run: `pnpm --config.verify-deps-before-run=false build`

Expected: all commands exit 0.

- [ ] **Step 2: Run native and repository verification**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Run: `cargo fmt --check --manifest-path src-tauri/Cargo.toml`

Run: `git diff --check`

Expected: all commands exit 0.

- [ ] **Step 3: Review security and scope**

Confirm the persisted JSON contains no password, token, private-key content, runtime session ID, or terminal output, and confirm only workspace persistence files, their tests, and the approved documentation changed.

- [ ] **Step 4: Commit the implementation**

```bash
git add src/services/workspacePersistence.ts src/services/workspacePersistence.spec.ts src/App.vue src/App.spec.ts src-tauri/src/lib.rs
git commit -m "fix: preserve local and settings tabs"
```
