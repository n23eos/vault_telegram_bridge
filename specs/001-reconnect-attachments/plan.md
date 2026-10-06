# Implementation Plan: Reconnect and attachment identity

**Feature ID**: `001-reconnect-attachments` | **Git Branch**: `main` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Existing-project bug fix described in `spec.md`.

## Summary

Make `BotClient` reusable after disconnect while rejecting results from an earlier asynchronous lifecycle. Add chat identity to deterministic attachment filenames so vault-wide lookup remains idempotent for one message without colliding across chats.

## Technical Context

**Language/Version**: TypeScript 5.9.3 installed (`^5.5.0` package range), target ES2021

**Primary Dependencies**: Obsidian 1.13.1 installed (`^1.7.2` package range), Vitest 2.1.9 installed (`^2.0.0` package range), esbuild 0.23.1 installed (`^0.23.0` package range)

**Storage**: Obsidian vault files and plugin settings

**Testing**: Vitest unit and in-memory integration tests

**Target Platform**: Obsidian desktop and mobile, minimum app version from existing manifest

**Project Type**: Existing Obsidian plugin

**Performance Goals**: Preserve one lightweight vault lookup before attachment download

**Constraints**: No real Telegram calls, no real vault install, no migration of existing attachments, no unrelated refactor

**Scale/Scope**: Client lifecycle, attachment identity, retryable cancellation errors and focused integration tests

## Constitution Check

The installed constitution records the existing project's vault safety, Obsidian compatibility, deterministic sync, test-first fixes, and minimal-change rules. This plan follows those gates: regressions precede production edits, existing vault data is not changed, and project-native checks verify the result.

## Current Project Structure

```text
src/
├── main.ts                    # Plugin composition and lifecycle
├── sync/
│   ├── dedupe.ts              # Chat and message marker identity
│   └── engine.ts              # Poll, attachment, write orchestration
├── telegram/
│   ├── bot-client.ts          # Bot API transport and client lifecycle
│   └── types.ts               # MessageSource and inbound message contracts
└── vault/
    └── attachments.ts         # Deterministic names and vault storage

tests/
├── bot-client.test.ts         # Update parsing and client regressions
├── attachment-store.test.ts   # Vault storage and idempotency
├── attachments.test.ts        # Filename rules
└── engine.test.ts             # End-to-end sync deduplication

package.json                   # test, typecheck, lint, and build commands
vitest.config.ts               # Obsidian stub alias, Node test environment
esbuild.config.mjs             # Production bundle
```

## Structure Decision

Keep the existing single-plugin layout. Client lifecycle logic stays in `src/telegram/bot-client.ts`; attachment identity stays in `src/vault/attachments.ts`; regressions stay beside the current tests for those modules.

## Root Cause and Design

1. `disconnect()` sets `disposed` permanently. `connect()` validates the token and updates visible state but never clears that flag, so every later `poll()` returns an empty result without calling Telegram.
2. `attachmentFileName()` scopes names only by date, message id, and optional original stem. Telegram message ids are scoped to a chat, but `findByName()` searches the whole vault. A file from another chat can therefore satisfy the lookup and suppress the correct download.
3. Replace the one-way disposal gate with a reusable lifecycle generation. A successful new connect enables polling, while a generation captured by an older poll cannot publish after disconnect or reconnect.
4. Include a safe signed-decimal chat token in both generic and original-name attachment suffixes. Keep vault-wide lookup because the now chat-qualified deterministic name supports crash recovery and folder-setting changes.
5. Do not scan for or rename legacy files. Existing note embeds and files remain byte-for-byte untouched.

## Verification Plan

1. Add focused tests for reconnect, stale in-flight polling, cross-chat attachment identity, and same-message existing-file reuse.
2. Run focused tests before implementation and record the expected failures.
3. Make the smallest production changes, then rerun focused tests.
4. Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check`.
5. Inspect the final diff and scan authored files for forbidden U+2013 and U+2014 characters.

## Дополнительные решения после ревью

- Старые ответы и ошибки polling не меняют состояние нового подключения. Токен захватывается на вызов, retry проверяет поколение до и после ожидания.
- Отмена getFile и fetchFile при смене подключения должна быть повторяемой ошибкой. AttachmentStore не пишет постоянную заглушку, SyncEngine не продвигает cursor до успешной повторной загрузки.
- Проверка выполняется на границе BotClient, AttachmentStore и SyncEngine без живого Telegram и рабочего хранилища.
