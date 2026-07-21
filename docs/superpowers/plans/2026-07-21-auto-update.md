# FleurTerm Auto Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add signed GitHub Releases update checking, download progress, installation, restart, and release automation for FleurTerm on macOS and Windows.

**Architecture:** A Tauri-specific update client is isolated behind an `AppUpdaterClient` interface. A dedicated Pinia store owns the update state machine and startup-check deduplication, while a focused settings component renders the state and invokes store actions. GitHub Actions produces signed updater artifacts and a draft Release from version tags.

**Tech Stack:** Vue 3, TypeScript, Pinia, Vitest, Tauri 2, `tauri-plugin-updater`, `tauri-plugin-process`, GitHub Actions, `tauri-apps/tauri-action`.

---

### Task 1: Install and isolate the Tauri updater APIs

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Create: `src/services/appUpdater.ts`
- Test: `src/services/appUpdater.spec.ts`

- [ ] **Step 1: Install the updater and process packages**

Run:

```bash
pnpm add @tauri-apps/plugin-updater @tauri-apps/plugin-process
cargo add --manifest-path src-tauri/Cargo.toml tauri-plugin-updater tauri-plugin-process
```

Expected: both JavaScript packages and both Rust crates appear in their manifests and locks.

- [ ] **Step 2: Write failing browser-degradation and result-normalization tests**

Define tests against the wished-for API:

```ts
const client = createAppUpdaterClient({ tauriAvailable: false });
await expect(client.currentVersion()).resolves.toBe('0.1.0');
await expect(client.check()).resolves.toBeNull();
```

Use injected bindings for Tauri APIs so tests can verify normalized `version`, `date`, `body`, download events, installation, and restart without invoking native plugins.

- [ ] **Step 3: Run the service test and verify RED**

Run: `pnpm test src/services/appUpdater.spec.ts`

Expected: FAIL because `appUpdater` and its exported interface do not exist.

- [ ] **Step 4: Implement the updater client**

Create these stable boundaries:

```ts
export interface AvailableAppUpdate {
  version: string;
  date: string | null;
  body: string | null;
  downloadAndInstall(onProgress: (progress: UpdateDownloadProgress) => void): Promise<void>;
}

export interface AppUpdaterClient {
  currentVersion(): Promise<string>;
  check(): Promise<AvailableAppUpdate | null>;
  restart(): Promise<void>;
  readonly available: boolean;
}
```

Translate Tauri `Started`, `Progress`, and `Finished` events into cumulative downloaded bytes and an optional total. Browser preview returns version `0.1.0`, no update, and `available: false`.

- [ ] **Step 5: Run the service test and verify GREEN**

Run: `pnpm test src/services/appUpdater.spec.ts`

Expected: PASS.

### Task 2: Implement the update state machine

**Files:**

- Create: `src/stores/appUpdateStore.ts`
- Test: `src/stores/appUpdateStore.spec.ts`

- [ ] **Step 1: Write failing store tests**

Cover these transitions with an injected `AppUpdaterClient`:

```text
idle -> checking -> upToDate
idle -> checking -> available
available -> downloading -> installing -> restart
checking/downloading/installing -> error
browser -> unsupported
```

Also assert that two simultaneous checks share one request and that `checkAtStartup()` runs only once.

- [ ] **Step 2: Run the store test and verify RED**

Run: `pnpm test src/stores/appUpdateStore.spec.ts`

Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement the store**

Export a factory for test injection and one application store:

```ts
export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'upToDate'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'error'
  | 'unsupported';

export const useAppUpdateStore = createAppUpdateStore(appUpdaterClient);
```

Keep the native update object in memory, sanitize user-visible errors, and prevent parallel checks or installations.

- [ ] **Step 4: Run the store test and verify GREEN**

Run: `pnpm test src/stores/appUpdateStore.spec.ts`

Expected: PASS.

### Task 3: Add the software update settings card

**Files:**

- Create: `src/components/SoftwareUpdateCard.vue`
- Test: `src/components/SoftwareUpdateCard.spec.ts`
- Modify: `src/components/SettingsView.vue`
- Modify: `src/components/SettingsView.spec.ts`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Write failing component tests**

Mount the card with a Pinia instance and injected update store states. Assert current version, English and Chinese copy, available version and release notes, progress display, disabled busy buttons, retry behavior, and the install action.

- [ ] **Step 2: Run the component test and verify RED**

Run: `pnpm test src/components/SoftwareUpdateCard.spec.ts`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the focused card**

Use `data-testid` contracts for `software-update-card`, `check-update`, and `install-update`. Render release notes as plain text, not HTML. Use existing setting tokens and black/gray surfaces.

- [ ] **Step 4: Add a failing SettingsView integration test**

Assert that the General section contains exactly one `software-update-card` and that changing setting sections does not create a second update store action.

- [ ] **Step 5: Integrate the card and add styles**

Import `SoftwareUpdateCard` into `SettingsView.vue` and add it after the language rows in the General form list. Add only component-scoped class rules under the existing settings styles.

- [ ] **Step 6: Run component and settings tests**

Run: `pnpm test src/components/SoftwareUpdateCard.spec.ts src/components/SettingsView.spec.ts`

Expected: PASS.

### Task 4: Check once when the application starts

**Files:**

- Modify: `src/App.vue`
- Modify: `src/App.spec.ts`

- [ ] **Step 1: Add a failing startup test**

Spy on `useAppUpdateStore().checkAtStartup`, mount `App`, wait for Vue effects, and assert one call. Remount with the same application store and assert no second native check is created.

- [ ] **Step 2: Run the App test and verify RED**

Run: `pnpm test src/App.spec.ts`

Expected: FAIL because App does not start update checking.

- [ ] **Step 3: Trigger the silent startup check**

Import `onMounted`, obtain the update store once, and call:

```ts
onMounted(() => {
  void appUpdate.checkAtStartup();
});
```

The store handles unsupported preview environments and silent errors.

- [ ] **Step 4: Run the App test and verify GREEN**

Run: `pnpm test src/App.spec.ts`

Expected: PASS.

### Task 5: Register plugins and configure release artifacts

**Files:**

- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/tauri.conf.json`
- Create: `.github/workflows/release.yml`
- Create: `scripts/check-version-consistency.mjs`
- Create: `docs/releasing.md`
- Modify: `package.json`

- [ ] **Step 1: Register native plugins and least-privilege capabilities**

Register `tauri_plugin_updater::Builder::new().build()` and `tauri_plugin_process::init()` on the Tauri builder. Add updater check/download/install and process restart permissions to the main-window capability.

- [ ] **Step 2: Configure updater artifacts and endpoint**

Set `bundle.createUpdaterArtifacts` to `true`, add the endpoint:

```text
https://github.com/Rqjqaz1122/fleuruiterm/releases/latest/download/latest.json
```

and document replacing the checked-in public-key marker with the public key generated for the release secrets before the first production Release.

- [ ] **Step 3: Add and test version consistency validation**

Create a Node script that reads the three manifests, extracts semantic versions, exits non-zero when they differ, and prints the common version when they match. Add `pnpm version:check` and run it.

- [ ] **Step 4: Add the GitHub Actions release workflow**

On tags matching `v*`, build Windows and macOS Universal using `tauri-apps/tauri-action`, set `includeUpdaterJson: true`, and create a draft Release. Consume `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and the documented Apple signing secrets only through `${{ secrets.* }}`.

- [ ] **Step 5: Document the first-release procedure**

Document repository visibility, updater-key generation, GitHub Secrets, Apple signing requirements, version bumping, tag creation, draft review, and publication. Never include secret values.

- [ ] **Step 6: Validate configuration and native compilation**

Run:

```bash
pnpm version:check
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
pnpm tauri build --debug --no-bundle
```

Expected: all commands exit zero.

### Task 6: Full regression verification

**Files:**

- Verify all files changed by Tasks 1-5.

- [ ] **Step 1: Run all frontend checks**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all commands exit zero with no test failures or lint warnings.

- [ ] **Step 2: Run formatting and diff checks**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
git diff --check
```

Expected: both commands exit zero.

- [ ] **Step 3: Inspect the final diff and report external prerequisites**

Confirm no private key, token, Apple credential, build output, or updater artifact is tracked. Report that the first real update remains gated by repository visibility, updater signing secrets, Apple signing/notarization secrets, and publishing a version greater than the installed build.
