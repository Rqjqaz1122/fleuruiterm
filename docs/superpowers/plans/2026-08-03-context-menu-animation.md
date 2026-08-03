# Context Menu Animation Implementation Plan

> **For agentic workers:** Implement inline on the existing `codex/feature-context-menus` branch. The user explicitly requested no automated self-checks for this change.

**Goal:** Restyle the global context menu and animate it from the actual right-click position.

**Architecture:** Keep menu positioning and business entries unchanged. Compute CSS transform-origin coordinates after viewport clamping, then use a Vue Transition and focused CSS motion classes for enter and leave states.

**Tech Stack:** Vue 3, TypeScript, CSS transitions.

---

### Task 1: Dynamic animation origin

**Files:**
- Modify: `src/components/AppContextMenu.vue`

- [ ] Add reactive X/Y origin coordinates to the existing positioned menu style.
- [ ] Calculate origin from pointer coordinates minus final clamped menu coordinates.
- [ ] Clamp origin coordinates to the visible menu bounds.
- [ ] Wrap the menu node in a named Vue `Transition` with `appear` enabled.

### Task 2: Reference-inspired visual and motion

**Files:**
- Modify: `src/styles/global.css`

- [ ] Apply the compact translucent panel, rounded border, soft shadow, and full-row hover styling.
- [ ] Add 160ms scale/fade enter classes using the dynamic transform origin.
- [ ] Add 110ms scale/fade leave classes using the same transform origin.
- [ ] Add a reduced-motion media rule without changing menu positioning.

### Task 3: Commit

- [ ] Commit the implementation with an English subject and numbered English body.
- [ ] Do not run tests, typecheck, lint, formatting checks, build, or GUI verification per user instruction.
