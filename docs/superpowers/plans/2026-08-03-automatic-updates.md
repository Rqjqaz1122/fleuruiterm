# Automatic Update Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in setting that automatically downloads and prepares detected updates while requiring an explicit user action before FleurTerm restarts.

**Architecture:** Persist the preference in the existing application settings store. Split the update store's current download-and-restart operation into preparation and restart stages, then let `App.vue` coordinate automatic preparation by watching the preference and update status. Keep Tauri APIs isolated behind the existing updater client.

**Tech Stack:** Vue 3, TypeScript, Pinia, Vitest, Vue Test Utils, Tauri 2 Updater, Tauri Process.

---

### Task 1: Persist the automatic-download preference

**Files:**

- Create: `src/stores/appSettingsStore.spec.ts`
- Modify: `src/stores/appSettingsStore.ts`

- [ ] **Step 1: Write failing settings-store tests**

Add tests that import `defaultUpdateSettings`, `sanitizeUpdateSettings`, and `useAppSettingsStore`. Verify invalid or missing values become `false`, `updateUpdateSettings({ automaticDownloadEnabled: true })` changes the reactive setting, and `serializeRuntimeSettings()` contains:

```ts
update: {
  automaticDownloadEnabled: true;
}
```

- [ ] **Step 2: Verify the settings tests fail for the missing API**

Run: `pnpm test src/stores/appSettingsStore.spec.ts`

Expected: FAIL because the update settings exports do not exist.

- [ ] **Step 3: Add the focused settings model and persistence path**

Define:

```ts
export interface UpdateSettings {
  automaticDownloadEnabled: boolean;
}

export const defaultUpdateSettings: UpdateSettings = {
  automaticDownloadEnabled: false,
};
```

Add `updateSettings`, `sanitizeUpdateSettings`, and `updateUpdateSettings`. Include `update` in runtime-settings reading, replacement, and serialization without changing existing terminal, AI, or shortcut behavior.

- [ ] **Step 4: Verify the settings tests pass**

Run: `pnpm test src/stores/appSettingsStore.spec.ts`

Expected: PASS.

### Task 2: Separate update preparation from restart

**Files:**

- Modify: `src/services/appUpdater.spec.ts`
- Modify: `src/services/appUpdater.ts`
- Modify: `src/stores/appUpdateStore.spec.ts`
- Modify: `src/stores/appUpdateStore.ts`

- [ ] **Step 1: Write failing update-state tests**

Add service and store tests proving the native download and installation operations remain separate:

```ts
await store.prepareUpdate();
expect(store.status).toBe('readyToRestart');
expect(client.restart).not.toHaveBeenCalled();

await store.restartToApplyUpdate();
expect(client.restart).toHaveBeenCalledOnce();
```

Also verify preparation does not call installation, two simultaneous preparation calls share one download, `installUpdate()` still downloads, installs, and restarts, and a failed relaunch returns to `readyToRestart` with `RESTART_FAILED`. A relaunch retry must skip an already successful installation.

- [ ] **Step 2: Verify the new state tests fail**

Run: `pnpm test src/services/appUpdater.spec.ts src/stores/appUpdateStore.spec.ts`

Expected: FAIL because the updater service does not expose separate operations and `prepareUpdate`, `restartToApplyUpdate`, and `readyToRestart` do not exist.

- [ ] **Step 3: Implement preparation and restart stages**

Expose `download()` and `install()` separately from the updater service. Extend `AppUpdateStatus` with `readyToRestart` and `AppUpdateErrorCode` with `RESTART_FAILED`. Replace the single internal install promise with deduplicated preparation, restart, and composed manual-install promises. Preparation calls only `download`; restart performs the existing workspace flush, installation, and relaunch. Track successful installation so a failed relaunch retry does not attempt to install consumed update bytes again.

- [ ] **Step 4: Verify update-state tests pass**

Run: `pnpm test src/services/appUpdater.spec.ts src/stores/appUpdateStore.spec.ts`

Expected: PASS.

### Task 3: Add the bilingual General setting and restart action

**Files:**

- Modify: `src/components/SoftwareUpdateCard.spec.ts`
- Modify: `src/components/SoftwareUpdateCard.vue`
- Modify: `src/components/SettingsView.spec.ts`
- Modify: `src/components/SettingsView.vue`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Write failing component tests**

Verify General renders `Automatically download updates` / `自动下载更新` as a sibling of the software update and startup rows, exposes `data-testid="automatic-update-toggle"`, persists a click through `updateUpdateSettings`, and does not render On/Off state text. Verify the update card shows `Restart and update` / `重启并更新` for `readyToRestart` and calls `restartToApplyUpdate()`.

- [ ] **Step 2: Verify the component tests fail**

Run: `pnpm test src/components/SoftwareUpdateCard.spec.ts`

Expected: FAIL because the separate preference row and ready-to-restart action are absent.

- [ ] **Step 3: Implement the setting controls and localized states**

Bind a semantic Switch-only button to `updateSettings.automaticDownloadEnabled` in a dedicated General `settings-form-line` at the same hierarchy as the startup row. Add the localized title, description, ready state, restart label, and restart error text, and reuse the existing `.connection-toggle` styling.

- [ ] **Step 4: Verify component tests pass**

Run: `pnpm test src/components/SoftwareUpdateCard.spec.ts`

Expected: PASS.

### Task 4: Coordinate automatic preparation at application level

**Files:**

- Modify: `src/App.spec.ts`
- Modify: `src/App.vue`

- [ ] **Step 1: Write failing application tests**

Stub `checkAtStartup` to set status to `available`. Verify automatic preparation occurs only when `automaticDownloadEnabled` is true, never calls `restartToApplyUpdate`, and enabling the setting after an update is already available starts preparation.

- [ ] **Step 2: Verify the application tests fail**

Run: `pnpm test src/App.spec.ts`

Expected: FAIL because App does not coordinate the automatic preference.

- [ ] **Step 3: Add the narrow watcher**

Watch:

```ts
[() => appSettings.updateSettings.value.automaticDownloadEnabled, () => appUpdate.status];
```

Call `prepareUpdate()` only when the preference is enabled and status equals `available`. Do not call the restart action from automatic orchestration.

- [ ] **Step 4: Verify application tests pass**

Run: `pnpm test src/App.spec.ts`

Expected: PASS.

### Task 5: Run regression verification and commit

**Files:**

- Verify all files modified in Tasks 1–4.

- [ ] **Step 1: Run focused tests together**

Run:

```bash
pnpm test src/stores/appSettingsStore.spec.ts src/stores/appUpdateStore.spec.ts src/components/SoftwareUpdateCard.spec.ts src/App.spec.ts
```

Expected: PASS with no warnings or unhandled errors.

- [ ] **Step 2: Run full project checks**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 3: Review scope and commit**

Confirm the diff contains no unrelated changes, generated artifacts, credentials, or automatic restart path. Commit with an English subject and numbered English body describing the persisted setting, updater state split, localized UI, and regression coverage.
