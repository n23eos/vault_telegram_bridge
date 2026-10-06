# Telegram Obsidian Bridge Constitution

## Core Principles

### I. Vault and credential safety

The plugin must keep bot tokens and transcription keys inside Obsidian plugin settings and must never log or render them in clear text. Tests and development commands must not contact live Telegram or transcription APIs. Existing vault notes, attachments, frontmatter, and user settings must not be renamed, deleted, or rewritten unless the requested behavior explicitly requires it.

### II. Obsidian-compatible transport and storage

Network access must use the Obsidian APIs already selected by the project so desktop and mobile behavior remains aligned. Production source must not introduce browser-incompatible Node APIs or unreviewed runtime dependencies. Vault paths must go through Obsidian path and file APIs, and user attachment-folder settings remain authoritative for placement.

### III. Deterministic and idempotent sync

Telegram message identity is the pair of chat id and message id. Cursor updates may occur only after durable processing, and replay after interruption must not duplicate note entries or attachment bytes. Ignored updates must still advance the cursor so Telegram does not redeliver them forever. Async results from an earlier client lifecycle must not mutate or publish into a later lifecycle.

### IV. Test-first bug fixes

Every behavior fix starts with the smallest automated regression that demonstrates the user-visible break. The regression must be observed failing for the expected reason before production code changes. Implementation then stays limited to the code needed for GREEN, followed by the full project test suite.

### V. Minimal project-native changes

Changes must follow the existing `src` and `tests` module boundaries, reuse current error and lifecycle patterns, and avoid unrelated refactors. Public behavior, compatibility, and data formats outside the accepted specification remain unchanged. Generated release assets may change only through the existing build and release scripts.

## Technical Constraints

- Language and build: strict TypeScript targeting ES2021, bundled by the existing esbuild configuration.
- Runtime: Obsidian desktop and mobile within the version range declared by `manifest.json`.
- Tests: Vitest with the repository's Obsidian stub. Tests must not use a real vault or external API.
- Internal notes: any directory named `!notes` remains ignored by the exact `.gitignore` pattern `\!notes/` and its contents are never published.
- Secrets: `.env`, session files, plugin `data.json`, tokens, and credentials are excluded from inspection and output.

## Development Workflow and Quality Gates

For an implementation task, first inspect repository instructions, current status, relevant source and tests, and the working tree. Preserve unrelated and uncommitted changes. Record the requested behavior and acceptance conditions in the active Spec Kit feature. Use RED, GREEN, and a focused diff review. Before reporting completion, run the project-native commands for tests, typecheck, lint, and production build, then run `git diff --check`. UI changes additionally require a real affected-flow check when an Obsidian runtime is available.

## Governance

This constitution documents the existing project's engineering constraints. Repository `AGENTS.md` instructions and explicit current user instructions take priority when they are stricter or more specific. Amendments require a dated rationale in the relevant feature plan. Any intentional exception must be recorded with scope, risk, and verification before implementation.

**Version**: 1.0.0 | **Ratified**: 2026-10-06 | **Last Amended**: 2026-10-06
