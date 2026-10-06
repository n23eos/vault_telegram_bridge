# Tasks: Reconnect and attachment identity

**Input**: [spec.md](./spec.md) and [plan.md](./plan.md)

## Phase 1: Existing-project adoption

- [x] T001 Initialize Spec Kit 1.0.5 in the existing repository without replacing source code.
- [x] T002 Record the current source, test, and build structure in `specs/001-reconnect-attachments/plan.md`.
- [x] T003 Confirm `.gitignore` contains the exact escaped `\!notes/` pattern.

## Phase 2: Reconnect regression

- [x] T004 Add a failing reconnect regression to `tests/bot-client.test.ts`.
- [x] T005 Add a failing stale in-flight poll regression to `tests/bot-client.test.ts`.
- [x] T006 Implement reusable lifecycle handling in `src/telegram/bot-client.ts`.
- [x] T007 Run focused client tests and record GREEN.

## Phase 3: Attachment identity regression

- [x] T008 Add failing chat-qualified filename expectations to `tests/attachments.test.ts`.
- [x] T009 Add failing cross-chat byte isolation and same-message idempotency regressions to `tests/attachment-store.test.ts`.
- [x] T010 Include safe deterministic chat identity in `src/vault/attachments.ts`.
- [x] T011 Run focused attachment tests and record GREEN.

## Phase 4: Verification

- [x] T012 Run the full Vitest suite.
- [x] T013 Run TypeScript typecheck and ESLint.
- [x] T014 Run the production build.
- [x] T015 Run `git diff --check`, inspect the final diff, and scan authored files for forbidden dash characters.

## Дополнительная проверка lifecycle

- [x] Проверить старые network/401/500 ответы, ожидания и retry 429/409 после reconnect.
- [x] Проверить отмену вложения через AttachmentStore и SyncEngine, успешный повтор и сохранение cursor.
- [x] Повторить итоговые проверки и независимое ревью отмены.
