# Terminal Tab Names Design

## Goal

Make terminal tab names identify their connection source while keeping local terminal names localized and predictable.

## Naming Rules

- A terminal opened from a saved SSH profile uses the profile name exactly as configured.
- Opening the same SSH profile multiple times produces multiple tabs with the same profile name and no numeric suffix.
- Restoring a saved SSH terminal reloads the current profile and uses its current name instead of the persisted historical tab title.
- A normal local terminal is displayed as `Local Terminal N` in English and `本地终端 N` in Simplified Chinese.
- An ad hoc SSH terminal opened without a saved profile keeps its explicit title or its existing `SSH user@host` fallback.
- Other saved connection types retain the title produced by their connection-opening options.

## Architecture

The workspace continues to persist a terminal title and a launch descriptor. `App.vue` selects the display title from the launch source: saved connections and ad hoc SSH commands retain their stored title, while ordinary local launches use the localized local-terminal label. Connection-opening and restoration logic remains responsible for refreshing saved SSH titles from the active profile configuration.

This approach avoids changing the persistence schema and keeps the naming behavior close to the existing tab projection and connection option builders.

## Error Handling

If a persisted saved connection no longer exists, restoration keeps the current behavior and skips that terminal. No new fallback profile title is introduced because the connection cannot be opened safely without its configuration.

## Compatibility

Existing persisted local titles are used only to recover their numeric sequence. Existing persisted SSH titles are replaced with the current configured profile name during restoration.

## Validation Scope

Existing `App.spec.ts` expectations should be updated for the new labels and restored profile names. Automated commands and GUI validation are intentionally not run in this task at the user's request.
