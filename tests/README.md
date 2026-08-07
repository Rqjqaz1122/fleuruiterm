# JavaScript and TypeScript Test Directory

All persistent JavaScript and TypeScript tests must be stored under this `tests/` directory. Test files must not be added to `src/` or other production source directories.

Mirror the production source structure and prefer the `*.spec.ts` suffix. Examples:

```text
tests/components/TerminalTabs.spec.ts
tests/services/sessionClient.spec.ts
tests/stores/workspaceStore.spec.ts
```

Run `pnpm test:location` to validate test file placement. Vitest discovers `*.spec.*` and `*.test.*` files only under `tests/`.

Rust integration tests must use Cargo's standard `src-tauri/tests/` directory. Existing inline Rust tests remain unchanged; do not add new inline test modules to production Rust files.
