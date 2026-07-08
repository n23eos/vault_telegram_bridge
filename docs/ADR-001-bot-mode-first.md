# ADR-001: bot mode ships first

Date: 2026-07-08 · Status: accepted · Decided by: the user, after the Phase 0 spike report

Supersedes TZ §8 ("не реализовывать bot mode … в фазе 1"), TZ §5.3 step 1, and the 0.1/0.3 rows of the SPEC §10 roadmap. SPEC §0 already contemplated this inversion; the trigger differs from the one it anticipated, and that difference is the substance of this document.

## Context

SPEC §0 planned to invert to bot mode only if the Phase 0 spikes came back red. They did not. `docs/SPIKE-REPORT.md` returned GO-with-reservations across the board: GramJS bundles clean for the browser, holds no Node dependencies, costs 0.4 ms at onload behind a lazy import, and the session-encryption scheme is settled. Account mode is buildable.

The inversion is happening for a different reason, and it only became visible once the spikes were done.

Every unresolved risk in the report belongs to account mode, and none of them belongs to the bridge:

- a Telegram session string in `configDir`, which is why `SECURITY-DECISION.md` exists at all;
- a shared `api_id` that Telegram demonstrably throttles (`API_ID_PUBLISHED_FLOOD`) and may treat worse;
- GramJS in a mobile WebView, unverified on real hardware, and the one surviving path to a NO-GO;
- a login flow that asks a note-taking user for their phone number.

Against that, the thing account mode buys is precisely one line of SPEC §12: **a message sent while Obsidian was closed for more than 24 hours still arrives.** Everything else in that comparison table — mobile support, a wizard instead of eight setup steps, EN+RU — bot mode delivers identically.

For the stated product — *write one message, it appears in an Obsidian folder* — the 24-hour window is not the load-bearing feature. A quick-capture user opens Obsidian more often than once a day. The 24-hour ceiling costs nothing most of the time and costs everything on the week you go on holiday, which is a real but narrow loss.

Shipping account mode first means paying all four risks up front to protect a benefit that the core use case barely exercises.

## Decision

**v0.1 is bot mode.** Bot token from BotFather, `getUpdates` long polling over `requestUrl`, text messages appended to a per-day note.

**Account mode moves to v0.3**, gated on the manual device run in `docs/MANUAL-TEST-GUIDE.md`. The Phase 0 artefacts hold their value: `SECURITY-DECISION.md` describes the session storage it will use, `session-crypto.ts` is written and tested, and the GramJS findings (browser dist-tag, WSS gateway, lazy import, `localStorage` pollution) are recorded and will still be true.

Marketing stays where SPEC §1 put it — *"No server required. Choose between Telegram account mode and bot mode"* — with account mode marked "coming in 0.3" instead of bot mode. The wizard's first screen shows both from day one, exactly as SPEC §1 requires; only the labels swap.

## Consequences

### What gets simpler, immediately

The threat model very nearly evaporates. A bot token grants control of a *bot*, not of a Telegram account. Leaked, it lets an attacker read messages sent to that bot and post as it; it does not read the user's chats, cannot send as the user, and cannot terminate their sessions. Revocation is `/revoke` in BotFather, thirty seconds, no consequences.

So, for v0.1:

- no passphrase, no PBKDF2, no AES-GCM, no encrypted session file, and no wizard screen apologising for any of it;
- no `api_id`, no `API_ID_PUBLISHED_FLOOD`, no account-ban exposure — the api_id research becomes a v0.3 input rather than a blocker;
- no GramJS: **722 KB and 203 KB gzipped leave the bundle**, and with them the mobile WebView risk, the `localStorage` pollution, and the `wss://*.web.telegram.org` gateway dependency that would have failed in countries where the web gateway is blocked;
- no Discord answer needed before writing code. The #plugin-dev question is still worth sending, for v0.3.

The token is still a credential and still lands in `data.json` inside `configDir`, which still syncs to git and iCloud for a lot of users. That warning stays in the wizard and the README. It is a much smaller warning.

### What gets harder, and what we accept

- **Messages older than 24 hours are lost.** Telegram's update queue expires. This is SPEC §11's stated bot-mode limitation and it now applies to the flagship release. It must be in the README, in the wizard, and in the catalogue description — not buried in an FAQ.
- **Two devices, one vault, one token.** Telegram permits exactly one active `getUpdates` poller per bot and answers the second with `409 Conflict`. Desktop and phone open at once is the target audience's default state. `flood.ts` treats 409 as a normal condition and backs off rather than surfacing an error; whichever device wins the poll writes to the vault, and vault sync carries the note to the other. Marker-based dedupe (SPEC §5а) remains mandatory for exactly this reason — it is not an account-mode concern.
- **Anyone who learns the bot's username can message it.** Bot usernames are enumerable. Without a guard, a stranger writes into the user's daily note. v0.1 therefore binds the bot to the first chat that talks to it, records that chat id, and silently ignores every other chat. The binding is visible in settings with a reset button. This has no account-mode equivalent and is not mentioned anywhere in SPEC or TZ; it is a v0.1 requirement.
- **Files above 20 MB are unreachable** to the Bot API. Irrelevant to a text-only MVP, relevant to v0.2 attachments.

### What is unchanged, and why the work carries over

`sync/`, `vault/`, `settings.ts`, `errors.ts` and `i18n/` never knew what transport delivered a message. That is TZ §7's Track B and TZ §4's contract boundary, and it is the reason this inversion costs days rather than a rewrite. `sync/dedupe.ts` is lifted from `spikes/` unchanged, including the `sanitizeBody()` fix for the infinite-duplication bug found in spike 0.2-F2.

`src/telegram/types.ts` keeps a transport-agnostic port. `BotClient` implements it now; `TelegramClient` implements it in v0.3, and `engine.ts` does not learn about the difference. The `LoginFlowCallbacks` interface from TZ §4 is deferred rather than frozen — spike 0.4-F2 argues it should gain a `showQrCode` callback, and there is now no reason to decide that before v0.3.

### Destination, per the user's instruction

One note per day holds everything written that day. The folder and the filename template are settings; the note is created on first message with a `tg-bridge` tag, and messages are appended under a configurable heading. This is narrower than SPEC §6's "daily note destination" and deliberately does not read Obsidian's core Daily Notes settings — that coupling, and the `app.internalPlugins` access it requires, moves to v0.2 where it can be tested against the plugin being enabled, disabled, and configured with a non-default format.

## Revisit this when

The manual Android run in `MANUAL-TEST-GUIDE.md` comes back. If GramJS logs in over the mobile WebView, account mode for v0.3 is a build task with its risks already documented. If the WebView refuses `wss://*.web.telegram.org`, account mode is desktop-only forever, SPEC §12's comparison table collapses to "wizard, mobile, RU", and this decision stops being an inversion and becomes the plan.
