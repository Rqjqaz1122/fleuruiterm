# Terminal Tab Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display saved SSH terminals with their configured profile name and ordinary local terminals with localized sequential names.

**Architecture:** Keep the persisted workspace schema unchanged. Select the visible tab title in `App.vue` from the launch source, refresh saved SSH titles while opening or restoring profiles, and keep localization in the existing locale module.

**Tech Stack:** Vue 3, TypeScript, Pinia, Vitest, Vue Test Utils.

---

### Task 1: Apply source-aware terminal tab titles

**Files:**

- Modify: `src/App.vue`
- Modify: `src/i18n/locale.ts`

- [x] **Step 1: Localize the complete local-terminal label**

Change `terminalTitle()` to return `Local Terminal ${index}` for `en-US` and `本地终端 ${index}` for `zh-CN`.

- [x] **Step 2: Preserve titles for saved connections and ad hoc SSH terminals**

While projecting workspace tabs to application tabs, increment a counter only for ordinary local launches. Use the stored title when `tab.launch.type === 'savedConnection'` or when a local launch runs the `ssh` command; otherwise use `terminalTitle(localTerminalSequence)`.

- [x] **Step 3: Use the SSH profile name when opening and restoring**

In `buildConnectionOpenOptions()`, set the SSH `title` to `connection.name`. In `buildRestoredTabOptions()`, remove the persisted `tab.title` override for saved connections so the current connection options provide the current profile name.

### Task 2: Align existing regression expectations and review the diff

**Files:**

- Modify: `src/App.spec.ts`

- [x] **Step 1: Update existing expectations**

Update restored SSH expectations from historical titles to the current profile name, saved SSH connection-opening expectations to each configured name, and ordinary local labels to `Local Terminal N`.

- [x] **Step 2: Review without executing automated validation**

Inspect `git diff --check`, `git diff --stat`, and the focused source diff for unrelated changes, unused imports, stale title expectations, or accidental credentials. Do not run Vitest, typecheck, lint, build, Cargo, or the desktop application because the user will validate the behavior.

- [x] **Step 3: Commit the implementation**

Commit with an English subject and a numbered English body describing configured SSH profile titles, localized local terminal labels, restoration behavior, and updated regression expectations.
